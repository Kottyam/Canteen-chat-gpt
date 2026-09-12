-- Correct the existing Percentage business rule: 0% means the member pays
-- the full eligible gross amount; company contribution is 0.
-- No historical transaction snapshots are rewritten here.

create or replace function public.recalculate_employee_month_contributions(p_employee_id uuid,p_canteen_id uuid,p_month_start date)
returns void language plpgsql security definer set search_path='public' as $$
declare r record;v_cumulative numeric:=0;v_company numeric;v_employee numeric;v_gross numeric;v_fixed numeric;v_pct numeric;v_mode text;
begin
 perform pg_advisory_xact_lock(hashtextextended(coalesce(p_employee_id::text,'')||':'||coalesce(p_month_start::text,''),0));
 for r in with tx as (
   select o.id::text tx_id,'order' tx_kind,o.ordered_for tx_date,o.created_at tx_time,coalesce(sum(case when oi.item_source<>'guest' then greatest(coalesce(oi.line_total,oi.quantity*oi.unit_price),0) else 0 end),0) gross_amount,o.employee_contribution_mode mode,o.employee_contribution_percentage pct,o.fixed_monthly_amount fixed_amount
   from public.orders o left join public.order_items oi on oi.order_id=o.id where o.employee_id=p_employee_id and o.canteen_id=p_canteen_id and o.status='active' and o.ordered_for>=p_month_start and o.ordered_for<(p_month_start+interval '1 month')::date group by o.id,o.ordered_for,o.created_at,o.employee_contribution_mode,o.employee_contribution_percentage,o.fixed_monthly_amount
   union all
   select a.id::text,'adjustment',a.adjustment_date,a.created_at,greatest(coalesce(a.amount,0),0),a.contribution_mode,a.contribution_percentage,a.fixed_monthly_amount
   from public.employee_adjustments a where a.employee_id=p_employee_id and a.canteen_id=p_canteen_id and a.contribution_eligible and a.adjustment_date>=p_month_start and a.adjustment_date<(p_month_start+interval '1 month')::date
 ) select * from tx order by tx_date,tx_time,tx_kind,tx_id loop
   v_gross:=greatest(coalesce(r.gross_amount,0),0); v_mode:=coalesce(r.mode,'percentage'); v_pct:=least(100,greatest(0,coalesce(r.pct,0))); v_fixed:=greatest(0,coalesce(r.fixed_amount,0));
   if v_mode='fixed_amount' then
     v_company:=least(v_gross,greatest(0,v_fixed-v_cumulative));
     v_employee:=greatest(0,v_gross-v_company);
   elsif v_pct=0 then
     v_employee:=v_gross;
     v_company:=0;
   else
     v_employee:=round(v_gross*v_pct/100,2);
     v_company:=greatest(0,round(v_gross-v_employee,2));
   end if;
   if r.tx_kind='order' then update public.orders set employee_food_amount=round(v_employee,2),company_food_amount=round(v_company,2) where id=r.tx_id::uuid; else update public.employee_adjustments set employee_food_amount=round(v_employee,2),company_food_amount=round(v_company,2) where id=r.tx_id::uuid; end if;
   v_cumulative:=v_cumulative+v_gross;
 end loop;
end;$$;
revoke all on function public.recalculate_employee_month_contributions(uuid,uuid,date) from public; grant execute on function public.recalculate_employee_month_contributions(uuid,uuid,date) to authenticated;

create or replace function public.get_employee_food_contribution_preview(p_employee_id uuid,p_gross_amount numeric,p_order_date date default current_date)
returns jsonb language plpgsql security definer set search_path='public' as $$
declare v_canteen uuid;v_employee uuid;v_mode text;v_pct numeric;v_fixed numeric;v_gross numeric;v_previous numeric:=0;v_company numeric;v_employee_payable numeric;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 v_canteen:=public.current_canteen_id(); if v_canteen is null then raise exception 'Canteen context required'; end if;
 select id into v_employee from public.profiles where id=coalesce(p_employee_id,auth.uid()) and role='employee' and status<>'deleted' and canteen_id=v_canteen;
 if v_employee is null then raise exception 'Employee not found in current canteen'; end if;
 if auth.uid()<>v_employee and not public.has_admin_permission('payments') and not public.has_admin_permission('orders') then raise exception 'Not authorized'; end if;
 select contribution_mode,employee_contribution_percentage,fixed_monthly_amount into v_mode,v_pct,v_fixed from public.employee_food_contribution_setting_for_employee(v_employee) limit 1;
 v_gross:=round(greatest(coalesce(p_gross_amount,0),0),2);
 select coalesce(sum(gross_amount),0) into v_previous from (select o.id,coalesce(sum(case when oi.item_source<>'guest' then greatest(coalesce(oi.line_total,oi.quantity*oi.unit_price),0) else 0 end),0) gross_amount from public.orders o left join public.order_items oi on oi.order_id=o.id where o.employee_id=v_employee and o.canteen_id=v_canteen and o.status='active' and o.ordered_for>=date_trunc('month',p_order_date)::date and o.ordered_for<=p_order_date group by o.id union all select a.id,greatest(coalesce(a.amount,0),0) from public.employee_adjustments a where a.employee_id=v_employee and a.canteen_id=v_canteen and a.contribution_eligible and a.adjustment_date>=date_trunc('month',p_order_date)::date and a.adjustment_date<=p_order_date) q;
 if v_mode='fixed_amount' then
   v_company:=least(v_gross,greatest(0,coalesce(v_fixed,0)-v_previous));
   v_employee_payable:=greatest(0,v_gross-v_company);
 elsif coalesce(v_pct,0)=0 then
   v_employee_payable:=v_gross;
   v_company:=0;
 else
   v_employee_payable:=round(v_gross*least(100,greatest(0,coalesce(v_pct,0)))/100,2);
   v_company:=greatest(0,round(v_gross-v_employee_payable,2));
 end if;
 return jsonb_build_object('contribution_mode',coalesce(v_mode,'percentage'),'employee_contribution_percentage',coalesce(v_pct,0),'fixed_monthly_amount',coalesce(v_fixed,0),'previous_eligible_gross',v_previous,'gross_amount',v_gross,'company_amount',v_company,'employee_amount',v_employee_payable,'remaining_allowance_before',greatest(0,coalesce(v_fixed,0)-v_previous));
end;$$;
revoke all on function public.get_employee_food_contribution_preview(uuid,numeric,date) from public; grant execute on function public.get_employee_food_contribution_preview(uuid,numeric,date) to authenticated;
notify pgrst,'reload schema';
