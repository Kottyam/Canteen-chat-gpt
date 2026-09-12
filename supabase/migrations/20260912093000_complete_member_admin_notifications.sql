-- Complete the existing member notification architecture for member-facing
-- Admin order/menu changes. No new notification table/system is introduced.

create or replace function public.notify_admin_order_change()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_message text;
  v_type text;
  v_key text;
  v_name text:=coalesce(new.member_name_snapshot,old.member_name_snapshot,'your');
begin
  if not public.is_admin_user() then return coalesce(new,old); end if;

  if tg_op='INSERT' then
    if coalesce(new.order_source,'')<>'admin' then return new; end if;
    v_type:='order_added';
    v_key:=format('order_added:%s:%s',new.id,txid_current()::text);
    v_message:=format('An order was added to your account by Admin for %s.',to_char(new.ordered_for,'DD Mon YYYY'));
  elsif new.status='cancelled' and old.status is distinct from new.status then
    v_type:='order_cancelled';
    v_key:=format('order_cancelled:%s:%s',new.id,txid_current()::text);
    v_message:=format('Your order for %s was cancelled by Admin.',to_char(new.ordered_for,'DD Mon YYYY'));
  elsif new.ordered_for is distinct from old.ordered_for then
    v_type:='order_updated';
    v_key:=format('order_updated:%s:%s',new.id,txid_current()::text);
    v_message:=format('Your order date was changed by Admin to %s.',to_char(new.ordered_for,'DD Mon YYYY'));
  else
    return new;
  end if;

  perform public.create_member_notification(new.employee_id,v_type,case when v_type='order_added' then 'Order Added' when v_type='order_cancelled' then 'Order Cancelled' else 'Order Updated' end,v_message,jsonb_build_object('order_id',new.id,'order_date',new.ordered_for::text,'order_source',new.order_source),v_key);
  return new;
end;
$$;

drop trigger if exists trg_notify_admin_order_change on public.orders;
create trigger trg_notify_admin_order_change
after insert or update of status,ordered_for on public.orders
for each row execute function public.notify_admin_order_change();

create or replace function public.notify_admin_daily_menu_change()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_code text:=coalesce(new.item_code,old.item_code);
  v_name text:=coalesce(new.item_name,old.item_name,v_code);
  v_date date:=coalesce(new.menu_date,old.menu_date);
  v_message text;
  v_key text;
begin
  if not public.is_admin_user() then return coalesce(new,old); end if;

  if tg_op='INSERT' then
    v_message:=format('Menu Updated — %s added for %s at ₹%s.',v_name,to_char(v_date,'DD Mon YYYY'),to_char(coalesce(new.unit_price,0),'FM999999990.00'));
  elsif tg_op='DELETE' then
    v_message:=format('Menu Updated — %s was removed for %s.',v_name,to_char(v_date,'DD Mon YYYY'));
  elsif new.unit_price is distinct from old.unit_price then
    v_message:=format('Menu Updated — %s price changed to ₹%s for %s.',v_name,to_char(coalesce(new.unit_price,0),'FM999999990.00'),to_char(v_date,'DD Mon YYYY'));
  elsif new.active is distinct from old.active then
    v_message:=format('Menu Updated — %s is now %s for %s.',v_name,case when coalesce(new.active,false) then 'available' else 'unavailable' end,to_char(v_date,'DD Mon YYYY'));
  elsif new.item_name is distinct from old.item_name then
    v_message:=format('Menu Updated — %s was renamed for %s.',v_name,to_char(v_date,'DD Mon YYYY'));
  else
    return new;
  end if;

  v_key:=format('daily_menu:%s:%s:%s:%s',v_date::text,v_code,case when tg_op='DELETE' then 'delete' else 'update' end,txid_current()::text);
  perform public.notify_canteen_employees(v_key,'menu_updated','Menu Updated',v_message,jsonb_build_object('menu_date',v_date::text,'item_code',v_code,'item_name',v_name,'unit_price',coalesce(new.unit_price,old.unit_price),'change','member_facing'));
  return coalesce(new,old);
end;
$$;

drop trigger if exists trg_notify_admin_daily_menu_change on public.daily_menu;
create trigger trg_notify_admin_daily_menu_change
after insert or update or delete on public.daily_menu
for each row execute function public.notify_admin_daily_menu_change();

-- The contribution recalculation function is trigger-internal; do not expose
-- direct execution to authenticated clients.
revoke execute on function public.recalculate_employee_food_contribution_for_order(uuid) from authenticated,anon,public;

notify pgrst,'reload schema';
