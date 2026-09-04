-- GO CANTEEN: preserve and relink the original/legacy tenant safely.
-- This migration is intentionally non-destructive and idempotent.
-- It never deletes or recreates existing users or business records.

do $$
declare
  v_legacy_canteen uuid;
begin
  -- The original Admin is the stable anchor for the pre-existing canteen.
  select p.canteen_id
    into v_legacy_canteen
  from public.profiles p
  where p.role = 'admin'
    and p.employee_code = 'admin'
    and p.canteen_id is not null
  order by p.created_at
  limit 1;

  if v_legacy_canteen is null then
    raise exception 'Legacy GoCanteen Admin/canteen could not be identified; aborting safe backfill';
  end if;

  -- Existing member profiles: preserve every existing profile and only fill a missing tenant link.
  update public.profiles
     set canteen_id = v_legacy_canteen,
         updated_at = now()
   where canteen_id is null;

  -- Direct canteen-owned data created before tenant columns were populated.
  update public.menu_prices
     set canteen_id = v_legacy_canteen
   where canteen_id is null;

  update public.daily_menu
     set canteen_id = v_legacy_canteen
   where canteen_id is null;

  update public.holidays
     set canteen_id = v_legacy_canteen
   where canteen_id is null;

  update public.payment_settings
     set canteen_id = v_legacy_canteen
   where canteen_id is null;

  update public.order_window_settings
     set canteen_id = v_legacy_canteen
   where canteen_id is null;

  update public.expenses
     set canteen_id = v_legacy_canteen
   where canteen_id is null;

  -- Employee-owned records prefer the linked member's tenant and fall back to legacy.
  update public.orders o
     set canteen_id = coalesce((select p.canteen_id from public.profiles p where p.id = o.employee_id), v_legacy_canteen)
   where o.canteen_id is null;

  update public.order_items oi
     set canteen_id = coalesce((select o.canteen_id from public.orders o where o.id = oi.order_id), v_legacy_canteen)
   where oi.canteen_id is null;

  update public.monthly_bills mb
     set canteen_id = coalesce((select p.canteen_id from public.profiles p where p.id = mb.employee_id), v_legacy_canteen)
   where mb.canteen_id is null;

  update public.bill_payments bp
     set canteen_id = coalesce((select mb.canteen_id from public.monthly_bills mb where mb.id = bp.bill_id),
                               (select p.canteen_id from public.profiles p where p.id = bp.employee_id),
                               v_legacy_canteen)
   where bp.canteen_id is null;

  update public.employee_adjustments ea
     set canteen_id = coalesce((select p.canteen_id from public.profiles p where p.id = ea.employee_id), v_legacy_canteen)
   where ea.canteen_id is null;

  update public.notifications n
     set canteen_id = coalesce((select p.canteen_id from public.profiles p where p.id = n.recipient_id), v_legacy_canteen)
   where n.canteen_id is null;

  update public.payments py
     set canteen_id = coalesce((select p.canteen_id from public.profiles p where p.id = py.employee_id), v_legacy_canteen)
   where py.canteen_id is null;
end $$;

-- Members may read their own profile only. Admins retain tenant-wide profile access through
-- tenant_profiles_admin_all. This prevents member accounts from reading other members while
-- keeping the existing Admin employee-management screen functional.
drop policy if exists tenant_profiles_self_select on public.profiles;
create policy tenant_profiles_self_select
on public.profiles
for select
to authenticated
using (id = (select auth.uid()));

-- Explicitly verify that the migration did not leave tenantless legacy rows in the tables it owns.
do $$
declare
  v_nulls integer;
begin
  select count(*) into v_nulls from public.profiles where canteen_id is null;
  if v_nulls > 0 then raise exception 'Legacy profile tenant backfill incomplete: % rows remain', v_nulls; end if;
  select count(*) into v_nulls from public.orders where canteen_id is null;
  if v_nulls > 0 then raise exception 'Legacy order tenant backfill incomplete: % rows remain', v_nulls; end if;
  select count(*) into v_nulls from public.order_items where canteen_id is null;
  if v_nulls > 0 then raise exception 'Legacy order-item tenant backfill incomplete: % rows remain', v_nulls; end if;
  select count(*) into v_nulls from public.menu_prices where canteen_id is null;
  if v_nulls > 0 then raise exception 'Legacy menu tenant backfill incomplete: % rows remain', v_nulls; end if;
  select count(*) into v_nulls from public.monthly_bills where canteen_id is null;
  if v_nulls > 0 then raise exception 'Legacy bill tenant backfill incomplete: % rows remain', v_nulls; end if;
end $$;

notify pgrst, 'reload schema';
