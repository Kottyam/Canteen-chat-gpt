-- GO CANTEEN: incremental publication must be based on the persisted amount already covered.
-- The cutoff remains stored on each payment batch for publication history/audit.
-- Using current_total - existing payment batches also handles new guest charges
-- added to an existing parent order after the last publication cutoff.

create or replace function public.get_admin_bill_publish_states(p_month integer, p_year integer)
returns table(
  employee_id uuid,
  bill_id uuid,
  current_total numeric,
  requested_total numeric,
  new_amount numeric,
  last_covered_at timestamptz,
  last_covered_through date,
  can_publish boolean,
  publish_message text
)
language sql
security definer
set search_path=''
as $$
with authz as (
  select exists(
    select 1 from public.profiles p
    where p.id=auth.uid() and p.role='admin' and p.status='active'
      and p.canteen_id=public.current_canteen_id()
  ) ok
),
bounds as (
  select make_date(p_year,p_month,1) start_date,
         (make_date(p_year,p_month,1)+interval '1 month - 1 day')::date end_date
),
employees as (
  select p.id from public.profiles p,authz a
  where a.ok and p.role='employee' and p.status<>'deleted'
    and p.canteen_id=public.current_canteen_id()
),
bills as (
  select b.id,b.employee_id from public.monthly_bills b
  where b.bill_month=p_month and b.bill_year=p_year
    and b.canteen_id=public.current_canteen_id()
),
rows as (
  select e.id as employee_id,b.id as bill_id,totals.current_total,
    coalesce(req.requested_total,0) requested_total,
    req.last_covered_at,req.last_covered_through
  from employees e cross join bounds
  left join bills b on b.employee_id=e.id
  left join lateral (
    select
      coalesce((select sum(coalesce(oi.line_total,oi.quantity*oi.unit_price))
        from public.orders o join public.order_items oi on oi.order_id=o.id
        where o.employee_id=e.id and o.canteen_id=public.current_canteen_id()
          and o.status='active' and o.ordered_for between bounds.start_date and bounds.end_date),0)
      + coalesce((select sum(a.amount) from public.employee_adjustments a
        where a.employee_id=e.id and a.canteen_id=public.current_canteen_id()
          and a.adjustment_date between bounds.start_date and bounds.end_date),0) current_total
  ) totals on true
  left join lateral (
    select
      coalesce((select sum(p.amount) from public.bill_payments p
        where p.bill_id=b.id and p.employee_id=e.id and p.canteen_id=public.current_canteen_id()),0) requested_total,
      (select coalesce(p2.covered_through_at,p2.created_at) from public.bill_payments p2
        where p2.bill_id=b.id and p2.employee_id=e.id and p2.canteen_id=public.current_canteen_id()
        order by coalesce(p2.covered_through_at,p2.created_at) desc,p2.created_at desc,p2.id desc limit 1) last_covered_at,
      (select p3.covered_through from public.bill_payments p3
        where p3.bill_id=b.id and p3.employee_id=e.id and p3.canteen_id=public.current_canteen_id()
        order by coalesce(p3.covered_through_at,p3.created_at) desc,p3.created_at desc,p3.id desc limit 1) last_covered_through
  ) req on true
)
select employee_id,bill_id,current_total,requested_total,
  greatest(current_total-requested_total,0),last_covered_at,last_covered_through,
  case when last_covered_at is null then current_total>0
       else greatest(current_total-requested_total,0)>0 end,
  case when last_covered_at is null and current_total<=0 then 'No payable amount available.'
       when last_covered_at is not null and greatest(current_total-requested_total,0)<=0
         then 'No new amount since the last publication.'
       else null end
from rows;
$$;

create or replace function public.publish_employee_bill(
  p_employee_id uuid,p_month integer,p_year integer,p_food_total numeric,
  p_admin_added_total numeric,p_guest_food_total numeric default 0,
  p_days_ordered integer default 0,p_billing_start_date date default null,
  p_billing_end_date date default null
)
returns public.monthly_bills
language plpgsql
security definer
set search_path=''
as $$
declare
  v_admin public.profiles%rowtype;
  v_employee public.profiles%rowtype;
  v_settings public.payment_settings%rowtype;
  v_bill public.monthly_bills%rowtype;
  v_now timestamptz:=clock_timestamp();
  v_start date:=coalesce(p_billing_start_date,make_date(p_year,p_month,1));
  v_end date:=coalesce(p_billing_end_date,(make_date(p_year,p_month,1)+interval '1 month - 1 day')::date);
  v_employee_food numeric:=0;v_guest_food numeric:=0;v_admin_added numeric:=0;v_total numeric:=0;
  v_covered_amount numeric:=0;v_new_activity numeric:=0;v_last_cutoff timestamptz;
  v_seq integer:=1;v_id uuid;v_ref text;
