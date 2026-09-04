-- Employee Order for Me: enforce one active order per employee/date at the database level.
-- Guest items remain independent within the same order row through item_source.
create unique index if not exists orders_one_active_per_employee_day
  on public.orders(employee_id, ordered_for)
  where status = 'active';
