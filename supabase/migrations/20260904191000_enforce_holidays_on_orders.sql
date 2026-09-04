-- Enforce configured holidays at the database boundary for employee/guest-originated orders.
-- Admin-created orders remain available through the existing admin workflow.
create or replace function public.reject_order_on_holiday()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' and coalesce(new.order_source, 'employee') <> 'admin' then
    if public.is_holiday_for_date(new.ordered_for) then
      raise exception 'Today is a holiday. Orders are not available.';
    end if;
  end if;
  if tg_op = 'UPDATE' and new.ordered_for is distinct from old.ordered_for and coalesce(new.order_source, 'employee') <> 'admin' then
    if public.is_holiday_for_date(new.ordered_for) then
      raise exception 'Today is a holiday. Orders are not available.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists orders_reject_holiday on public.orders;
create trigger orders_reject_holiday
before insert or update of ordered_for, order_source on public.orders
for each row execute function public.reject_order_on_holiday();

revoke all on function public.reject_order_on_holiday() from public;
