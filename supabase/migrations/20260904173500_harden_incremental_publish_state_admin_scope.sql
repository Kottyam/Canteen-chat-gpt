-- Keep the incremental publish-state RPC read-safe: only active admins in the
-- current canteen may inspect other employees' bill totals/cutoffs.
create or replace function public.get_admin_bill_publish_states(p_month integer,p_year integer)
returns table(employee_id uuid,bill_id uuid,current_total numeric,requested_total numeric,new_amount numeric,last_covered_at timestamptz,last_covered_through date,can_publish boolean,publish_message text)
language sql
security definer
set search_path=''
as $$
with authz as (
  select exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='admin' and p.status='active' and p.canteen_id=public.current_canteen_id()) ok
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
)
select e.id,b.id,totals.current_total,coalesce(req.requested_total,0),
       case when req.last_covered_at is null then totals.current_total else greatest(totals.new_activity_total,0) end,
       req.last_covered_at,req.last_covered_through,
       case when req.last_covered_at is null then totals.current_total>0 else greatest(totals.new_activity_total,0)>0 end,
       case when req.last_covered_at is null and totals.current_total<=0 then 'No payable amount available.'
            when req.last_covered_at is not null and greatest(totals.new_activity_total,0)<=0 then 'No new amount since the last publication.'
            else null end
from employees e cross join bounds left join bills b on b.employee_id=e.id
left join lateral (
  select
    coalesce((select sum(coalesce(oi.line_total,oi.quantity*oi.unit_price)) from public.orders o join public.order_items oi on oi.order_id=o.id where o.employee_id=e.id and o.canteen_id=public.current_canteen_id() and o.status='active' and o.ordered_for between bounds.start_date and bounds.end_date),0)
    + coalesce((select sum(a.amount) from public.employee_adjustments a where a.employee_id=e.id and a.canteen_id=public.current_canteen_id() and a.adjustment_date between bounds.start_date and bounds.end_date),0) current_total,
    coalesce((select sum(coalesce(oi.line_total,oi.quantity*oi.unit_price)) from public.orders o join public.order_items oi on oi.order_id=o.id where o.employee_id=e.id and o.canteen_id=public.current_canteen_id() and o.status='active' and o.ordered_for between bounds.start_date and bounds.end_date and o.created_at>coalesce((select max(coalesce(p2.covered_through_at,p2.created_at)) from public.bill_payments p2 where p2.bill_id=b.id),'-infinity'::timestamptz)),0)
    + coalesce((select sum(a.amount) from public.employee_adjustments a where a.employee_id=e.id and a.canteen_id=public.current_canteen_id() and a.adjustment_date between bounds.start_date and bounds.end_date and a.created_at>coalesce((select max(coalesce(p3.covered_through_at,p3.created_at)) from public.bill_payments p3 where p3.bill_id=b.id),'-infinity'::timestamptz)),0) new_activity_total
) totals on true
left join lateral (
  select coalesce((select sum(p.amount) from public.bill_payments p where p.bill_id=b.id and p.employee_id=e.id and p.canteen_id=public.current_canteen_id()),0) requested_total,
         (select coalesce(p2.covered_through_at,p2.created_at) from public.bill_payments p2 where p2.bill_id=b.id and p2.employee_id=e.id and p2.canteen_id=public.current_canteen_id() order by coalesce(p2.covered_through_at,p2.created_at) desc,p2.created_at desc,p2.id desc limit 1) last_covered_at,
         (select p3.covered_through from public.bill_payments p3 where p3.bill_id=b.id and p3.employee_id=e.id and p3.canteen_id=public.current_canteen_id() order by coalesce(p3.covered_through_at,p3.created_at) desc,p3.created_at desc,p3.id desc limit 1) last_covered_through
) req on true;
$$;
revoke all on function public.get_admin_bill_publish_states(integer,integer) from public;
grant execute on function public.get_admin_bill_publish_states(integer,integer) to authenticated;
notify pgrst,'reload schema';