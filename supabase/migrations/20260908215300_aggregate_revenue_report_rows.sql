-- Revenue reporting only: aggregate presentation rows without changing source transactions.
-- Food/guest rows are grouped by business date, actual menu item code/name and source.
-- Quantity is the SUM of stored order-item quantities; amount is the SUM of stored line totals.

create or replace function public.get_monthly_revenue_report(p_year integer,p_month integer)
returns jsonb language plpgsql security definer set search_path to ''
as $$
declare
  v_canteen uuid; v_canteen_name text; v_start date; v_end date;
  v_food numeric := 0; v_guest numeric := 0; v_admin numeric := 0; v_additional numeric := 0; v_expenses numeric := 0;
  v_transactions jsonb; v_expense_rows jsonb;
begin
  if not public.has_admin_permission('revenue') then raise exception 'Revenue permission required'; end if;
  if p_month < 1 or p_month > 12 then raise exception 'Invalid month'; end if;
  v_canteen := public.current_canteen_id();
  if v_canteen is null then raise exception 'Canteen context required'; end if;
  v_start := make_date(p_year,p_month,1); v_end := (v_start + interval '1 month')::date;
  select c.name into v_canteen_name from public.canteens c where c.id=v_canteen;

  select coalesce(sum(case when oi.item_source='guest' then 0 else coalesce(oi.line_total,oi.quantity*oi.unit_price) end),0),
         coalesce(sum(case when oi.item_source='guest' then coalesce(oi.line_total,oi.quantity*oi.unit_price) else 0 end),0)
    into v_food,v_guest
    from public.orders o join public.order_items oi on oi.order_id=o.id
   where o.canteen_id=v_canteen and o.ordered_for>=v_start and o.ordered_for<v_end
     and coalesce(o.status,'')<>'cancelled' and oi.canteen_id=v_canteen;
  select coalesce(sum(a.amount),0) into v_admin from public.employee_adjustments a where a.canteen_id=v_canteen and a.adjustment_date>=v_start and a.adjustment_date<v_end;
  select coalesce(sum(r.amount),0) into v_additional from public.additional_revenues r where r.canteen_id=v_canteen and r.revenue_date>=v_start and r.revenue_date<v_end;
  select coalesce(sum(e.amount),0) into v_expenses from public.expenses e where e.canteen_id=v_canteen and e.expense_date>=v_start and e.expense_date<v_end;

  with food_rows as (
    select o.ordered_for as date,
      coalesce(nullif(oi.item_name,''),'Food Order') as particulars,
      case when oi.item_source='guest' then 'Guest Revenue' else 'Food Revenue' end as type,
      sum(coalesce(oi.quantity,0))::numeric as quantity,
      sum(coalesce(oi.line_total,oi.quantity*oi.unit_price))::numeric as amount,
      case when oi.item_source='guest' then 2 else 1 end as sort_order
    from public.orders o join public.order_items oi on oi.order_id=o.id
    where o.canteen_id=v_canteen and o.ordered_for>=v_start and o.ordered_for<v_end
      and coalesce(o.status,'')<>'cancelled' and oi.canteen_id=v_canteen
    group by o.ordered_for,oi.item_code,coalesce(nullif(oi.item_name,''),'Food Order'),oi.item_source
  ), admin_rows as (
    select a.adjustment_date as date,'Admin Added'::text particulars,'Admin Added'::text type,count(*)::numeric quantity,sum(a.amount)::numeric amount,3 sort_order
    from public.employee_adjustments a where a.canteen_id=v_canteen and a.adjustment_date>=v_start and a.adjustment_date<v_end group by a.adjustment_date
  ), additional_rows as (
    select r.revenue_date as date,coalesce(nullif(r.description,''),'Additional Revenue') particulars,'Additional Revenue'::text type,null::numeric quantity,sum(r.amount)::numeric amount,4 sort_order
    from public.additional_revenues r where r.canteen_id=v_canteen and r.revenue_date>=v_start and r.revenue_date<v_end group by r.revenue_date,coalesce(nullif(r.description,''),'Additional Revenue')
  ), expense_rows as (
    select e.expense_date as date,coalesce(nullif(e.description,''),'Expense') particulars,'Expense'::text type,null::numeric quantity,sum(e.amount)::numeric amount,5 sort_order
    from public.expenses e where e.canteen_id=v_canteen and e.expense_date>=v_start and e.expense_date<v_end group by e.expense_date,coalesce(nullif(e.description,''),'Expense')
  )
  select coalesce(jsonb_agg(jsonb_build_object('date',z.date,'particulars',z.particulars,'quantity',z.quantity,'type',z.type,'amount',z.amount) order by z.date,z.sort_order,z.particulars),'[]'::jsonb) into v_transactions
  from (select * from food_rows union all select * from admin_rows union all select * from additional_rows union all select * from expense_rows) z;

  select coalesce(jsonb_agg(jsonb_build_object('date',e.expense_date,'particulars',coalesce(nullif(e.description,''),'Expense'),'type','Expense','amount',e.amount) order by e.expense_date,e.description),'[]'::jsonb) into v_expense_rows
  from public.expenses e where e.canteen_id=v_canteen and e.expense_date>=v_start and e.expense_date<v_end;

  return jsonb_build_object('canteen_name',coalesce(v_canteen_name,'Go Canteen'),'start_date',v_start,'end_date',(v_end-1),'food_revenue',v_food,'guest_revenue',v_guest,'admin_added_revenue',v_admin,'additional_revenue',v_additional,'total_collection',v_food+v_guest+v_admin+v_additional,'total_expenses',v_expenses,'net_revenue',v_food+v_guest+v_admin+v_additional-v_expenses,'transactions',v_transactions,'expenses',v_expense_rows);
end;
$$;
revoke all on function public.get_monthly_revenue_report(integer,integer) from public;
grant execute on function public.get_monthly_revenue_report(integer,integer) to authenticated;
notify pgrst,'reload schema';