begin
  select * into v_admin from public.profiles
  where id=auth.uid() and role='admin' and status='active'
    and canteen_id=public.current_canteen_id();
  if not found then raise exception 'Admin authorization required'; end if;

  select * into v_employee from public.profiles
  where id=p_employee_id and role='employee' and canteen_id=public.current_canteen_id();
  if not found then raise exception 'Employee not found in current canteen'; end if;

  perform pg_advisory_xact_lock(hashtext(format(
    'gocanteen-bill-publish:%s:%s:%s:%s',public.current_canteen_id(),p_employee_id,p_month,p_year)));

  select * into v_settings from public.payment_settings
  where canteen_id=public.current_canteen_id() limit 1;

  select
    coalesce(sum(coalesce(oi.line_total,oi.quantity*oi.unit_price)) filter(where oi.item_source='employee'),0),
    coalesce(sum(coalesce(oi.line_total,oi.quantity*oi.unit_price)) filter(where oi.item_source='guest'),0)
  into v_employee_food,v_guest_food
  from public.orders o join public.order_items oi on oi.order_id=o.id
  where o.employee_id=p_employee_id and o.canteen_id=public.current_canteen_id()
    and o.status='active' and o.ordered_for between v_start and v_end;

  select coalesce(sum(a.amount),0) into v_admin_added
  from public.employee_adjustments a
  where a.employee_id=p_employee_id and a.canteen_id=public.current_canteen_id()
    and a.adjustment_date between v_start and v_end;

  v_total:=greatest(v_employee_food,0)+greatest(v_guest_food,0)+greatest(v_admin_added,0);

  select max(coalesce(p.covered_through_at,p.created_at)),coalesce(sum(p.amount),0)
  into v_last_cutoff,v_covered_amount
  from public.bill_payments p join public.monthly_bills b on b.id=p.bill_id
  where b.employee_id=p_employee_id and b.bill_month=p_month and b.bill_year=p_year
    and b.canteen_id=public.current_canteen_id()
    and p.employee_id=p_employee_id and p.canteen_id=public.current_canteen_id();

  -- The stored coverage cutoff is retained for audit/history. The publishable
  -- delta is the portion of today's persisted eligible total not already
  -- represented by an existing payment batch. This avoids re-requesting old
  -- amounts and catches new guest/employee charges on an existing order.
  v_new_activity:=greatest(v_total-coalesce(v_covered_amount,0),0);

  if v_last_cutoff is not null and v_new_activity<=0 then
    raise exception 'No new amount since the last publication';
  end if;
  if v_last_cutoff is null and v_total<=0 then
    raise exception 'No payable amount available';
  end if;

  insert into public.monthly_bills(
    employee_id,bill_month,bill_year,billing_start_date,billing_end_date,days_ordered,
    food_total,guest_food_total,admin_added_total,total,published,published_at,updated_at,
    canteen_id,upi_name,upi_id,upi_number
  ) values(
    p_employee_id,p_month,p_year,v_start,v_end,greatest(coalesce(p_days_ordered,0),0),
    v_employee_food+v_guest_food,v_guest_food,v_admin_added,v_total,true,v_now,v_now,
    public.current_canteen_id(),nullif(trim(v_settings.upi_name),''),
    nullif(trim(v_settings.upi_id),''),nullif(trim(v_settings.upi_number),'')
  )
  on conflict(employee_id,bill_month,bill_year) do update set
    billing_start_date=excluded.billing_start_date,billing_end_date=excluded.billing_end_date,
    days_ordered=excluded.days_ordered,food_total=excluded.food_total,
    guest_food_total=excluded.guest_food_total,admin_added_total=excluded.admin_added_total,
    total=excluded.total,published=true,published_at=excluded.published_at,
    updated_at=excluded.updated_at,upi_name=excluded.upi_name,upi_id=excluded.upi_id,
    upi_number=excluded.upi_number
  returning * into v_bill;

  select coalesce(max(request_sequence),0)+1 into v_seq
  from public.bill_payments where bill_id=v_bill.id;
  v_id=gen_random_uuid();
  v_ref='GoCanteen-'||p_year||'-'||lpad(p_month::text,2,'0')||'-'||left(v_bill.employee_id::text,8)||'-B'||v_seq||'-'||left(v_id::text,8);

  insert into public.bill_payments(
    id,bill_id,employee_id,amount,status,created_at,updated_at,canteen_id,
    payment_reference,covered_through,covered_through_at,request_sequence,
    upi_name,upi_id,upi_number
  ) values(
    v_id,v_bill.id,v_bill.employee_id,v_new_activity,'unpaid',v_now,v_now,v_bill.canteen_id,
    v_ref,v_end,v_now,v_seq,v_bill.upi_name,v_bill.upi_id,v_bill.upi_number
  );
  return v_bill;
end;
$$;
