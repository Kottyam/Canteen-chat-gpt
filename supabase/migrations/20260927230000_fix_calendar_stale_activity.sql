create or replace function public.get_order_history_calendar_dates(p_start_date date,p_end_date date)
returns table(history_date date,order_count integer,admin_added_count integer,transaction_count integer)
language sql
security definer
set search_path=public
as $$
  select d.history_date,
         coalesce(o.order_count,0)::integer,
         coalesce(a.admin_added_count,0)::integer,
         (coalesce(o.order_count,0)+coalesce(a.admin_added_count,0))::integer
  from (
    select distinct ordered_for as history_date
    from public.orders
    where canteen_id=public.current_canteen_id()
      and status='active'
      and ordered_for between p_start_date and p_end_date
    union
    select distinct adjustment_date as history_date
    from public.employee_adjustments
    where canteen_id=public.current_canteen_id()
      and adjustment_date between p_start_date and p_end_date
  ) d
  left join (
    select ordered_for,count(*)::integer as order_count
    from public.orders
    where canteen_id=public.current_canteen_id()
      and status='active'
      and ordered_for between p_start_date and p_end_date
    group by ordered_for
  ) o on o.ordered_for=d.history_date
  left join (
    select adjustment_date,count(*)::integer as admin_added_count
    from public.employee_adjustments
    where canteen_id=public.current_canteen_id()
      and adjustment_date between p_start_date and p_end_date
    group by adjustment_date
  ) a on a.adjustment_date=d.history_date
  where public.current_canteen_id() is not null
  order by d.history_date;
$$;

revoke all on function public.get_order_history_calendar_dates(date,date) from public;
grant execute on function public.get_order_history_calendar_dates(date,date) to authenticated;