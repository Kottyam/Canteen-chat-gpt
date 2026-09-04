alter table public.order_items add column if not exists line_total numeric generated always as (quantity * unit_price) stored;
alter table public.orders add column if not exists guest_total numeric not null default 0;
alter table public.orders drop constraint if exists orders_guest_total_check;
alter table public.orders add constraint orders_guest_total_check check (guest_total >= 0);

create or replace function public.refresh_guest_order_total()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.orders
  set guest_total = coalesce((select sum(oi.line_total) from public.order_items oi where oi.order_id = coalesce(new.order_id, old.order_id) and oi.item_source = 'guest'),0)
  where id = coalesce(new.order_id, old.order_id);
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_refresh_guest_order_total on public.order_items;
create trigger trg_refresh_guest_order_total
after insert or update or delete on public.order_items
for each row execute function public.refresh_guest_order_total();
