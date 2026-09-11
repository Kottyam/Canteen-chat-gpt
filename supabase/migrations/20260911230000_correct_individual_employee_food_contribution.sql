-- Correct employee-food contribution at individual order-item level.
-- 0% preserves the existing full gross payable behavior.
-- No historical rows are rewritten by this migration.
create or replace function public.recalculate_employee_food_contribution_for_order(p_order_id uuid)
returns void language plpgsql security definer set search_path='public' as $$
declare
  v_percentage numeric:=0;
  v_employee numeric:=0;
  v_gross numeric:=0;
  v_company numeric:=0;
  r record;
begin
  select coalesce(employee_contribution_percentage,0) into v_percentage from public.orders where id=p_order_id;
  v_percentage:=least(100,greatest(0,v_percentage));
  if v_percentage=0 then
    select coalesce(sum(coalesce(oi.line_total,oi.quantity*oi.unit_price)),0) into v_gross from public.order_items oi where oi.order_id=p_order_id and oi.item_source<>'guest';
    v_employee:=round(v_gross,2); v_company:=0;
  else
    for r in select coalesce(oi.line_total,oi.quantity*oi.unit_price) as gross from public.order_items oi where oi.order_id=p_order_id and oi.item_source<>'guest' loop
      v_gross:=v_gross+greatest(coalesce(r.gross,0),0);
      v_employee:=v_employee+round(greatest(coalesce(r.gross,0),0)*v_percentage/100,2);
    end loop;
    v_employee:=round(v_employee,2); v_company:=round(greatest(v_gross-v_employee,0),2);
  end if;
  update public.orders set employee_food_amount=v_employee,company_food_amount=v_company where id=p_order_id;
end;
$$;

-- Revenue contribution consumes each order's payable amount once. When the
-- persisted amount is absent, the fallback calculates each order-item amount
-- individually before aggregation.
create or replace function public.get_monthly_revenue_contribution_report(p_year integer,p_month integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_report jsonb; v_canteen uuid; v_gross numeric:=0; v_employee numeric:=0; v_company numeric:=0; v_adj_gross numeric:=0; v_adj_employee numeric:=0;
  v_month_start date:=make_date(p_year,p_month,1); v_month_end date:=(make_date(p_year,p_month,1)+interval '1 month');
begin
  v_report:=public.get_monthly_revenue_report(p_year,p_month); v_canteen:=public.current_canteen_id(); if v_canteen is null then raise exception 'Canteen context required'; end if;
  select coalesce(sum(q.gross_amount),0),coalesce(sum(q.employee_amount),0) into v_gross,v_employee
  from (
    select o.id,
      coalesce(sum(coalesce(oi.line_total,oi.quantity*oi.unit_price)),0) as gross_amount,
      coalesce(max(o.employee_food_amount),coalesce(sum(case when coalesce(o.employee_contribution_percentage,0)=0 then coalesce(oi.line_total,oi.quantity*oi.unit_price) else round(greatest(coalesce(oi.line_total,oi.quantity*oi.unit_price),0)*o.employee_contribution_percentage/100,2) end),0)) as employee_amount
    from public.orders o join public.order_items oi on oi.order_id=o.id
    where o.canteen_id=v_canteen and o.ordered_for>=v_month_start and o.ordered_for<v_month_end and coalesce(o.status,'')<>'cancelled' and oi.canteen_id=v_canteen and oi.item_source<>'guest'
    group by o.id
  ) q;
  select coalesce(sum(case when coalesce(a.contribution_eligible,false) then greatest(coalesce(a.amount,0),0) else 0 end),0),coalesce(sum(case when coalesce(a.contribution_eligible,false) then greatest(coalesce(a.employee_food_amount,a.amount),0) else 0 end),0) into v_adj_gross,v_adj_employee
  from public.employee_adjustments a where a.canteen_id=v_canteen and a.adjustment_date>=v_month_start and a.adjustment_date<v_month_end;
  v_gross:=v_gross+v_adj_gross; v_employee:=v_employee+v_adj_employee; v_company:=greatest(v_gross-v_employee,0);
  return v_report||jsonb_build_object('gross_food_revenue',v_gross,'employee_food_revenue',v_employee,'company_food_revenue',v_company,'contribution_enabled',(exists(select 1 from public.orders o where o.canteen_id=v_canteen and o.ordered_for>=v_month_start and o.ordered_for<v_month_end and coalesce(o.employee_contribution_percentage,0)>0) or exists(select 1 from public.employee_adjustments a where a.canteen_id=v_canteen and a.adjustment_date>=v_month_start and a.adjustment_date<v_month_end and coalesce(a.contribution_eligible,false) and coalesce(a.contribution_percentage,0)>0)));
end;
$$;
revoke all on function public.recalculate_employee_food_contribution_for_order(uuid) from public;
revoke all on function public.get_monthly_revenue_contribution_report(integer,integer) from public;
grant execute on function public.recalculate_employee_food_contribution_for_order(uuid) to authenticated;
grant execute on function public.get_monthly_revenue_contribution_report(integer,integer) to authenticated;
notify pgrst,'reload schema';
