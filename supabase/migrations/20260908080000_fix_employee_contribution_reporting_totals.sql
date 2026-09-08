-- Fix only order-level aggregation for historical employee contribution reporting.
-- The contribution amounts are stored per order, so never sum them once per order-item row.
-- No historical data is rewritten.

create or replace function public.get_admin_bill_publish_states(p_month integer,p_year integer)
returns table(employee_id uuid,bill_id uuid,current_total numeric,requested_total numeric,new_amount numeric,last_covered_at timestamptz,last_covered_through date,can_publish boolean,publish_message text)
language sql security definer set search_path=''
as $$
with bounds as (
  select make_date(p_year,p_month,1) start_date,(make_date(p_year,p_month,1)+interval '1 month - 1 day')::date end_date
),employees as (
  select p.id from public.profiles p
  where p.role='employee' and p.status<>'deleted' and p.canteen_id=public.current_canteen_id()
),bills as (
  select b.id,b.employee_id from public.monthly_bills b
  where b.bill_month=p_month and b.bill_year=p_year and b.canteen_id=public.current_canteen_id()
),activity as (
  select e.id employee_id,
    coalesce((select sum(q.employee_amount) from (
      select o.id,coalesce(max(o.employee_food_amount),sum(coalesce(oi.line_total,oi.quantity*oi.unit_price))) employee_amount
      from public.orders o join public.order_items oi on oi.order_id=o.id
      where o.employee_id=e.id and o.canteen_id=public.current_canteen_id() and o.status='active'
        and o.ordered_for between bounds.start_date and bounds.end_date and oi.item_source<>'guest'
      group by o.id
    ) q),0)+coalesce((select sum(a.amount) from public.employee_adjustments a
      where a.employee_id=e.id and a.canteen_id=public.current_canteen_id()
        and a.adjustment_date between bounds.start_date and bounds.end_date),0) current_total,
    coalesce((select sum(q.employee_amount) from (
      select o.id,coalesce(max(o.employee_food_amount),sum(coalesce(oi.line_total,oi.quantity*oi.unit_price))) employee_amount
      from public.orders o join public.order_items oi on oi.order_id=o.id
      where o.employee_id=e.id and o.canteen_id=public.current_canteen_id() and o.status='active'
        and o.ordered_for between bounds.start_date and bounds.end_date and oi.item_source<>'guest'
        and o.created_at>coalesce((select max(coalesce(p2.covered_through_at,p2.created_at)) from public.bill_payments p2
          where p2.bill_id=(select b2.id from public.monthly_bills b2 where b2.employee_id=e.id and b2.bill_month=p_month and b2.bill_year=p_year and b2.canteen_id=public.current_canteen_id() limit 1)
        ),'-infinity'::timestamptz)
      group by o.id
    ) q),0)+coalesce((select sum(a.amount) from public.employee_adjustments a
      where a.employee_id=e.id and a.canteen_id=public.current_canteen_id()
        and a.adjustment_date between bounds.start_date and bounds.end_date
        and a.created_at>coalesce((select max(coalesce(p3.covered_through_at,p3.created_at)) from public.bill_payments p3
          where p3.bill_id=(select b3.id from public.monthly_bills b3 where b3.employee_id=e.id and b3.bill_month=p_month and b3.bill_year=p_year and b3.canteen_id=public.current_canteen_id() limit 1)
        ),'-infinity'::timestamptz)),0) new_activity_total
  from employees e cross join bounds
)
select e.id,b.id,a.current_total,coalesce(r.requested_total,0),
  case when r.last_covered_at is null then a.current_total else greatest(a.new_activity_total,0) end,
  r.last_covered_at,r.last_covered_through,
  case when r.last_covered_at is null then a.current_total>0 else greatest(a.new_activity_total,0)>0 end,
  case when r.last_covered_at is null and a.current_total<=0 then 'No payable amount available.'
       when r.last_covered_at is not null and greatest(a.new_activity_total,0)<=0 then 'No new amount since the last publication.'
       else null end
from employees e cross join bounds
left join bills b on b.employee_id=e.id
left join activity a on a.employee_id=e.id
left join lateral(
  select coalesce((select sum(p.amount) from public.bill_payments p where p.bill_id=b.id and p.employee_id=e.id and p.canteen_id=public.current_canteen_id()),0) requested_total,
    (select coalesce(p2.covered_through_at,p2.created_at) from public.bill_payments p2 where p2.bill_id=b.id and p2.employee_id=e.id and p2.canteen_id=public.current_canteen_id() order by coalesce(p2.covered_through_at,p2.created_at) desc,p2.created_at desc,p2.id desc limit 1) last_covered_at,
    (select p3.covered_through from public.bill_payments p3 where p3.bill_id=b.id and p3.employee_id=e.id and p3.canteen_id=public.current_canteen_id() order by coalesce(p3.covered_through_at,p3.created_at) desc,p3.created_at desc,p3.id desc limit 1) last_covered_through
) r on true;
$$;
revoke all on function public.get_admin_bill_publish_states(integer,integer) from public;
grant execute on function public.get_admin_bill_publish_states(integer,integer) to authenticated;

