create or replace function public.recalculate_employee_month_contributions(p_employee_id uuid,p_canteen_id uuid,p_month_start date)
returns void language plpgsql security definer set search_path='public' as $$
declare
  r record;
  v_cumulative numeric:=0;
  v_company numeric;
  v_employee numeric;
  v_gross numeric;
  v_fixed numeric;
  v_pct numeric;
  v_mode text;
begin
  perform pg_advisory_xact_lock(hashtextextended(coalesce(p_employee_id::text,'')||':'||coalesce(p_month_start::text,''),0));

  for r in with tx as (
    select o.id::text tx_id,'order' tx_kind,o.ordered_for tx_date,o.created_at tx_time,
      coalesce(sum(case when oi.item_source<>'guest' then greatest(coalesce(oi.line_total,oi.quantity*oi.unit_price),0) else 0 end),0) gross_amount,
      o.employee_contribution_mode mode,o.employee_contribution_percentage pct,o.fixed_monthly_amount fixed_amount
    from public.orders o
    left join public.order_items oi on oi.order_id=o.id
    where o.employee_id=p_employee_id
      and o.canteen_id=p_canteen_id
      and o.status='active'
      and o.ordered_for>=p_month_start
      and o.ordered_for<(p_month_start+interval '1 month')::date
    group by o.id,o.ordered_for,o.created_at,o.employee_contribution_mode,o.employee_contribution_percentage,o.fixed_monthly_amount

    union all

    select a.id::text,'adjustment',a.adjustment_date,a.created_at,
      greatest(coalesce(a.amount,0),0),
      a.contribution_mode,a.contribution_percentage,a.fixed_monthly_amount
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
      set employee_food_amount=round(v_employee,2),company_food_amount=round(v_company,2)
      where id=r.tx_id::uuid;
    else
      update public.employee_adjustments
      set employee_food_amount=round(v_employee,2),company_food_amount=round(v_company,2)
      where id=r.tx_id::uuid;
    end if;

    v_cumulative:=v_cumulative+v_gross;
  end loop;
end;
$$;

revoke all on function public.recalculate_employee_month_contributions(uuid,uuid,date) from public;
grant execute on function public.recalculate_employee_month_contributions(uuid,uuid,date) to authenticated;
notify pgrst,'reload schema';
