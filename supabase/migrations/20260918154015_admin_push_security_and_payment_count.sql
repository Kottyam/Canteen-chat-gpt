drop policy if exists notifications_admin on public.notifications;
create policy notifications_admin_select on public.notifications for select to authenticated
using (recipient_id=(select auth.uid()) and current_canteen_id()=canteen_id and (
  public.has_admin_permission('dashboard') or public.has_admin_permission('payments') or public.has_admin_permission('members') or
  public.has_admin_permission('orders') or public.has_admin_permission('menu') or public.has_admin_permission('daily_reports') or
  public.has_admin_permission('monthly_reports') or public.has_admin_permission('revenue') or public.has_admin_permission('expenses') or
  public.has_admin_permission('time_management')
));
create policy notifications_admin_update on public.notifications for update to authenticated
using (recipient_id=(select auth.uid()) and current_canteen_id()=canteen_id and (
  public.has_admin_permission('dashboard') or public.has_admin_permission('payments') or public.has_admin_permission('members') or
  public.has_admin_permission('orders') or public.has_admin_permission('menu') or public.has_admin_permission('daily_reports') or
  public.has_admin_permission('monthly_reports') or public.has_admin_permission('revenue') or public.has_admin_permission('expenses') or
  public.has_admin_permission('time_management')
))
with check (recipient_id=(select auth.uid()) and current_canteen_id()=canteen_id);