-- Source-specific cancellation for shared employee/guest parent orders.
-- Employee and guest are independent order sources; cancelling one must never cancel the other.
create or replace function public.cancel_order_source(p_order_id uuid, p_source text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_remaining_guest numeric := 0;
  v_remaining_items integer := 0;
begin
  if p_source not in ('employee','guest') then
    raise exception 'Invalid order source';
  end if;

  select * into v_order
  from public.orders
  where id = p_order_id
    and status = 'active'
  for update;

  if not found then
    raise exception 'Active order not found';
  end if;

  if v_order.employee_id <> auth.uid() then
    raise exception 'Not allowed to cancel this order';
  end if;

  -- Remove only the selected source. The other source remains untouched.
  delete from public.order_items
  where order_id = p_order_id
    and item_source = p_source;

  select count(*) into v_remaining_items
  from public.order_items
  where order_id = p_order_id
    and coalesce(quantity,0) > 0;

  if v_remaining_items = 0 then
    delete from public.orders where id = p_order_id;
    return;
  end if;

  select coalesce(sum(quantity * unit_price),0) into v_remaining_guest
  from public.order_items
  where order_id = p_order_id
    and item_source = 'guest'
    and coalesce(quantity,0) > 0;

  update public.orders
  set guest_total = v_remaining_guest,
      guest_name = case when v_remaining_guest > 0 then guest_name else null end,
      guest_count = case when v_remaining_guest > 0 then guest_count else null end,
      status = 'active',
      cancelled_at = null,
      updated_at = now()
  where id = p_order_id;
end;
$$;

grant execute on function public.cancel_order_source(uuid,text) to authenticated;

notify pgrst, 'reload schema';
