-- Finance reporting correction: keep overall revenue totals unchanged while exposing
-- complete member-wise gross eligible value, company contribution and payable.
-- This is reporting-source correction only; billing/order/contribution calculations
-- remain unchanged.

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
    select
      o.id,
      o.employee_id,
      coalesce(sum(case when oi.item_source<>'guest' then coalesce(oi.line_total,oi.quantity*oi.unit_price) else 0 end),0) as member_gross,
      coalesce(max(o.employee_food_amount),
        sum(case when oi.item_source<>'guest' then coalesce(oi.line_total,oi.quantity*oi.unit_price) else 0 end)
      ) as employee_amount,
      coalesce(sum(case when oi.item_source='guest' then coalesce(oi.line_total,oi.quantity*oi.unit_price) else 0 end),0) as guest_amount,
      coalesce(max(o.company_food_amount),0) as order_company_amount
    from public.orders o
    join public.order_items oi on oi.order_id=o.id
    where o.canteen_id=v_canteen
      and o.ordered_for>=v_month_start
      and o.ordered_for<v_month_end
      and coalesce(o.status,'')<>'cancelled'
      and oi.canteen_id=v_canteen
    group by o.id,o.employee_id
  ),
  adj_rows as (
    select
      a.employee_id,
      greatest(coalesce(a.amount,0),0) as gross_amount,
      greatest(coalesce(a.employee_food_amount,a.amount),0) as employee_amount,
      case when coalesce(a.contribution_eligible,false)
        then greatest(coalesce(a.company_food_amount,0),0)
        else 0
      end as company_amount
    from public.employee_adjustments a
    where a.canteen_id=v_canteen
      and a.adjustment_date>=v_month_start
      and a.adjustment_date<v_month_end
  ),
  employee_rows as (
    select
      p.id employee_id,
      p.full_name,
      coalesce(sum(x.member_gross),0) member_gross,
      coalesce(sum(x.guest_amount),0) guest_amount,
      coalesce(sum(x.adj_gross),0) adj_gross,
      coalesce(sum(x.employee_amount),0) employee_amount,
      coalesce(sum(x.order_company_amount),0) order_company_amount,
      coalesce(sum(x.adj_company),0) adj_company
    from public.profiles p
    left join (
      select employee_id,member_gross,guest_amount,0::numeric adj_gross,employee_amount,order_company_amount,0::numeric adj_company
      from order_rows
      union all
      select employee_id,0::numeric,0::numeric,gross_amount,employee_amount,0::numeric,company_amount
      from adj_rows
    ) x on x.employee_id=p.id
    where p.role='employee'
      and p.status<>'deleted'
      and p.canteen_id=v_canteen
    group by p.id,p.full_name
    having coalesce(sum(x.member_gross),0)
         +coalesce(sum(x.guest_amount),0)
         +coalesce(sum(x.adj_gross),0)>0
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'employee_id',employee_id,
        'employee_name',full_name,
        'gross_eligible_food',
          greatest(member_gross+guest_amount+adj_gross,0),
        'company_contribution',
          greatest(order_company_amount+adj_company,0),
        'employee_payable',
          greatest(
            member_gross+guest_amount+adj_gross
            -greatest(order_company_amount+adj_company,0),
            0
          )
      )
      order by full_name
    ),
    '[]'::jsonb
  )
  into v_employee_rows
  from employee_rows;

  with order_rows as (
    select
      o.id,
      coalesce(sum(coalesce(oi.line_total,oi.quantity*oi.unit_price)),0) as gross_amount,
      coalesce(max(o.employee_food_amount),
        sum(coalesce(oi.line_total,oi.quantity*oi.unit_price))
      ) as employee_amount
    from public.orders o
    join public.order_items oi on oi.order_id=o.id
    where o.canteen_id=v_canteen
      and o.ordered_for>=v_month_start
      and o.ordered_for<v_month_end
      and coalesce(o.status,'')<>'cancelled'
      and oi.canteen_id=v_canteen
      and oi.item_source<>'guest'
    group by o.id
  )
  select
    coalesce(sum(gross_amount),0),
    coalesce(sum(employee_amount),0)
  into v_gross,v_employee
  from order_rows;

  v_company:=greatest(v_gross-v_employee,0);

  return v_report || jsonb_build_object(
    'gross_food_revenue',v_gross,
    'employee_food_revenue',v_employee,
    'company_food_revenue',v_company,
    'contribution_enabled',
      (v_company>0
       or exists(
         select 1 from public.employee_adjustments a
         where a.canteen_id=v_canteen
           and a.adjustment_date>=v_month_start
           and a.adjustment_date<v_month_end
           and coalesce(a.contribution_eligible,false)
       )
       or exists(
         select 1 from public.orders o
         where o.canteen_id=v_canteen
           and o.ordered_for>=v_month_start
           and o.ordered_for<v_month_end
           and coalesce(o.employee_contribution_percentage,0)>0
       )),
    'employee_contributions',v_employee_rows
  );
end;
$$;

revoke all on function public.get_monthly_revenue_contribution_report(integer,integer) from public;
grant execute on function public.get_monthly_revenue_contribution_report(integer,integer) to authenticated;
notify pgrst,'reload schema';
