-- Publishing is locked until the configured Employee Order Time ends for the current billing month.
-- Past billing months are already closed; future billing months are not publishable.
create or replace function public.bill_publish_window_open(p_month integer,p_year integer)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
with local_now as (select now() at time zone current_setting('TIMEZONE') as ts),
settings as (select enabled,start_time,end_time from public.order_window_settings where canteen_id=public.current_canteen_id() limit 1)
select case
  when make_date(p_year,p_month,1) < make_date(extract(year from (select ts from local_now))::integer,extract(month from (select ts from local_now))::integer,1) then true
  when make_date(p_year,p_month,1) > make_date(extract(year from (select ts from local_now))::integer,extract(month from (select ts from local_now))::integer,1) then false
  when not coalesce((select enabled from settings),false) then true
  when public.is_holiday_for_date((select ts::date from local_now)) then false
  else (select ts::time >= end_time from local_now,settings)
end;
$$;

-- Batch-specific employee confirmation. The payment UUID is the only payment
-- row identity used for the transition, with a row lock to serialize concurrent
-- confirmation/admin actions on the same batch.
create or replace function public.confirm_bill_payment(p_payment_id uuid)
returns public.bill_payments
language plpgsql
security definer
set search_path to 'public'
as $$
declare result public.bill_payments;
begin
  select p.* into result
  from public.bill_payments p
  join public.monthly_bills b on b.id=p.bill_id
  where p.id=p_payment_id
    and p.employee_id=auth.uid()
    and b.employee_id=auth.uid()
    and p.canteen_id=public.current_canteen_id()
    and b.canteen_id=public.current_canteen_id()
    and b.published=true
  for update of p;

  if result.id is null then raise exception 'Payment request is not available'; end if;
  if result.status='paid' then return result; end if;
  if result.status not in ('unpaid','not_received') then raise exception 'Payment request cannot be confirmed'; end if;

  update public.bill_payments
  set status='pending_verification',confirmed_at=now(),approved_at=null,approved_by=null,updated_at=now()
  where id=p_payment_id
    and employee_id=auth.uid()
    and canteen_id=public.current_canteen_id()
  returning * into result;

  return result;
end;
$$;

