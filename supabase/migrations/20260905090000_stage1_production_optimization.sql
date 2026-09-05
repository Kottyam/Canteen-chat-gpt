-- GoCanteen Stage 1 production optimization: additive, non-destructive indexes only.
-- These indexes support the existing tenant/date access patterns without changing data or business logic.
create index if not exists orders_canteen_date_idx
  on public.orders (canteen_id, ordered_for desc);

create index if not exists orders_canteen_employee_date_idx
  on public.orders (canteen_id, employee_id, ordered_for desc);

create index if not exists order_items_canteen_order_idx
  on public.order_items (canteen_id, order_id);

create index if not exists employee_adjustments_canteen_date_idx
  on public.employee_adjustments (canteen_id, adjustment_date desc);

create index if not exists employee_adjustments_canteen_employee_date_idx
  on public.employee_adjustments (canteen_id, employee_id, adjustment_date desc);

create index if not exists bill_payments_canteen_bill_coverage_idx
  on public.bill_payments (canteen_id, bill_id, covered_through_at desc);

create index if not exists profiles_canteen_role_status_idx
  on public.profiles (canteen_id, role, status);
