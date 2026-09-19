drop policy if exists order_items_admin_write on public.order_items;
drop policy if exists order_items_employee on public.order_items;
notify pgrst,'reload schema';