-- Restore the Revenue contribution RPC that is required by the existing Revenue PDF flow.
-- The migration ledger contains earlier contribution-report migrations, but the live
-- public function is missing. Keep the existing accounting/report architecture and
-- restore the exact integer/integer signature expected by the client.
create or replace function public.get_monthly_revenue_contribution_report(p_year integer,p_month integer)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_report jsonb;
  v_canteen uuid;
  v_month_start date;
  v_month_end date;
  v_gross numeric:=0;
  v_employee numeric:=0;
  v_company numeric:=0;
  v_adj_gross numeric:=0;
  v_adj_employee numeric:=0;
  v_employee_rows jsonb:='[]'::jsonb;
begin
  if not public.has_admin_permission('revenue') then
    raise exception 'Revenue permission required';
  end if;
  if p_month<1 or p_month>12 then raise exception 'Invalid month'; end if;
  v_canteen:=public.current_canteen_id();
  if v_canteen is null then raise exception 'Canteen context required'; end if;
  v_month_start:=make_date(p_year,p_month,1);
  v_month_end:=(v_month_start+interval '1 month')::date;
  v_report:=public.get_monthly_revenue_report(p_year,p_month);

  with order_rows as (
    select o.id,o.employee_id,
      coalesce(sum(coalesce(oi.line_total,oi.quantity*oi.unit_price)),0) as gross_amount,
      coalesce(max(o.employee_food_amount),coalesce(sum(case when coalesce(o.employee_contribution_percentage,0)=0 then coalesce(oi.line_total,oi.quantity*oi.unit_price) else round(greatest(coalesce(oi.line_total,oi.quantity*oi.unit_price),0)*o.employee_contribution_percentage/100,2) end),0)) as employee_amount
    from public.orders o
    join public.order_items oi on oi.order_id=o.id
    where o.canteen_id=v_canteen and o.ordered_for>=v_month_start and o.ordered_for<v_month_end
      and coalesce(o.status,'')<>'cancelled' and oi.canteen_id=v_canteen and oi.item_source<>'guest'
    group by o.id,o.employee_id
  ), adj_rows as (
    select a.employee_id,
      greatest(coalesce(a.amount,0),0) as gross_amount,
      greatest(coalesce(a.employee_food_amount,a.amount),0) as employee_amount
    from public.employee_adjustments a
    where a.canteen_id=v_canteen and a.adjustment_date>=v_month_start and a.adjustment_date<v_month_end
      and coalesce(a.contribution_eligible,false)
  ), employee_rows as (
    select p.id employee_id,p.full_name,
      coalesce(sum(x.gross_amount),0) gross_amount,
      coalesce(sum(x.employee_amount),0) employee_amount,
      greatest(coalesce(sum(x.gross_amount),0)-coalesce(sum(x.employee_amount),0),0) company_amount
    from public.profiles p
    left join (
      select employee_id,gross_amount,employee_amount from order_rows
      union all
      select employee_id,gross_amount,employee_amount from adj_rows
    ) x on x.employee_id=p.id
    where p.role='employee' and p.status<>'deleted' and p.canteen_id=v_canteen
    group by p.id,p.full_name
    having coalesce(sum(x.gross_amount),0)>0
  )
  select coalesce(sum(gross_amount),0),coalesce(sum(employee_amount),0),
    coalesce(jsonb_agg(jsonb_build_object('employee_id',employee_id,'employee_name',full_name,'gross_eligible_food',gross_amount,'company_contribution',company_amount,'employee_payable',employee_amount) order by full_name),'[]'::jsonb)
  into v_gross,v_employee,v_employee_rows
  from employee_rows;

  select coalesce(sum(greatest(coalesce(a.amount,0),0)),0),
         coalesce(sum(greatest(coalesce(a.employee_food_amount,a.amount),0)),0)
  into v_adj_gross,v_adj_employee
  from public.employee_adjustments a
  where a.canteen_id=v_canteen and a.adjustment_date>=v_month_start and a.adjustment_date<v_month_end
    and coalesce(a.contribution_eligible,false);

  v_company:=greatest(v_gross-v_employee,0);
  return v_report || jsonb_build_object(
    'gross_food_revenue',v_gross,
    'employee_food_revenue',v_employee,
    'company_food_revenue',v_company,
    'contribution_enabled',(v_company>0 or exists(select 1 from public.employee_adjustments a where a.canteen_id=v_canteen and a.adjustment_date>=v_month_start and a.adjustment_date<v_month_end and coalesce(a.contribution_eligible,false)) or exists(select 1 from public.orders o where o.canteen_id=v_canteen and o.ordered_for>=v_month_start and o.ordered_for<v_month_end and coalesce(o.employee_contribution_percentage,0)>0)),
    'employee_contributions',v_employee_rows
  );
end;
$$;

revoke all on function public.get_monthly_revenue_contribution_report(integer,integer) from public;
grant execute on function public.get_monthly_revenue_contribution_report(integer,integer) to authenticated;
notify pgrst,'reload schema';
