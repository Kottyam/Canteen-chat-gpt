-- Employee Food Arrangement admin settings: explicit All Employees default + optional individual overrides.
-- Preserve the existing contribution table/RPC architecture and transaction snapshots.

-- The fixed-amount migration backfilled per-employee rows from the global row. Remove
-- only rows that are exactly identical to the global fallback so they become true
-- "no individual override" rows. Historical order/adjustment snapshots are untouched.
delete from public.employee_food_arrangement_settings s
using public.employee_food_arrangement_settings g
where s.employee_id is not null
  and g.employee_id is null
  and s.canteen_id=g.canteen_id
  and s.contribution_mode=g.contribution_mode
  and coalesce(s.employee_contribution_percentage,0)=coalesce(g.employee_contribution_percentage,0)
  and coalesce(s.fixed_monthly_amount,0)=coalesce(g.fixed_monthly_amount,0);

create or replace function public.get_employee_food_contribution_settings_for_admin_v2()
returns table(
  scope text,
  employee_id uuid,
  employee_name text,
  employee_code text,
  contribution_mode text,
  employee_contribution_percentage numeric,
  fixed_monthly_amount numeric,
  has_individual_override boolean
)
language plpgsql security definer set search_path='public' as $$
declare v_canteen uuid;
begin
  if not public.has_admin_permission('payments') then
    raise exception 'Settings permission required';
  end if;
  v_canteen:=public.current_canteen_id();
  if v_canteen is null then raise exception 'Canteen context required'; end if;

  return query
  select 'all'::text, null::uuid, 'All Employees'::text, null::text,
         g.contribution_mode,
         coalesce(g.employee_contribution_percentage,0),
         coalesce(g.fixed_monthly_amount,0),
         false
  from public.employee_food_arrangement_settings g
  where g.canteen_id=v_canteen and g.employee_id is null

  union all

  select 'employee'::text,
         p.id,
         p.full_name,
         coalesce(p.employee_code,p.sr_number),
         s.contribution_mode,
         coalesce(s.employee_contribution_percentage,0),
         coalesce(s.fixed_monthly_amount,0),
         true
  from public.employee_food_arrangement_settings s
  join public.profiles p on p.id=s.employee_id
  where s.canteen_id=v_canteen
    and s.employee_id is not null
    and p.role='employee'
    and p.status<>'deleted'
    and p.canteen_id=v_canteen
  order by 1,3,2;
end;
$$;
revoke all on function public.get_employee_food_contribution_settings_for_admin_v2() from public;
grant execute on function public.get_employee_food_contribution_settings_for_admin_v2() to authenticated;

create or replace function public.set_employee_food_contribution_setting_for_admin(
  p_employee_id uuid,
  p_mode text,
  p_percentage numeric default 0,
  p_fixed_monthly_amount numeric default 0
)
returns table(
  contribution_mode text,
  employee_contribution_percentage numeric,
  fixed_monthly_amount numeric,
  has_individual_override boolean
)
language plpgsql security definer set search_path='public' as $$
declare v_canteen uuid; v_mode text; v_pct numeric; v_fixed numeric;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.has_admin_permission('payments') then raise exception 'Settings permission required'; end if;
  v_canteen:=public.current_canteen_id();
  if v_canteen is null then raise exception 'Canteen context required'; end if;
  if public.employee_food_contribution_setting_locked() then
    raise exception 'Employee Food Contribution is locked while Order Time is open.';
  end if;

  v_mode:=lower(coalesce(p_mode,'percentage'));
  if v_mode not in ('percentage','fixed_amount') then
    raise exception 'Contribution mode must be Percentage or Fixed Amount';
  end if;
  v_pct:=round(coalesce(p_percentage,0),2);
  v_fixed:=round(coalesce(p_fixed_monthly_amount,0),2);
  if v_mode='percentage' and (v_pct<0 or v_pct>100) then
    raise exception 'Member contribution must be between 0 and 100 percent';
  end if;
  if v_mode='fixed_amount' and v_fixed<0 then
    raise exception 'Fixed monthly amount must be zero or greater';
  end if;

  if p_employee_id is null then
    insert into public.employee_food_arrangement_settings(
      canteen_id,employee_id,employee_contribution_percentage,fixed_monthly_amount,
      contribution_mode,updated_by,updated_at
    ) values(
      v_canteen,null,
      case when v_mode='percentage' then v_pct else 0 end,
      case when v_mode='fixed_amount' then v_fixed else 0 end,
      v_mode,auth.uid(),now()
    )
    on conflict(canteen_id) where employee_id is null do update set
      employee_contribution_percentage=excluded.employee_contribution_percentage,
      fixed_monthly_amount=excluded.fixed_monthly_amount,
      contribution_mode=excluded.contribution_mode,
      updated_by=excluded.updated_by,
      updated_at=now();

    return query select v_mode,
      case when v_mode='percentage' then v_pct else 0 end,
      case when v_mode='fixed_amount' then v_fixed else 0 end,
      false;
    return;
  end if;

  if not exists(
    select 1 from public.profiles p
    where p.id=p_employee_id and p.role='employee' and p.status<>'deleted' and p.canteen_id=v_canteen
  ) then raise exception 'Employee not found in current canteen'; end if;

  insert into public.employee_food_arrangement_settings(
    canteen_id,employee_id,employee_contribution_percentage,fixed_monthly_amount,
    contribution_mode,updated_by,updated_at
  ) values(
    v_canteen,p_employee_id,
    case when v_mode='percentage' then v_pct else 0 end,
    case when v_mode='fixed_amount' then v_fixed else 0 end,
    v_mode,auth.uid(),now()
  )
  on conflict(canteen_id,employee_id) where employee_id is not null do update set
    employee_contribution_percentage=excluded.employee_contribution_percentage,
    fixed_monthly_amount=excluded.fixed_monthly_amount,
    contribution_mode=excluded.contribution_mode,
    updated_by=excluded.updated_by,
    updated_at=now();

  return query select v_mode,
    case when v_mode='percentage' then v_pct else 0 end,
    case when v_mode='fixed_amount' then v_fixed else 0 end,
    true;
end;
$$;
revoke all on function public.set_employee_food_contribution_setting_for_admin(uuid,text,numeric,numeric) from public;
grant execute on function public.set_employee_food_contribution_setting_for_admin(uuid,text,numeric,numeric) to authenticated;

create or replace function public.clear_employee_food_contribution_override(p_employee_id uuid)
returns boolean
language plpgsql security definer set search_path='public' as $$
declare v_canteen uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.has_admin_permission('payments') then raise exception 'Settings permission required'; end if;
  v_canteen:=public.current_canteen_id();
  if v_canteen is null then raise exception 'Canteen context required'; end if;
  if public.employee_food_contribution_setting_locked() then
    raise exception 'Employee Food Contribution is locked while Order Time is open.';
  end if;
  if p_employee_id is null then raise exception 'Employee is required'; end if;
  if not exists(
    select 1 from public.profiles p
    where p.id=p_employee_id and p.role='employee' and p.status<>'deleted' and p.canteen_id=v_canteen
  ) then raise exception 'Employee not found in current canteen'; end if;
  delete from public.employee_food_arrangement_settings
  where canteen_id=v_canteen and employee_id=p_employee_id;
  return true;
end;
$$;
revoke all on function public.clear_employee_food_contribution_override(uuid) from public;
grant execute on function public.clear_employee_food_contribution_override(uuid) to authenticated;

notify pgrst,'reload schema';
