-- Fix PL/pgSQL ambiguity in the admin individual contribution override RPC.
-- The RETURNS TABLE output parameter contribution_mode is also a PL/pgSQL variable.
-- Qualify the table column so the RPC keeps the exact same public signature and behavior.

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
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_canteen uuid;
  v_mode text;
  v_pct numeric;
  v_fixed numeric;
  v_old_mode text;
  v_old_fixed numeric;
  v_setting_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.has_admin_permission('payments') then raise exception 'Settings permission required'; end if;
  v_canteen:=public.current_canteen_id(); if v_canteen is null then raise exception 'Canteen context required'; end if;
  if public.employee_food_contribution_setting_locked() then raise exception 'Employee Food Contribution is locked while Order Time is open.'; end if;

  v_mode:=lower(coalesce(p_mode,'percentage')); if v_mode not in ('percentage','fixed_amount') then raise exception 'Contribution mode must be Percentage or Fixed Amount'; end if;
  v_pct:=round(coalesce(p_percentage,0),2); v_fixed:=round(coalesce(p_fixed_monthly_amount,0),2);
  if v_mode='percentage' and (v_pct<0 or v_pct>100) then raise exception 'Member contribution must be between 0 and 100 percent'; end if;
  if v_mode='fixed_amount' and v_fixed<0 then raise exception 'Fixed monthly amount must be zero or greater'; end if;

  if p_employee_id is null then
    select s.contribution_mode,s.fixed_monthly_amount,s.id
      into v_old_mode,v_old_fixed,v_setting_id
      from public.employee_food_arrangement_settings s
      where s.canteen_id=v_canteen and s.employee_id is null;

    insert into public.employee_food_arrangement_settings(
      canteen_id,employee_id,employee_contribution_percentage,fixed_monthly_amount,contribution_mode,updated_by,updated_at
    )
    values(
      v_canteen,null,case when v_mode='percentage' then v_pct else 0 end,
      case when v_mode='fixed_amount' then v_fixed else 0 end,v_mode,auth.uid(),now()
    )
    on conflict(canteen_id) where employee_id is null do update set
      employee_contribution_percentage=excluded.employee_contribution_percentage,
      fixed_monthly_amount=excluded.fixed_monthly_amount,
      contribution_mode=excluded.contribution_mode,
      updated_by=excluded.updated_by,
      updated_at=now()
    returning id into v_setting_id;

    if v_mode='fixed_amount' and (coalesce(v_old_mode,'percentage')<>'fixed_amount' or round(coalesce(v_old_fixed,0),2)<>v_fixed) then
      insert into private.employee_food_fixed_allocations(
        employee_id,canteen_id,calendar_month,allocation_amount,effective_at,source,source_setting_id,created_by
      )
      select p.id,v_canteen,date_trunc('month',current_date)::date,v_fixed,clock_timestamp(),'global_setting',v_setting_id,auth.uid()
      from public.profiles p
      left join public.employee_food_arrangement_settings s
        on s.canteen_id=v_canteen and s.employee_id=p.id
      where p.role='employee' and p.status='active' and p.canteen_id=v_canteen and s.id is null;
    end if;

    return query
      select v_mode,
             case when v_mode='percentage' then v_pct else 0 end,
             case when v_mode='fixed_amount' then v_fixed else 0 end,
             false;
    return;
  end if;

  if not exists(
    select 1 from public.profiles p
    where p.id=p_employee_id and p.role='employee' and p.status<>'deleted' and p.canteen_id=v_canteen
  ) then
    raise exception 'Employee not found in current canteen';
  end if;

  select s.contribution_mode,s.fixed_monthly_amount,s.id
    into v_old_mode,v_old_fixed,v_setting_id
    from public.employee_food_arrangement_settings s
    where s.canteen_id=v_canteen and s.employee_id=p_employee_id;

  insert into public.employee_food_arrangement_settings(
    canteen_id,employee_id,employee_contribution_percentage,fixed_monthly_amount,contribution_mode,updated_by,updated_at
  )
  values(
    v_canteen,p_employee_id,case when v_mode='percentage' then v_pct else 0 end,
    case when v_mode='fixed_amount' then v_fixed else 0 end,v_mode,auth.uid(),now()
  )
  on conflict(canteen_id,employee_id) where employee_id is not null do update set
    employee_contribution_percentage=excluded.employee_contribution_percentage,
    fixed_monthly_amount=excluded.fixed_monthly_amount,
    contribution_mode=excluded.contribution_mode,
    updated_by=excluded.updated_by,
    updated_at=now()
  returning id into v_setting_id;

  if v_mode='fixed_amount' and (coalesce(v_old_mode,'percentage')<>'fixed_amount' or round(coalesce(v_old_fixed,0),2)<>v_fixed) then
    insert into private.employee_food_fixed_allocations(
      employee_id,canteen_id,calendar_month,allocation_amount,effective_at,source,source_setting_id,created_by
    )
    values(
      p_employee_id,v_canteen,date_trunc('month',current_date)::date,v_fixed,clock_timestamp(),'employee_setting',v_setting_id,auth.uid()
    );
  end if;

  return query
    select v_mode,
           case when v_mode='percentage' then v_pct else 0 end,
           case when v_mode='fixed_amount' then v_fixed else 0 end,
           true;
end;
$function$;
