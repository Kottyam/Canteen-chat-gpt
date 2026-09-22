create or replace function public.cancel_order_source(
  p_order_id uuid,
  p_source text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_order public.orders%rowtype;
  v_profile public.profiles%rowtype;
  v_remaining_guest numeric:=0;
  v_remaining_items integer:=0;
  v_is_admin boolean:=false;
  v_item_source text;
  v_has_linked_adjustment boolean:=false;
  v_message text;
  v_title text;
  v_type text;
  v_event_key text;
begin
  if p_source not in ('employee','guest') then raise exception 'Invalid order source'; end if;
  select * into v_order from public.orders where id=p_order_id and status='active' for update;
  if not found then raise exception 'Active order not found'; end if;
  select * into v_profile from public.profiles where id=auth.uid() and status='active' limit 1;
  if not found then raise exception 'Not authenticated'; end if;

  v_is_admin:=v_profile.role='admin' and v_profile.canteen_id is not null and v_profile.canteen_id=v_order.canteen_id;
  if v_is_admin then
    if not public.has_admin_permission('orders') then raise exception 'Order permission required'; end if;
  elsif v_order.employee_id<>auth.uid() then
    raise exception 'Not allowed to cancel this order';
  end if;

  if not v_is_admin and p_source='employee' and coalesce(v_order.order_source,'employee')='admin' then
    if not public.employee_order_window_open() then raise exception 'Order window is currently closed'; end if;
  end if;

  v_item_source:=case
    when p_source='employee' and coalesce(v_order.order_source,'employee')='admin' then 'admin'
    when v_is_admin and p_source='employee' and coalesce(v_order.order_source,'employee')='admin' then 'admin'
    else p_source
  end;

  delete from public.order_items where order_id=p_order_id and item_source=v_item_source;
  select count(*) into v_remaining_items from public.order_items where order_id=p_order_id and coalesce(quantity,0)>0;

  if v_remaining_items=0 then
    select exists(select 1 from public.employee_adjustments where order_id=p_order_id) into v_has_linked_adjustment;

    if v_is_admin then
      v_type:='order_cancelled';
      v_title:='Order Cancelled';
      v_message:=format('Your order for %s was cancelled by Admin.',to_char(v_order.ordered_for,'DD Mon YYYY'));
      v_event_key:=format('order_cancelled:%s',v_order.id::text);
      perform public.create_member_notification(v_order.employee_id,v_type,v_title,v_message,jsonb_build_object('cancelled_order_id',v_order.id,'order_date',v_order.ordered_for::text,'order_source',v_order.order_source,'cancelled_source',p_source),v_event_key);
    end if;

    if v_has_linked_adjustment then
      update public.orders
      set status='cancelled',cancelled_at=now(),updated_at=now()
      where id=p_order_id;
    else
      delete from public.orders where id=p_order_id;
    end if;
    return;
  end if;

  select coalesce(sum(quantity*unit_price),0) into v_remaining_guest
  from public.order_items where order_id=p_order_id and item_source='guest' and coalesce(quantity,0)>0;

  update public.orders
  set guest_total=v_remaining_guest,
      guest_name=case when v_remaining_guest>0 then guest_name else null end,
      guest_count=case when v_remaining_guest>0 then guest_count else null end,
      status='active',cancelled_at=null,updated_at=now()
  where id=p_order_id;

  if v_is_admin then
    v_type:='order_part_cancelled';
    v_title:='Order Updated';
    v_message:=format('Your %s order for %s was cancelled by Admin.',case when p_source='guest' then 'guest' else 'member' end,to_char(v_order.ordered_for,'DD Mon YYYY'));
    v_event_key:=format('order_part_cancelled:%s:%s',v_order.id::text,p_source);
    perform public.create_member_notification(v_order.employee_id,v_type,v_title,v_message,jsonb_build_object('cancelled_order_id',v_order.id,'order_date',v_order.ordered_for::text,'order_source',v_order.order_source,'cancelled_source',p_source),v_event_key);
  end if;
end;
$function$;

revoke execute on function public.cancel_order_source(uuid,text) from public;
revoke execute on function public.cancel_order_source(uuid,text) from anon;
grant execute on function public.cancel_order_source(uuid,text) to authenticated;
