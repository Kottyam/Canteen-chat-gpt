create or replace function public.get_monthly_revenue_contribution_report(p_year integer,p_month integer)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_report jsonb;v_canteen uuid;v_gross numeric:=0;v_employee numeric:=0;v_company numeric:=0;
begin
  v_report:=public.get_monthly_revenue_report(p_year,p_month);
  v_canteen:=public.current_canteen_id();
  if v_canteen is null then raise exception 'Canteen context required';end if;
  select coalesce(sum(coalesce(oi.line_total,oi.quantity*oi.unit_price)),0),coalesce(sum(coalesce(o.employee_food_amount,coalesce(oi.line_total,oi.quantity*oi.unit_price))),0) into v_gross,v_employee
  from public.orders o join public.order_items oi on oi.order_id=o.id
  where o.canteen_id=v_canteen and o.ordered_for>=make_date(p_year,p_month,1) and o.ordered_for<(make_date(p_year,p_month,1)+interval '1 month') and coalesce(o.status,'')<>'cancelled' and oi.canteen_id=v_canteen and oi.item_source<>'guest';
  v_company:=greatest(v_gross-v_employee,0);
  return v_report||jsonb_build_object('gross_food_revenue',v_gross,'employee_food_revenue',v_employee,'company_food_revenue',v_company);
end;
$$;
revoke all on function public.get_monthly_revenue_contribution_report(integer,integer) from public;
grant execute on function public.get_monthly_revenue_contribution_report(integer,integer) to authenticated;
notify pgrst,'reload schema';
