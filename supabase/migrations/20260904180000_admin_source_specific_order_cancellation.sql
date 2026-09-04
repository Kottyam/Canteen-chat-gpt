-- Allow Admin/Staff Actions to cancel exactly one source from a shared employee/guest order.
-- Employee and guest remain independent; cancelling one never cancels the other.
create or replace function public.cancel_order_source(p_order_id uuid, p_source text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_profile public.profiles%rowtype;
  v_remaining_guest numeric := 0;
  v_remaining_items integer := 0;
  v_is_admin boolean := false;
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

  select * into v_profile
  from public.profiles
  where id = auth.uid()
    and coalesce(status, 'active') <> 'deleted'
  limit 1;

  if not found then
    raise exception 'Not authenticated';
  end if;

  v_is_admin := v_profile.role = 'admin'
    and (v_profile.canteen_id is null or v_order.canteen_id is null or v_profile.canteen_id = v_order.canteen_id);

  if not v_is_admin and v_order.employee_id <> auth.uid() then
    raise exception 'Not allowed to cancel this order';
  end if;

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
