create or replace function public.is_active_canteen_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id=(select auth.uid())
      and p.role='admin'
      and p.admin_role in ('owner','master_admin','staff_admin')
      and p.status='active'
      and p.canteen_id is not null
  )
$$;

revoke execute on function public.is_active_canteen_admin() from public;
grant execute on function public.is_active_canteen_admin() to authenticated;

drop policy if exists "subscription_plans_canteen_select_active" on public.subscription_plans;
create policy "subscription_plans_canteen_select_active" on public.subscription_plans
for select to authenticated
using ((active=true) and (select public.is_active_canteen_admin()));

drop policy if exists "canteen_subscriptions_canteen_select" on public.canteen_subscriptions;
create policy "canteen_subscriptions_canteen_select" on public.canteen_subscriptions
for select to authenticated
using ((select public.is_active_canteen_admin()) and canteen_id=(select public.current_canteen_id()));

drop policy if exists "subscription_payments_canteen_select" on public.subscription_payments;
create policy "subscription_payments_canteen_select" on public.subscription_payments
for select to authenticated
using ((select public.is_active_canteen_admin()) and canteen_id=(select public.current_canteen_id()));
