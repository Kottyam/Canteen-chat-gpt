-- Skip normal contribution recalculation only while the trusted destructive cleanup RPCs run.
-- Normal order/adjustment operations retain the existing recalculation behaviour.

create or replace function public.recalculate_order_contribution_from_items()
returns trigger
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  v_employee uuid;
  v_canteen uuid;
  v_date date;
begin
  if to_regclass('pg_temp.gocanteen_destructive_cleanup') is not null then
    return coalesce(new,old);
  end if;

  select employee_id,canteen_id,ordered_for
  into v_employee,v_canteen,v_date
  from public.orders
  where id=coalesce(new.order_id,old.order_id);

  if v_employee is not null and v_canteen is not null and v_date is not null then
    perform private.recalculate_employee_month_contributions_internal(
      v_employee,
      v_canteen,
      make_date(extract(year from v_date)::int,extract(month from v_date)::int,1)
    );
  end if;

  return coalesce(new,old);
end;
$function$;

create or replace function public.recalculate_employee_adjustment_contribution()
returns trigger
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  v_date date;
  v_month date;
begin
  if to_regclass('pg_temp.gocanteen_destructive_cleanup') is not null then
    return coalesce(new,old);
  end if;

  v_date:=coalesce(new.adjustment_date,old.adjustment_date);
  v_month:=make_date(extract(year from v_date)::int,extract(month from v_date)::int,1);

  perform private.recalculate_employee_month_contributions_internal(
    coalesce(new.employee_id,old.employee_id),
    coalesce(new.canteen_id,old.canteen_id),
    v_month
  );

  return coalesce(new,old);
end;
$function$;

create or replace function public.admin_factory_reset()
returns void
language plpgsql
security definer
set search_path=public
as $function$
declare
  v_canteen uuid:=public.current_canteen_id();
begin
  if not public.is_admin_user() or v_canteen is null then
    raise exception 'Admin authorization required';
  end if;

  create temporary table if not exists gocanteen_destructive_cleanup(
    marker boolean
  ) on commit drop;
  truncate gocanteen_destructive_cleanup;
  insert into gocanteen_destructive_cleanup values(true);

  delete from public.order_items where canteen_id=v_canteen;
  delete from public.orders where canteen_id=v_canteen;
  delete from public.bill_payments where canteen_id=v_canteen;
  delete from public.monthly_bills where canteen_id=v_canteen;
  delete from public.payments where canteen_id=v_canteen;
  delete from public.employee_adjustments where canteen_id=v_canteen;
  delete from public.notifications where canteen_id=v_canteen;
  delete from public.daily_menu where canteen_id=v_canteen;
  delete from public.menu_prices where canteen_id=v_canteen;
  delete from public.holidays where canteen_id=v_canteen;
  delete from public.expenses where canteen_id=v_canteen;
  delete from public.admin_permissions where canteen_id=v_canteen;
  delete from public.profiles where canteen_id=v_canteen and id<>auth.uid() and role<>'admin';
end
$function$;

create or replace function public.delete_own_canteen()
returns jsonb
language plpgsql
security definer
set search_path='public', 'auth'
as $function$
declare
  v_uid uuid:=auth.uid();
  v_canteen_id uuid;
  v_canteen_name text;
begin
  if not public.is_google_owner() then
    raise exception 'Only the Google Canteen Owner can permanently delete this Canteen.';
  end if;

  select p.canteen_id
  into v_canteen_id
  from public.profiles p
  where p.id=v_uid and p.status='active' and p.role='admin';

  if v_canteen_id is null then
    raise exception 'You are not authorized to delete a Canteen.';
  end if;

  select c.name
  into v_canteen_name
  from public.canteens c
  where c.id=v_canteen_id and c.owner_id=v_uid;

  if v_canteen_name is null then
    raise exception 'Only the Canteen Owner can permanently delete this Canteen.';
  end if;

  create temporary table if not exists gocanteen_destructive_cleanup(
    marker boolean
  ) on commit drop;
  truncate gocanteen_destructive_cleanup;
  insert into gocanteen_destructive_cleanup values(true);

  delete from public.bill_payments where canteen_id=v_canteen_id;
  delete from public.monthly_bills where canteen_id=v_canteen_id;
  delete from public.menu_prices where canteen_id=v_canteen_id;
  delete from public.menu_categories where canteen_id=v_canteen_id;
  delete from public.notifications where canteen_id=v_canteen_id;
  delete from public.employee_adjustments where canteen_id=v_canteen_id;
  delete from public.expenses where canteen_id=v_canteen_id;
  delete from public.payments where canteen_id=v_canteen_id;
  delete from public.order_items where canteen_id=v_canteen_id;
  delete from public.orders where canteen_id=v_canteen_id;
  delete from public.daily_menu where canteen_id=v_canteen_id;
  delete from public.holiday_dates where canteen_id=v_canteen_id;
  delete from public.holiday_settings where canteen_id=v_canteen_id;
  delete from public.holidays where canteen_id=v_canteen_id;
  delete from public.order_window_settings where canteen_id=v_canteen_id;
  delete from public.payment_settings where canteen_id=v_canteen_id;
  delete from public.admin_permissions where canteen_id=v_canteen_id;
  delete from public.admin_audit_log where canteen_id=v_canteen_id;
  delete from public.profiles where canteen_id=v_canteen_id;

  delete from public.canteens where id=v_canteen_id and owner_id=v_uid;

  if not found then
    raise exception 'Canteen deletion failed.';
  end if;

  return jsonb_build_object(
    'deleted',true,
    'canteen_id',v_canteen_id,
    'canteen_name',v_canteen_name
  );
end;
$function$;
