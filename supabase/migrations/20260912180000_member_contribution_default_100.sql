-- Correct the distinction between an unconfigured arrangement and an explicit
-- Percentage 0% arrangement.
-- Unconfigured => Member 100% / Company 0%.
-- Explicit Percentage 0% => Member 0% / Company 100%.

create or replace function public.employee_food_contribution_setting_for_employee(p_employee_id uuid)
returns table(contribution_mode text,employee_contribution_percentage numeric,fixed_monthly_amount numeric)
language plpgsql security definer set search_path='public' as $$
declare v_canteen uuid;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 v_canteen:=public.current_canteen_id(); if v_canteen is null then raise exception 'Canteen context required'; end if;
 if p_employee_id is null then raise exception 'Employee required'; end if;
 if auth.uid()<>p_employee_id and not public.has_admin_permission('payments') and not public.has_admin_permission('orders') then raise exception 'Not authorized'; end if;
 return query select coalesce(s.contribution_mode,g.contribution_mode,'percentage'),coalesce(s.employee_contribution_percentage,g.employee_contribution_percentage,100),coalesce(s.fixed_monthly_amount,g.fixed_monthly_amount,0)
 from public.profiles p left join public.employee_food_arrangement_settings s on s.canteen_id=v_canteen and s.employee_id=p.id left join public.employee_food_arrangement_settings g on g.canteen_id=v_canteen and g.employee_id is null
 where p.id=p_employee_id and p.role='employee' and p.status<>'deleted' and p.canteen_id=v_canteen;
end;$$;
revoke all on function public.employee_food_contribution_setting_for_employee(uuid) from public; grant execute on function public.employee_food_contribution_setting_for_employee(uuid) to authenticated;

create or replace function public.get_employee_food_contribution_settings_for_admin()
returns table(employee_id uuid,employee_name text,employee_code text,contribution_mode text,employee_contribution_percentage numeric,fixed_monthly_amount numeric)
language plpgsql security definer set search_path='public' as $$
declare v_canteen uuid;
begin
 if not public.has_admin_permission('payments') then raise exception 'Settings permission required'; end if;
 v_canteen:=public.current_canteen_id(); if v_canteen is null then raise exception 'Canteen context required'; end if;
 return query select p.id,p.full_name,coalesce(p.employee_code,p.sr_number),coalesce(s.contribution_mode,g.contribution_mode,'percentage'),coalesce(s.employee_contribution_percentage,g.employee_contribution_percentage,100),coalesce(s.fixed_monthly_amount,g.fixed_monthly_amount,0)
 from public.profiles p left join public.employee_food_arrangement_settings s on s.canteen_id=v_canteen and s.employee_id=p.id left join public.employee_food_arrangement_settings g on g.canteen_id=v_canteen and g.employee_id is null
 where p.role='employee' and p.status<>'deleted' and p.canteen_id=v_canteen order by p.full_name,p.id;
end;$$;
revoke all on function public.get_employee_food_contribution_settings_for_admin() from public; grant execute on function public.get_employee_food_contribution_settings_for_admin() to authenticated;

create or replace function public.get_employee_food_contribution_percentage()
returns numeric language plpgsql security definer set search_path='public' as $$
declare v_canteen uuid;v_percentage numeric;v_employee uuid;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 v_canteen:=public.current_canteen_id(); if v_canteen is null then raise exception 'Canteen context required'; end if;
 select id into v_employee from public.profiles where id=auth.uid() and role='employee' and status<>'deleted' and canteen_id=v_canteen;
 if v_employee is not null then select employee_contribution_percentage into v_percentage from public.employee_food_arrangement_settings where canteen_id=v_canteen and employee_id=v_employee; end if;
 if v_percentage is null then select employee_contribution_percentage into v_percentage from public.employee_food_arrangement_settings where canteen_id=v_canteen and employee_id is null; end if;
 return coalesce(v_percentage,100);
end;$$;
revoke all on function public.get_employee_food_contribution_percentage() from public; grant execute on function public.get_employee_food_contribution_percentage() to authenticated;

create or replace function public.set_employee_food_contribution_percentage(p_percentage numeric)
returns numeric language plpgsql security definer set search_path='public' as $$
declare v_canteen uuid;v_employee uuid;v_pct numeric;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if; v_canteen:=public.current_canteen_id(); if v_canteen is null then raise exception 'Canteen context required'; end if;
 v_pct:=round(coalesce(p_percentage,100),2); if v_pct<0 or v_pct>100 then raise exception 'Member contribution must be between 0 and 100 percent'; end if;
 select id into v_employee from public.profiles where id=auth.uid() and role='employee' and status<>'deleted' and canteen_id=v_canteen;
 if v_employee is not null then perform public.set_employee_food_contribution_settings(v_employee,'percentage',v_pct,0); return v_pct; end if;
 if not public.has_admin_permission('payments') then raise exception 'Settings permission required'; end if;
 if public.employee_food_contribution_setting_locked() then raise exception 'Employee Food Contribution is locked while Order Time is open.'; end if;
 insert into public.employee_food_arrangement_settings(canteen_id,employee_id,employee_contribution_percentage,fixed_monthly_amount,contribution_mode,updated_by,updated_at) values(v_canteen,null,v_pct,0,'percentage',auth.uid(),now())
 on conflict(canteen_id) where employee_id is null do update set employee_contribution_percentage=excluded.employee_contribution_percentage,fixed_monthly_amount=0,contribution_mode='percentage',updated_by=excluded.updated_by,updated_at=now();
 return v_pct;