create or replace function public.publish_employee_bill(p_employee_id uuid,p_month integer,p_year integer,p_food_total numeric,p_admin_added_total numeric,p_guest_food_total numeric default 0,p_days_ordered integer default 0,p_billing_start_date date default null,p_billing_end_date date default null)
returns public.monthly_bills language plpgsql security definer set search_path=''
as $$
declare v_admin public.profiles%rowtype;v_employee public.profiles%rowtype;v_settings public.payment_settings%rowtype;v_bill public.monthly_bills%rowtype;v_now timestamptz:=clock_timestamp();v_start date:=coalesce(p_billing_start_date,make_date(p_year,p_month,1));v_end date:=coalesce(p_billing_end_date,(make_date(p_year,p_month,1)+interval '1 month - 1 day')::date);v_gross numeric:=0;v_employee_food numeric:=0;v_guest numeric:=0;v_admin_added numeric:=0;v_total numeric:=0;v_new numeric:=0;v_cutoff timestamptz;v_seq integer:=1;v_id uuid;v_ref text;v_pct numeric:=0;
begin
select * into v_admin from public.profiles where id=auth.uid() and role='admin' and status='active' and canteen_id=public.current_canteen_id();if not found then raise exception 'Admin authorization required';end if;
select * into v_employee from public.profiles where id=p_employee_id and role='employee' and canteen_id=public.current_canteen_id();if not found then raise exception 'Employee not found in current canteen';end if;
select * into v_settings from public.payment_settings where canteen_id=public.current_canteen_id() limit 1;
select coalesce(sum(q.gross_amount),0),coalesce(sum(q.employee_amount),0),coalesce(sum(q.guest_amount),0) into v_gross,v_employee_food,v_guest
from (select o.id,
  sum(coalesce(oi.line_total,oi.quantity*oi.unit_price)) filter(where oi.item_source<>'guest') gross_amount,
  coalesce(max(o.employee_food_amount),sum(coalesce(oi.line_total,oi.quantity*oi.unit_price)) filter(where oi.item_source<>'guest')) employee_amount,
  sum(coalesce(oi.line_total,oi.quantity*oi.unit_price)) filter(where oi.item_source='guest') guest_amount
  from public.orders o join public.order_items oi on oi.order_id=o.id
  where o.employee_id=p_employee_id and o.canteen_id=public.current_canteen_id() and o.status='active' and o.ordered_for between v_start and v_end
  group by o.id) q;