-- Admin publish remains independently locked per canteen + employee + month.
-- It also enforces the same order-window gate server-side so UI state cannot be
-- bypassed by a direct RPC call.
create or replace function public.publish_employee_bill(p_employee_id uuid,p_month integer,p_year integer,p_food_total numeric,p_admin_added_total numeric,p_guest_food_total numeric default 0,p_days_ordered integer default 0,p_billing_start_date date default null,p_billing_end_date date default null)
returns public.monthly_bills
language plpgsql security definer set search_path to ''
as $$
declare v_admin public.profiles%rowtype; v_employee public.profiles%rowtype; v_settings public.payment_settings%rowtype; v_bill public.monthly_bills%rowtype; v_now timestamptz:=clock_timestamp(); v_start date:=coalesce(p_billing_start_date,make_date(p_year,p_month,1)); v_end date:=coalesce(p_billing_end_date,(make_date(p_year,p_month,1)+interval '1 month - 1 day')::date); v_employee_food numeric:=0; v_guest_food numeric:=0; v_admin_added numeric:=0; v_total numeric:=0; v_covered_amount numeric:=0; v_new_activity numeric:=0; v_last_cutoff timestamptz; v_seq integer:=1; v_id uuid; v_ref text;
begin
 select * into v_admin from public.profiles where id=auth.uid() and role='admin' and status='active' and canteen_id=public.current_canteen_id(); if not found then raise exception 'Admin authorization required'; end if;
 select * into v_employee from public.profiles where id=p_employee_id and role='employee' and canteen_id=public.current_canteen_id(); if not found then raise exception 'Employee not found in current canteen'; end if;
 perform pg_advisory_xact_lock(hashtext(format('gocanteen-bill-publish:%s:%s:%s:%s',public.current_canteen_id(),p_employee_id,p_month,p_year)));
 if not public.bill_publish_window_open(p_month,p_year) then raise exception 'Publishing available after the employee order window closes.'; end if;
 select * into v_settings from public.payment_settings where canteen_id=public.current_canteen_id() limit 1;
 select coalesce(sum(coalesce(oi.line_total,oi.quantity*oi.unit_price)) filter(where oi.item_source='employee'),0),coalesce(sum(coalesce(oi.line_total,oi.quantity*oi.unit_price)) filter(where oi.item_source='guest'),0) into v_employee_food,v_guest_food from public.orders o join public.order_items oi on oi.order_id=o.id where o.employee_id=p_employee_id and o.canteen_id=public.current_canteen_id() and o.status='active' and o.ordered_for between v_start and v_end;
 select coalesce(sum(a.amount),0) into v_admin_added from public.employee_adjustments a where a.employee_id=p_employee_id and a.canteen_id=public.current_canteen_id() and a.adjustment_date between v_start and v_end;
 v_total:=greatest(v_employee_food,0)+greatest(v_guest_food,0)+greatest(v_admin_added,0);
 select max(coalesce(p.covered_through_at,p.created_at)),coalesce(sum(p.amount),0) into v_last_cutoff,v_covered_amount from public.bill_payments p join public.monthly_bills b on b.id=p.bill_id where b.employee_id=p_employee_id and b.bill_month=p_month and b.bill_year=p_year and b.canteen_id=public.current_canteen_id() and p.employee_id=p_employee_id and p.canteen_id=public.current_canteen_id();
 v_new_activity:=greatest(v_total-coalesce(v_covered_amount,0),0);
 if v_last_cutoff is not null and v_new_activity<=0 then raise exception 'No new amount since the last publication'; end if;
 if v_last_cutoff is null and v_total<=0 then raise exception 'No payable amount available'; end if;
 insert into public.monthly_bills(employee_id,bill_month,bill_year,billing_start_date,billing_end_date,days_ordered,food_total,guest_food_total,admin_added_total,total,published,published_at,updated_at,canteen_id,upi_name,upi_id,upi_number) values(p_employee_id,p_month,p_year,v_start,v_end,greatest(coalesce(p_days_ordered,0),0),v_employee_food+v_guest_food,v_guest_food,v_admin_added,v_total,true,v_now,v_now,public.current_canteen_id(),nullif(trim(v_settings.upi_name),''),nullif(trim(v_settings.upi_id),''),nullif(trim(v_settings.upi_number),'')) on conflict(employee_id,bill_month,bill_year) do update set billing_start_date=excluded.billing_start_date,billing_end_date=excluded.billing_end_date,days_ordered=excluded.days_ordered,food_total=excluded.food_total,guest_food_total=excluded.guest_food_total,admin_added_total=excluded.admin_added_total,total=excluded.total,published=true,published_at=excluded.published_at,updated_at=excluded.updated_at,upi_name=excluded.upi_name,upi_id=excluded.upi_id,upi_number=excluded.upi_number returning * into v_bill;
 select coalesce(max(request_sequence),0)+1 into v_seq from public.bill_payments where bill_id=v_bill.id; v_id=gen_random_uuid(); v_ref='GoCanteen-'||p_year||'-'||lpad(p_month::text,2,'0')||'-'||left(v_bill.employee_id::text,8)||'-B'||v_seq||'-'||left(v_id::text,8);
 insert into public.bill_payments(id,bill_id,employee_id,amount,status,created_at,updated_at,canteen_id,payment_reference,covered_through,covered_through_at,request_sequence,upi_name,upi_id,upi_number) values(v_id,v_bill.id,v_bill.employee_id,v_new_activity,'unpaid',v_now,v_now,v_bill.canteen_id,v_ref,v_end,v_now,v_seq,v_bill.upi_name,v_bill.upi_id,v_bill.upi_number);
 return v_bill;
end;
$$;
