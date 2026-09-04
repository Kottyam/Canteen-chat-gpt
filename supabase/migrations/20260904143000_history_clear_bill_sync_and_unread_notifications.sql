-- Keep the existing order-history deletion RPC as the source of truth.
-- When a date is cleared, subtract that date's order/adjustment contribution
-- from the corresponding monthly bill so the published bill reflects the
-- remaining month instead of retaining deleted charges.
create or replace function public.admin_delete_order_history_for_date(p_date date)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  r record;
  v_days integer;
begin
  if not exists (select 1 from public.profiles p where p.id=auth.uid() and p.role='admin' and p.status='active') then
    raise exception 'Only an authorized admin can delete order history';
  end if;

  create temporary table if not exists _gocanteen_history_impact (
    employee_id uuid primary key,
    bill_month integer,
    bill_year integer,
    food_total numeric,
    guest_total numeric,
    admin_total numeric
  ) on commit drop;
  truncate _gocanteen_history_impact;

  insert into _gocanteen_history_impact(employee_id,bill_month,bill_year,food_total,guest_total,admin_total)
  select o.employee_id,
         extract(month from o.ordered_for)::integer,
         extract(year from o.ordered_for)::integer,
         coalesce(sum(oi.quantity*oi.unit_price),0),
         coalesce(sum(case when oi.item_source='guest' then oi.quantity*oi.unit_price else 0 end),0),
         coalesce((select sum(a.amount) from public.employee_adjustments a where a.employee_id=o.employee_id and a.adjustment_date=p_date),0)
  from public.orders o
  left join public.order_items oi on oi.order_id=o.id
  where o.ordered_for=p_date
  group by o.employee_id,o.ordered_for;

  delete from public.employee_adjustments where adjustment_date=p_date;
  delete from public.orders where ordered_for=p_date;

  for r in select * from _gocanteen_history_impact loop
    select count(distinct o.ordered_for)::integer into v_days
    from public.orders o
    where o.employee_id=r.employee_id
      and extract(month from o.ordered_for)=r.bill_month
      and extract(year from o.ordered_for)=r.bill_year
      and coalesce(o.status,'')<>'cancelled';

    update public.monthly_bills mb
    set food_total=greatest(coalesce(mb.food_total,0)-coalesce(r.food_total,0),0),
        guest_food_total=greatest(coalesce(mb.guest_food_total,0)-coalesce(r.guest_total,0),0),
        admin_added_total=greatest(coalesce(mb.admin_added_total,0)-coalesce(r.admin_total,0),0),
        total=greatest(coalesce(mb.food_total,0)-coalesce(r.food_total,0),0)+greatest(coalesce(mb.admin_added_total,0)-coalesce(r.admin_total,0),0),
        days_ordered=coalesce(v_days,0),
        updated_at=now()
    where mb.employee_id=r.employee_id
      and mb.bill_month=r.bill_month
      and mb.bill_year=r.bill_year;
  end loop;
end;
$$;
revoke all on function public.admin_delete_order_history_for_date(date) from public;
grant execute on function public.admin_delete_order_history_for_date(date) to authenticated;

-- The UI should show only actionable/unseen notifications. read_at remains
-- persisted for audit/history, but read notifications no longer appear.
create index if not exists notifications_recipient_unread_idx
  on public.notifications(recipient_id,created_at desc)
  where read_at is null;

notify pgrst,'reload schema';
