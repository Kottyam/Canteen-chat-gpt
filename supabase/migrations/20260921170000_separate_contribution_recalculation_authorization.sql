-- Separate internal contribution recalculation from administrative authorization.
-- Member order triggers use the private engine; direct administrative calls remain protected.

create schema if not exists private;

create or replace function private.recalculate_employee_month_contributions_internal(
  p_employee_id uuid,
  p_canteen_id uuid,
  p_month_start date
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  r record;
  v_cumulative numeric := 0;
  v_company numeric;
  v_employee numeric;
  v_gross numeric;
  v_fixed numeric;
  v_pct numeric;
  v_mode text;
begin
  if p_employee_id is null or p_canteen_id is null or p_month_start is null then
    raise exception 'Contribution recalculation context required';
  end if;

  if not exists (
    select 1
    from public.profiles p
    where p.id = p_employee_id
      and p.role = 'employee'
      and p.status = 'active'
      and p.canteen_id = p_canteen_id
  ) then
    raise exception 'Employee not found in requested canteen';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      coalesce(p_employee_id::text,'') || ':' || coalesce(p_month_start::text,''),
      0
    )
  );

  for r in
    with tx as (
      select
        o.id::text tx_id,
        'order' tx_kind,
        o.ordered_for tx_date,
        o.created_at tx_time,
        coalesce(sum(
          case
            when oi.item_source <> 'guest'
            then greatest(coalesce(oi.line_total,oi.quantity*oi.unit_price),0)
            else 0
          end
        ),0) gross_amount,
        o.employee_contribution_mode mode,
        o.employee_contribution_percentage pct,
        o.fixed_monthly_amount fixed_amount
      from public.orders o
      left join public.order_items oi on oi.order_id=o.id
      where o.employee_id=p_employee_id
        and o.canteen_id=p_canteen_id
        and o.status='active'
        and o.ordered_for>=p_month_start
        and o.ordered_for<(p_month_start+interval '1 month')::date
      group by
        o.id,o.ordered_for,o.created_at,
        o.employee_contribution_mode,
        o.employee_contribution_percentage,
        o.fixed_monthly_amount

      union all

      select
        a.id::text,
        'adjustment',
        a.adjustment_date,
        a.created_at,
        greatest(coalesce(a.amount,0),0),
        a.contribution_mode,
        a.contribution_percentage,
        a.fixed_monthly_amount
      from public.employee_adjustments a
      where a.employee_id=p_employee_id
        and a.canteen_id=p_canteen_id
        and a.contribution_eligible
        and a.adjustment_date>=p_month_start
        and a.adjustment_date<(p_month_start+interval '1 month')::date
    )
    select * from tx
    order by tx_time,tx_date,tx_kind,tx_id
  loop
    v_gross:=greatest(coalesce(r.gross_amount,0),0);
    v_mode:=coalesce(r.mode,'percentage');
    v_pct:=least(100,greatest(0,coalesce(r.pct,100)));
    v_fixed:=greatest(0,coalesce(r.fixed_amount,0));

    if v_mode='fixed_amount' then
      v_company:=least(v_gross,greatest(0,v_fixed-v_cumulative));
      v_employee:=greatest(0,v_gross-v_company);
    else
      v_employee:=round(v_gross*v_pct/100,2);
      v_company:=greatest(0,round(v_gross-v_employee,2));
    end if;

    if r.tx_kind='order' then
      update public.orders
      set employee_food_amount=round(v_employee,2),
          company_food_amount=round(v_company,2)
      where id=r.tx_id::uuid;
    else
      update public.employee_adjustments
      set employee_food_amount=round(v_employee,2),
          company_food_amount=round(v_company,2)
      where id=r.tx_id::uuid;
    end if;

    v_cumulative:=v_cumulative+v_gross;
  end loop;
end;
$function$;

revoke all on function private.recalculate_employee_month_contributions_internal(uuid,uuid,date)
from public, anon, authenticated;

create or replace function public.recalculate_employee_month_contributions(
  p_employee_id uuid,
  p_canteen_id uuid,
  p_month_start date
)
returns void
language plpgsql
security definer
set search_path = 'public'
as $function$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not public.is_super_admin() then
    if not public.has_admin_permission('payments') then
      raise exception 'Contribution administration permission required';
    end if;

    if p_canteen_id is null or p_canteen_id <> public.current_canteen_id() then
      raise exception 'Canteen authorization mismatch';
    end if;
  end if;

  perform private.recalculate_employee_month_contributions_internal(
    p_employee_id,p_canteen_id,p_month_start
  );
end;
$function$;

revoke all on function public.recalculate_employee_month_contributions(uuid,uuid,date) from public;
grant execute on function public.recalculate_employee_month_contributions(uuid,uuid,date) to authenticated;

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