select coalesce(sum(a.amount),0) into v_admin_added from public.employee_adjustments a where a.employee_id=p_employee_id and a.canteen_id=public.current_canteen_id() and a.adjustment_date between v_start and v_end;
select case when min(coalesce(o.employee_contribution_percentage,0))=max(coalesce(o.employee_contribution_percentage,0)) then min(coalesce(o.employee_contribution_percentage,0)) else null end into v_pct from public.orders o where o.employee_id=p_employee_id and o.canteen_id=public.current_canteen_id() and o.status='active' and o.ordered_for between v_start and v_end;
v_total:=greatest(v_employee_food,0)+greatest(v_guest,0)+greatest(v_admin_added,0);perform pg_advisory_xact_lock(hashtext(format('gocanteen-bill-publish:%s:%s:%s:%s',public.current_canteen_id(),p_employee_id,p_month,p_year)));
select max(coalesce(p.covered_through_at,p.created_at)) into v_cutoff from public.bill_payments p join public.monthly_bills b on b.id=p.bill_id where b.employee_id=p_employee_id and b.bill_month=p_month and b.bill_year=p_year and b.canteen_id=public.current_canteen_id() and p.employee_id=p_employee_id;
if v_cutoff is null then v_new:=v_total;else select coalesce(sum(q.employee_amount),0) into v_new from (select o.id,coalesce(max(o.employee_food_amount),sum(coalesce(oi.line_total,oi.quantity*oi.unit_price))) employee_amount from public.orders o join public.order_items oi on oi.order_id=o.id where o.employee_id=p_employee_id and o.canteen_id=public.current_canteen_id() and o.status='active' and o.ordered_for between v_start and v_end and oi.item_source<>'guest' and o.created_at>v_cutoff group by o.id) q;select v_new+coalesce(sum(a.amount),0) into v_new from public.employee_adjustments a where a.employee_id=p_employee_id and a.canteen_id=public.current_canteen_id() and a.adjustment_date between v_start and v_end and a.created_at>v_cutoff;end if;
if v_cutoff is not null and greatest(v_new,0)<=0 then raise exception 'No new amount since the last publication';end if;if v_cutoff is null and v_total<=0 then raise exception 'No payable amount available';end if;
insert into public.monthly_bills(employee_id,bill_month,bill_year,billing_start_date,billing_end_date,days_ordered,food_total,guest_food_total,admin_added_total,total,published,published_at,updated_at,canteen_id,upi_name,upi_id,upi_number,gross_food_total,employee_food_total,company_food_total,employee_contribution_percentage,company_contribution_percentage) values(p_employee_id,p_month,p_year,v_start,v_end,greatest(coalesce(p_days_ordered,0),0),v_employee_food+v_guest,v_guest,v_admin_added,v_total,true,v_now,v_now,public.current_canteen_id(),nullif(trim(v_settings.upi_name),''),nullif(trim(v_settings.upi_id),''),nullif(trim(v_settings.upi_number),''),v_gross,v_employee_food,greatest(v_gross-v_employee_food,0),v_pct,case when v_pct>0 then 100-v_pct else 0 end) on conflict(employee_id,bill_month,bill_year) do update set billing_start_date=excluded.billing_start_date,billing_end_date=excluded.billing_end_date,days_ordered=excluded.days_ordered,food_total=excluded.food_total,guest_food_total=excluded.guest_food_total,admin_added_total=excluded.admin_added_total,total=excluded.total,published=true,published_at=excluded.published_at,updated_at=excluded.updated_at,upi_name=excluded.upi_name,upi_id=excluded.upi_id,upi_number=excluded.upi_number,gross_food_total=excluded.gross_food_total,employee_food_total=excluded.employee_food_total,company_food_total=excluded.company_food_total,employee_contribution_percentage=excluded.employee_contribution_percentage,company_contribution_percentage=excluded.company_contribution_percentage returning * into v_bill;
select coalesce(max(request_sequence),0)+1 into v_seq from public.bill_payments where bill_id=v_bill.id;v_id=gen_random_uuid();v_ref='GoCanteen-'||p_year||'-'||lpad(p_month::text,2,'0')||'-'||left(v_bill.employee_id::text,8)||'-B'||v_seq||'-'||left(v_id::text,8);insert into public.bill_payments(id,bill_id,employee_id,amount,status,created_at,updated_at,canteen_id,payment_reference,covered_through,covered_through_at,request_sequence,upi_name,upi_id,upi_number) values(v_id,v_bill.id,v_bill.employee_id,greatest(case when v_cutoff is null then v_total else v_new end,0),'unpaid',v_now,v_now,v_bill.canteen_id,v_ref,v_end,v_now,v_seq,v_bill.upi_name,v_bill.upi_id,v_bill.upi_number);return v_bill;end;
$$;
revoke all on function public.publish_employee_bill(uuid,integer,integer,numeric,numeric,numeric,integer,date,date) from public;grant execute on function public.publish_employee_bill(uuid,integer,integer,numeric,numeric,numeric,integer,date,date) to authenticated;

create or replace function public.get_monthly_revenue_contribution_report(p_year integer,p_month integer)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_report jsonb;v_canteen uuid;v_gross numeric:=0;v_employee numeric:=0;v_company numeric:=0;
begin
v_report:=public.get_monthly_revenue_report(p_year,p_month);v_canteen:=public.current_canteen_id();if v_canteen is null then raise exception 'Canteen context required';end if;
select coalesce(sum(q.gross_amount),0),coalesce(sum(q.employee_amount),0) into v_gross,v_employee from (select o.id,sum(coalesce(oi.line_total,oi.quantity*oi.unit_price)) gross_amount,coalesce(max(o.employee_food_amount),sum(coalesce(oi.line_total,oi.quantity*oi.unit_price))) employee_amount from public.orders o join public.order_items oi on oi.order_id=o.id where o.canteen_id=v_canteen and o.ordered_for>=make_date(p_year,p_month,1) and o.ordered_for<(make_date(p_year,p_month,1)+interval '1 month') and coalesce(o.status,'')<>'cancelled' and oi.canteen_id=v_canteen and oi.item_source<>'guest' group by o.id) q;
v_company:=greatest(v_gross-v_employee,0);return v_report||jsonb_build_object('gross_food_revenue',v_gross,'employee_food_revenue',v_employee,'company_food_revenue',v_company);
end;
$$;
revoke all on function public.get_monthly_revenue_contribution_report(integer,integer) from public;grant execute on function public.get_monthly_revenue_contribution_report(integer,integer) to authenticated;
notify pgrst,'reload schema';
