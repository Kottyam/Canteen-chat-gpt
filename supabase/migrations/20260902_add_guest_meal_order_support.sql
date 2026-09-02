alter table public.orders add column if not exists guest_name text;

alter table public.orders drop constraint if exists orders_order_source_check;
alter table public.orders add constraint orders_order_source_check
  check (order_source = any (array['employee'::text, 'admin'::text, 'guest'::text]));

alter table public.monthly_bills add column if not exists guest_food_total numeric not null default 0;
alter table public.monthly_bills add constraint monthly_bills_guest_food_total_check
  check (guest_food_total >= 0);
