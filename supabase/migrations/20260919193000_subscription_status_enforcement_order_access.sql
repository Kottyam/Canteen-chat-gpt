create or replace function public.can_canteen_operate(p_canteen_id uuid default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when auth.uid() is null then false
    when exists (
      select 1 from public.profiles p
      where p.id=(select auth.uid())
        and p.role='admin' and p.admin_role='super_admin' and p.status='active'
    ) then true
    else exists (
      select 1
      from public.profiles p
      join public.canteen_subscriptions s on s.canteen_id=p.canteen_id
      where p.id=(select auth.uid())
        and p.status='active'
        and p.canteen_id=coalesce(p_canteen_id,p.canteen_id)
        and case s.status
          when 'payment_pending' then true
          when 'trial' then s.trial_end is not null and s.trial_end > now()
          when 'active' then s.subscription_end is not null and s.subscription_end > now()
          else false
        end
    )
  end
$$;

revoke execute on function public.can_canteen_operate(uuid) from public, anon;
grant execute on function public.can_canteen_operate(uuid) to authenticated;

drop policy if exists orders_admin_tenant on public.orders;
drop policy if exists orders_employee_write on public.orders;
drop policy if exists orders_employee_update on public.orders;
drop policy if exists orders_employee_delete on public.orders;
drop policy if exists orders_admin_select on public.orders;
drop policy if exists orders_admin_insert on public.orders;
drop policy if exists orders_admin_update on public.orders;
drop policy if exists orders_admin_delete on public.orders;
drop policy if exists orders_employee_select on public.orders;
drop policy if exists orders_employee_insert on public.orders;
drop policy if exists orders_employee_update_access on public.orders;
drop policy if exists orders_employee_delete_access on public.orders;

create policy orders_admin_select on public.orders for select to authenticated
using ((select public.is_admin_user()) and canteen_id=(select public.current_canteen_id()));
create policy orders_admin_insert on public.orders for insert to authenticated
with check ((select public.is_admin_user()) and canteen_id=(select public.current_canteen_id()) and (select public.can_canteen_operate(canteen_id)));
create policy orders_admin_update on public.orders for update to authenticated
using ((select public.is_admin_user()) and canteen_id=(select public.current_canteen_id()) and (select public.can_canteen_operate(canteen_id)))
with check ((select public.is_admin_user()) and canteen_id=(select public.current_canteen_id()) and (select public.can_canteen_operate(canteen_id)));
create policy orders_admin_delete on public.orders for delete to authenticated
using ((select public.is_admin_user()) and canteen_id=(select public.current_canteen_id()) and (select public.can_canteen_operate(canteen_id)));

create policy orders_employee_select on public.orders for select to authenticated
using (employee_id=(select auth.uid()) and status='active' and canteen_id=(select public.current_canteen_id()));
create policy orders_employee_insert on public.orders for insert to authenticated
with check (employee_id=(select auth.uid()) and canteen_id=(select public.current_canteen_id()) and (select public.can_canteen_operate(canteen_id)));
create policy orders_employee_update_access on public.orders for update to authenticated
using (employee_id=(select auth.uid()) and canteen_id=(select public.current_canteen_id()) and (select public.can_canteen_operate(canteen_id)))
with check (employee_id=(select auth.uid()) and canteen_id=(select public.current_canteen_id()) and (select public.can_canteen_operate(canteen_id)));
create policy orders_employee_delete_access on public.orders for delete to authenticated
using (employee_id=(select auth.uid()) and canteen_id=(select public.current_canteen_id()) and (select public.can_canteen_operate(canteen_id)));

drop policy if exists order_items_admin_tenant on public.order_items;
drop policy if exists order_items_employee_tenant on public.order_items;
drop policy if exists order_items_admin_select on public.order_items;
drop policy if exists order_items_admin_insert on public.order_items;
drop policy if exists order_items_admin_update on public.order_items;
drop policy if exists order_items_admin_delete on public.order_items;
drop policy if exists order_items_employee_select on public.order_items;
drop policy if exists order_items_employee_insert on public.order_items;
drop policy if exists order_items_employee_update on public.order_items;
drop policy if exists order_items_employee_delete on public.order_items;

create policy order_items_admin_select on public.order_items for select to authenticated
using ((select public.is_admin_user()) and canteen_id=(select public.current_canteen_id()));
create policy order_items_admin_insert on public.order_items for insert to authenticated
with check ((select public.is_admin_user()) and canteen_id=(select public.current_canteen_id()) and (select public.can_canteen_operate(canteen_id)));
create policy order_items_admin_update on public.order_items for update to authenticated
using ((select public.is_admin_user()) and canteen_id=(select public.current_canteen_id()) and (select public.can_canteen_operate(canteen_id)))
with check ((select public.is_admin_user()) and canteen_id=(select public.current_canteen_id()) and (select public.can_canteen_operate(canteen_id)));
create policy order_items_admin_delete on public.order_items for delete to authenticated
using ((select public.is_admin_user()) and canteen_id=(select public.current_canteen_id()) and (select public.can_canteen_operate(canteen_id)));

create policy order_items_employee_select on public.order_items for select to authenticated
using (exists (select 1 from public.orders o where o.id=order_items.order_id and o.employee_id=(select auth.uid()) and o.canteen_id=(select public.current_canteen_id())));
create policy order_items_employee_insert on public.order_items for insert to authenticated
with check (exists (select 1 from public.orders o where o.id=order_items.order_id and o.employee_id=(select auth.uid()) and o.canteen_id=(select public.current_canteen_id()) and (select public.can_canteen_operate(o.canteen_id))));
create policy order_items_employee_update on public.order_items for update to authenticated
using (exists (select 1 from public.orders o where o.id=order_items.order_id and o.employee_id=(select auth.uid()) and o.canteen_id=(select public.current_canteen_id()) and (select public.can_canteen_operate(o.canteen_id))))
with check (exists (select 1 from public.orders o where o.id=order_items.order_id and o.employee_id=(select auth.uid()) and o.canteen_id=(select public.current_canteen_id()) and (select public.can_canteen_operate(o.canteen_id))));
create policy order_items_employee_delete on public.order_items for delete to authenticated
using (exists (select 1 from public.orders o where o.id=order_items.order_id and o.employee_id=(select auth.uid()) and o.canteen_id=(select public.current_canteen_id()) and (select public.can_canteen_operate(o.canteen_id))));

notify pgrst,'reload schema';