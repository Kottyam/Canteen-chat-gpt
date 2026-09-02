alter table public.orders add column if not exists guest_name text;

alter table public.orders drop constraint if exists orders_order_source_check;
alter table public.orders add constraint orders_order_source_check
  check (order_source = any (array['employee'::text, 'admin'::text, 'guest'::text]));

alter table public.monthly_bills add column if not exists guest_food_total numeric not null default 0;
alter table public.monthly_bills add constraint monthly_bills_guest_food_total_check
  check (guest_food_total >= 0);

alter table public.order_items add column if not exists item_source text not null default 'employee';
alter table public.order_items add column if not exists guest_name text;
alter table public.order_items drop constraint if exists order_items_order_id_item_code_key;
create unique index if not exists order_items_order_id_item_code_source_key on public.order_items(order_id,item_code,item_source);
alter table public.order_items drop constraint if exists order_items_item_source_check;
alter table public.order_items add constraint order_items_item_source_check check (item_source in ('employee','admin','guest'));