end;$$;
revoke all on function public.set_employee_food_contribution_percentage(numeric) from public; grant execute on function public.set_employee_food_contribution_percentage(numeric) to authenticated;

create or replace function public.snapshot_order_contribution_setting()
returns trigger language plpgsql security definer set search_path='public' as $$
declare s record;
begin
 if new.employee_id is null then return new; end if;
 if new.employee_contribution_mode is null then
   select * into s from public.employee_food_contribution_setting_for_employee(new.employee_id) limit 1;
   new.employee_contribution_mode:=coalesce(s.contribution_mode,'percentage');
   new.employee_contribution_percentage:=coalesce(s.employee_contribution_percentage,100);
   new.fixed_monthly_amount:=coalesce(s.fixed_monthly_amount,0);
 end if;
 return new;
end;$$;

drop trigger if exists orders_contribution_snapshot on public.orders;
create trigger orders_contribution_snapshot before insert on public.orders for each row execute function public.snapshot_order_contribution_setting();

create or replace function public.snapshot_employee_adjustment_contribution()
returns trigger language plpgsql security definer set search_path='public' as $$
declare s record;
begin
 if not coalesce(new.contribution_eligible,false) then
   new.contribution_mode:=null;new.fixed_monthly_amount:=null;new.contribution_percentage:=null;
   new.employee_food_amount:=round(greatest(coalesce(new.amount,0),0),2);new.company_food_amount:=0;return new;
 end if;
 if new.contribution_mode is null then
   select * into s from public.employee_food_contribution_setting_for_employee(new.employee_id) limit 1;
   new.contribution_mode:=coalesce(s.contribution_mode,'percentage');
   new.contribution_percentage:=coalesce(s.employee_contribution_percentage,100);
   new.fixed_monthly_amount:=coalesce(s.fixed_monthly_amount,0);
 end if;
 return new;
end;$$;

drop trigger if exists employee_adjustments_contribution_snapshot on public.employee_adjustments;
create trigger employee_adjustments_contribution_snapshot before insert or update of amount,adjustment_date,contribution_eligible on public.employee_adjustments for each row execute function public.snapshot_employee_adjustment_contribution();

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
   v_gross:=greatest(coalesce(r.gross_amount,0),0); v_mode:=coalesce(r.mode,'percentage'); v_pct:=least(100,greatest(0,coalesce(r.pct,100))); v_fixed:=greatest(0,coalesce(r.fixed_amount,0));
   if v_mode='fixed_amount' then
     v_company:=least(v_gross,greatest(0,v_fixed-v_cumulative));
     v_employee:=greatest(0,v_gross-v_company);
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
 v_mode:=coalesce(v_mode,'percentage');v_pct:=least(100,greatest(0,coalesce(v_pct,100)));v_fixed:=greatest(0,coalesce(v_fixed,0));
 v_gross:=round(greatest(coalesce(p_gross_amount,0),0),2);
 select coalesce(sum(gross_amount),0) into v_previous from (select o.id,coalesce(sum(case when oi.item_source<>'guest' then greatest(coalesce(oi.line_total,oi.quantity*oi.unit_price),0) else 0 end),0) gross_amount from public.orders o left join public.order_items oi on oi.order_id=o.id where o.employee_id=v_employee and o.canteen_id=v_canteen and o.status='active' and o.ordered_for>=date_trunc('month',p_order_date)::date and o.ordered_for<=p_order_date group by o.id union all select a.id,greatest(coalesce(a.amount,0),0) from public.employee_adjustments a where a.employee_id=v_employee and a.canteen_id=v_canteen and a.contribution_eligible and a.adjustment_date>=date_trunc('month',p_order_date)::date and a.adjustment_date<=p_order_date) q;
 if v_mode='fixed_amount' then
   v_company:=least(v_gross,greatest(0,v_fixed-v_previous));
   v_employee_payable:=greatest(0,v_gross-v_company);
 else
   v_employee_payable:=round(v_gross*v_pct/100,2);
   v_company:=greatest(0,round(v_gross-v_employee_payable,2));
 end if;
 return jsonb_build_object('contribution_mode',v_mode,'employee_contribution_percentage',v_pct,'fixed_monthly_amount',v_fixed,'previous_eligible_gross',v_previous,'gross_amount',v_gross,'company_amount',v_company,'employee_amount',v_employee_payable,'remaining_allowance_before',greatest(0,v_fixed-v_previous));
end;$$;
revoke all on function public.get_employee_food_contribution_preview(uuid,numeric,date) from public; grant execute on function public.get_employee_food_contribution_preview(uuid,numeric,date) to authenticated;

notify pgrst,'reload schema';
