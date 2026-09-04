alter table public.orders add column if not exists guest_count integer;
alter table public.orders drop constraint if exists orders_guest_count_check;
alter table public.orders add constraint orders_guest_count_check check (guest_count is null or guest_count >= 1);
