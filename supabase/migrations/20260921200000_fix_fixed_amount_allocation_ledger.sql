-- Fixed Amount contribution allocation ledger.
create table if not exists private.employee_food_fixed_allocations (
 id uuid primary key default gen_random_uuid(), employee_id uuid not null, canteen_id uuid not null,
 calendar_month date not null, allocation_amount numeric(12,2) not null check(allocation_amount>=0),
 effective_at timestamptz not null default now(), source text not null default 'employee_setting',
 source_setting_id uuid, created_by uuid, created_at timestamptz not null default now()
);
create index if not exists employee_food_fixed_allocations_lookup_idx
 on private.employee_food_fixed_allocations(employee_id,canteen_id,calendar_month,effective_at);
revoke all on table private.employee_food_fixed_allocations from public,anon,authenticated;

create or replace function private.fixed_allocation_total(p_employee_id uuid,p_canteen_id uuid,p_month_start date,p_as_of timestamptz)
returns table(total_allocated numeric,first_allocation_at timestamptz,has_allocation boolean)
language plpgsql security definer set search_path='' as $$
declare v_count integer:=0;v_total numeric:=0;v_first timestamptz;v_mode text;v_fixed numeric;v_updated_at timestamptz;v_virtual_at timestamptz;v_current_month date:=(now() at time zone 'Asia/Kolkata')::date;
begin
 select count(*),coalesce(sum(allocation_amount),0),min(effective_at) into v_count,v_total,v_first
 from private.employee_food_fixed_allocations
 where employee_id=p_employee_id and canteen_id=p_canteen_id and calendar_month=p_month_start and effective_at<=p_as_of;
 if p_month_start=date_trunc('month',v_current_month)::date and v_count=0 then
   select coalesce(s.contribution_mode,g.contribution_mode,'percentage'),coalesce(s.fixed_monthly_amount,g.fixed_monthly_amount,0),coalesce(s.updated_at,g.updated_at)
   into v_mode,v_fixed,v_updated_at
   from public.profiles p
   left join public.employee_food_arrangement_settings s on s.canteen_id=p.canteen_id and s.employee_id=p.id
   left join public.employee_food_arrangement_settings g on g.canteen_id=p.canteen_id and g.employee_id is null
   where p.id=p_employee_id and p.role='employee' and p.status<>'deleted' and p.canteen_id=p_canteen_id;
   if v_mode='fixed_amount' and greatest(0,coalesce(v_fixed,0))>0 then
     v_virtual_at:=greatest(make_timestamptz(extract(year from p_month_start)::int,extract(month from p_month_start)::int,1,0,0,0,'Asia/Kolkata'),coalesce(v_updated_at,make_timestamptz(extract(year from p_month_start)::int,extract(month from p_month_start)::int,1,0,0,0,'Asia/Kolkata')));
     if v_virtual_at<=p_as_of then v_total:=v_fixed;v_first:=v_virtual_at;v_count:=1;end if;
   end if;
 end if;
 return query select round(v_total,2),v_first,(v_count>0);
end;$$;
revoke all on function private.fixed_allocation_total(uuid,uuid,date,timestamptz) from public,anon,authenticated;

create or replace function private.fixed_contribution_state(p_employee_id uuid,p_canteen_id uuid,p_month_start date,p_as_of timestamptz)
returns table(total_allocated numeric,consumed numeric,available numeric,has_allocation boolean)
language plpgsql security definer set search_path='' as $$
declare r record;v_total numeric:=0;v_first timestamptz;v_has boolean:=false;v_consumed numeric:=0;
begin
 select a.total_allocated,a.first_allocation_at,a.has_allocation into v_total,v_first,v_has
 from private.fixed_allocation_total(p_employee_id,p_canteen_id,p_month_start,p_as_of) a;
 if not v_has then return query select 0::numeric,0::numeric,0::numeric,false;return;end if;
 for r in
   with tx as (
     select o.created_at tx_time,coalesce(sum(case when oi.item_source<>'guest' then greatest(coalesce(oi.line_total,oi.quantity*oi.unit_price),0) else 0 end),0) gross_amount
     from public.orders o left join public.order_items oi on oi.order_id=o.id
     where o.employee_id=p_employee_id and o.canteen_id=p_canteen_id and o.status='active'
       and o.ordered_for>=p_month_start and o.ordered_for<(p_month_start+interval '1 month')::date
       and o.created_at<p_as_of and o.employee_contribution_mode='fixed_amount'
     group by o.id,o.created_at
     union all
     select a.created_at,greatest(coalesce(a.amount,0),0)
     from public.employee_adjustments a
     where a.employee_id=p_employee_id and a.canteen_id=p_canteen_id and a.contribution_eligible
       and a.adjustment_date>=p_month_start and a.adjustment_date<(p_month_start+interval '1 month')::date
       and a.created_at<p_as_of and a.contribution_mode='fixed_amount'
   ) select * from tx order by tx_time
 loop
   if r.tx_time>=v_first then v_consumed:=v_consumed+greatest(coalesce(r.gross_amount,0),0);end if;
 end loop;
 return query select round(v_total,2),round(v_consumed,2),greatest(0,round(v_total-v_consumed,2)),true;
end;$$;
revoke all on function private.fixed_contribution_state(uuid,uuid,date,timestamptz) from public,anon,authenticated;

create or replace function public.set_employee_food_contribution_settings(p_employee_id uuid,p_mode text,p_percentage numeric default 0,p_fixed_monthly_amount numeric default 0)
returns table(contribution_mode text,employee_contribution_percentage numeric,fixed_monthly_amount numeric)
language plpgsql security definer set search_path='public' as $$
declare v_canteen uuid;v_mode text;v_pct numeric;v_fixed numeric;v_old_mode text;v_old_fixed numeric;v_setting_id uuid;
begin
 if auth.uid() is null then raise exception 'Authentication required';end if;
 if not public.has_admin_permission('payments') then raise exception 'Settings permission required';end if;
 v_canteen:=public.current_canteen_id();if v_canteen is null then raise exception 'Canteen context required';end if;
 if p_employee_id is null or not exists(select 1 from public.profiles p where p.id=p_employee_id and p.role='employee' and p.status<>'deleted' and p.canteen_id=v_canteen) then raise exception 'Employee not found in current canteen';end if;
 if public.employee_food_contribution_setting_locked() then raise exception 'Employee Food Contribution is locked while Order Time is open.';end if;
 select contribution_mode,fixed_monthly_amount,id into v_old_mode,v_old_fixed,v_setting_id from public.employee_food_arrangement_settings where canteen_id=v_canteen and employee_id=p_employee_id;
 v_mode:=lower(coalesce(p_mode,'percentage'));if v_mode not in ('percentage','fixed_amount') then raise exception 'Contribution mode must be Percentage or Fixed Amount';end if;
 v_pct:=round(coalesce(p_percentage,0),2);v_fixed:=round(coalesce(p_fixed_monthly_amount,0),2);
 if v_mode='percentage' and (v_pct<0 or v_pct>100) then raise exception 'Employee contribution must be between 0 and 100 percent';end if;
 if v_mode='fixed_amount' and v_fixed<0 then raise exception 'Fixed monthly amount must be zero or greater';end if;
 insert into public.employee_food_arrangement_settings(canteen_id,employee_id,employee_contribution_percentage,fixed_monthly_amount,contribution_mode,updated_by,updated_at)
 values(v_canteen,p_employee_id,case when v_mode='percentage' then v_pct else 0 end,case when v_mode='fixed_amount' then v_fixed else 0 end,v_mode,auth.uid(),now())
 on conflict(canteen_id,employee_id) where employee_id is not null do update set employee_contribution_percentage=excluded.employee_contribution_percentage,fixed_monthly_amount=excluded.fixed_monthly_amount,contribution_mode=excluded.contribution_mode,updated_by=excluded.updated_by,updated_at=now()
 returning id into v_setting_id;
 if v_mode='fixed_amount' and (coalesce(v_old_mode,'percentage')<>'fixed_amount' or round(coalesce(v_old_fixed,0),2)<>v_fixed) then
   insert into private.employee_food_fixed_allocations(employee_id,canteen_id,calendar_month,allocation_amount,effective_at,source,source_setting_id,created_by)
   values(p_employee_id,v_canteen,date_trunc('month',current_date)::date,v_fixed,clock_timestamp(),'employee_setting',v_setting_id,auth.uid());
 end if;
 return query select v_mode,case when v_mode='percentage' then v_pct else 0 end,case when v_mode='fixed_amount' then v_fixed else 0 end;
end;$$;
revoke all on function public.set_employee_food_contribution_settings(uuid,text,numeric,numeric) from public;grant execute on function public.set_employee_food_contribution_settings(uuid,text,numeric,numeric) to authenticated;

create or replace function public.set_employee_food_contribution_setting_for_admin(p_employee_id uuid,p_mode text,p_percentage numeric default 0,p_fixed_monthly_amount numeric default 0)
returns table(contribution_mode text,employee_contribution_percentage numeric,fixed_monthly_amount numeric,has_individual_override boolean)
language plpgsql security definer set search_path='public' as $$
declare v_canteen uuid;v_mode text;v_pct numeric;v_fixed numeric;v_old_mode text;v_old_fixed numeric;v_setting_id uuid;
begin
 if auth.uid() is null then raise exception 'Authentication required';end if;
 if not public.has_admin_permission('payments') then raise exception 'Settings permission required';end if;
 v_canteen:=public.current_canteen_id();if v_canteen is null then raise exception 'Canteen context required';end if;
 if public.employee_food_contribution_setting_locked() then raise exception 'Employee Food Contribution is locked while Order Time is open.';end if;
 v_mode:=lower(coalesce(p_mode,'percentage'));if v_mode not in ('percentage','fixed_amount') then raise exception 'Contribution mode must be Percentage or Fixed Amount';end if;
 v_pct:=round(coalesce(p_percentage,0),2);v_fixed:=round(coalesce(p_fixed_monthly_amount,0),2);
 if v_mode='percentage' and (v_pct<0 or v_pct>100) then raise exception 'Member contribution must be between 0 and 100 percent';end if;
 if v_mode='fixed_amount' and v_fixed<0 then raise exception 'Fixed monthly amount must be zero or greater';end if;
 if p_employee_id is null then
   select contribution_mode,fixed_monthly_amount,id into v_old_mode,v_old_fixed,v_setting_id from public.employee_food_arrangement_settings where canteen_id=v_canteen and employee_id is null;
   insert into public.employee_food_arrangement_settings(canteen_id,employee_id,employee_contribution_percentage,fixed_monthly_amount,contribution_mode,updated_by,updated_at)
   values(v_canteen,null,case when v_mode='percentage' then v_pct else 0 end,case when v_mode='fixed_amount' then v_fixed else 0 end,v_mode,auth.uid(),now())
   on conflict(canteen_id) where employee_id is null do update set employee_contribution_percentage=excluded.employee_contribution_percentage,fixed_monthly_amount=excluded.fixed_monthly_amount,contribution_mode=excluded.contribution_mode,updated_by=excluded.updated_by,updated_at=now()
   returning id into v_setting_id;
   if v_mode='fixed_amount' and (coalesce(v_old_mode,'percentage')<>'fixed_amount' or round(coalesce(v_old_fixed,0),2)<>v_fixed) then
     insert into private.employee_food_fixed_allocations(employee_id,canteen_id,calendar_month,allocation_amount,effective_at,source,source_setting_id,created_by)
     select p.id,v_canteen,date_trunc('month',current_date)::date,v_fixed,clock_timestamp(),'global_setting',v_setting_id,auth.uid()
     from public.profiles p left join public.employee_food_arrangement_settings s on s.canteen_id=v_canteen and s.employee_id=p.id
     where p.role='employee' and p.status='active' and p.canteen_id=v_canteen and s.id is null;
   end if;
   return query select v_mode,case when v_mode='percentage' then v_pct else 0 end,case when v_mode='fixed_amount' then v_fixed else 0 end,false;return;
 end if;
 if not exists(select 1 from public.profiles p where p.id=p_employee_id and p.role='employee' and p.status<>'deleted' and p.canteen_id=v_canteen) then raise exception 'Employee not found in current canteen';end if;
 select contribution_mode,fixed_monthly_amount,id into v_old_mode,v_old_fixed,v_setting_id from public.employee_food_arrangement_settings where canteen_id=v_canteen and employee_id=p_employee_id;
 insert into public.employee_food_arrangement_settings(canteen_id,employee_id,employee_contribution_percentage,fixed_monthly_amount,contribution_mode,updated_by,updated_at)
 values(v_canteen,p_employee_id,case when v_mode='percentage' then v_pct else 0 end,case when v_mode='fixed_amount' then v_fixed else 0 end,v_mode,auth.uid(),now())
 on conflict(canteen_id,employee_id) where employee_id is not null do update set employee_contribution_percentage=excluded.employee_contribution_percentage,fixed_monthly_amount=excluded.fixed_monthly_amount,contribution_mode=excluded.contribution_mode,updated_by=excluded.updated_by,updated_at=now()
 returning id into v_setting_id;
 if v_mode='fixed_amount' and (coalesce(v_old_mode,'percentage')<>'fixed_amount' or round(coalesce(v_old_fixed,0),2)<>v_fixed) then
   insert into private.employee_food_fixed_allocations(employee_id,canteen_id,calendar_month,allocation_amount,effective_at,source,source_setting_id,created_by)
   values(p_employee_id,v_canteen,date_trunc('month',current_date)::date,v_fixed,clock_timestamp(),'employee_setting',v_setting_id,auth.uid());
 end if;
 return query select v_mode,case when v_mode='percentage' then v_pct else 0 end,case when v_mode='fixed_amount' then v_fixed else 0 end,true;
end;$$;
revoke all on function public.set_employee_food_contribution_setting_for_admin(uuid,text,numeric,numeric) from public;grant execute on function public.set_employee_food_contribution_setting_for_admin(uuid,text,numeric,numeric) to authenticated;

create or replace function public.clear_employee_food_contribution_override(p_employee_id uuid)
returns boolean language plpgsql security definer set search_path='public' as $$
declare v_canteen uuid;v_global_mode text;v_global_fixed numeric;
begin
 if auth.uid() is null then raise exception 'Authentication required';end if;
 if not public.has_admin_permission('payments') then raise exception 'Settings permission required';end if;
 v_canteen:=public.current_canteen_id();if v_canteen is null then raise exception 'Canteen context required';end if;
 if public.employee_food_contribution_setting_locked() then raise exception 'Employee Food Contribution is locked while Order Time is open.';end if;
 if p_employee_id is null then raise exception 'Employee is required';end if;
 if not exists(select 1 from public.profiles p where p.id=p_employee_id and p.role='employee' and p.status<>'deleted' and p.canteen_id=v_canteen) then raise exception 'Employee not found in current canteen';end if;
 delete from public.employee_food_arrangement_settings where canteen_id=v_canteen and employee_id=p_employee_id;
 select contribution_mode,fixed_monthly_amount into v_global_mode,v_global_fixed from public.employee_food_arrangement_settings where canteen_id=v_canteen and employee_id is null;
 if v_global_mode='fixed_amount' and coalesce(v_global_fixed,0)>0 then
   insert into private.employee_food_fixed_allocations(employee_id,canteen_id,calendar_month,allocation_amount,effective_at,source,created_by)
   values(p_employee_id,v_canteen,date_trunc('month',current_date)::date,round(v_global_fixed,2),clock_timestamp(),'override_cleared',auth.uid());
 end if;
 return true;
end;$$;
revoke all on function public.clear_employee_food_contribution_override(uuid) from public;grant execute on function public.clear_employee_food_contribution_override(uuid) to authenticated;

create or replace function private.recalculate_employee_month_contributions_internal(p_employee_id uuid,p_canteen_id uuid,p_month_start date)
returns void language plpgsql security definer set search_path='' as $$
declare r record;v_gross numeric;v_mode text;v_pct numeric;v_company numeric;v_employee numeric;v_state record;
begin
 if p_employee_id is null or p_canteen_id is null or p_month_start is null then raise exception 'Contribution recalculation context required';end if;
 if not exists(select 1 from public.profiles p where p.id=p_employee_id and p.role='employee' and p.status='active' and p.canteen_id=p_canteen_id) then raise exception 'Employee not found in requested canteen';end if;
 perform pg_advisory_xact_lock(hashtextextended(coalesce(p_employee_id::text,'')||':'||coalesce(p_month_start::text,''),0));
 for r in with tx as (
   select o.id::text tx_id,'order' tx_kind,o.ordered_for tx_date,o.created_at tx_time,
     coalesce(sum(case when oi.item_source<>'guest' then greatest(coalesce(oi.line_total,oi.quantity*oi.unit_price),0) else 0 end),0) gross_amount,
     o.employee_contribution_mode mode,o.employee_contribution_percentage pct,o.fixed_monthly_amount fixed_amount
   from public.orders o left join public.order_items oi on oi.order_id=o.id
   where o.employee_id=p_employee_id and o.canteen_id=p_canteen_id and o.status='active' and o.ordered_for>=p_month_start and o.ordered_for<(p_month_start+interval '1 month')::date
   group by o.id,o.ordered_for,o.created_at,o.employee_contribution_mode,o.employee_contribution_percentage,o.fixed_monthly_amount
   union all
   select a.id::text,'adjustment',a.adjustment_date,a.created_at,greatest(coalesce(a.amount,0),0),a.contribution_mode,a.contribution_percentage,a.fixed_monthly_amount
   from public.employee_adjustments a
   where a.employee_id=p_employee_id and a.canteen_id=p_canteen_id and a.contribution_eligible and a.adjustment_date>=p_month_start and a.adjustment_date<(p_month_start+interval '1 month')::date
 ) select * from tx order by tx_time,tx_date,tx_kind,tx_id loop
   v_gross:=greatest(coalesce(r.gross_amount,0),0);v_mode:=coalesce(r.mode,'percentage');v_pct:=least(100,greatest(0,coalesce(r.pct,100)));
   if v_mode='fixed_amount' then
     select * into v_state from private.fixed_contribution_state(p_employee_id,p_canteen_id,p_month_start,r.tx_time);
     if coalesce(v_state.has_allocation,false) then
       v_company:=least(v_gross,greatest(0,coalesce(v_state.available,0)));v_employee:=greatest(0,v_gross-v_company);
       if r.tx_kind='order' then update public.orders set employee_food_amount=round(v_employee,2),company_food_amount=round(v_company,2) where id=r.tx_id::uuid;
       else update public.employee_adjustments set employee_food_amount=round(v_employee,2),company_food_amount=round(v_company,2) where id=r.tx_id::uuid;end if;
     end if;
   else
     v_employee:=round(v_gross*v_pct/100,2);v_company:=greatest(0,round(v_gross-v_employee,2));
     if r.tx_kind='order' then update public.orders set employee_food_amount=round(v_employee,2),company_food_amount=round(v_company,2) where id=r.tx_id::uuid;
     else update public.employee_adjustments set employee_food_amount=round(v_employee,2),company_food_amount=round(v_company,2) where id=r.tx_id::uuid;end if;
   end if;
 end loop;
end;$$;
revoke all on function private.recalculate_employee_month_contributions_internal(uuid,uuid,date) from public,anon,authenticated;

create or replace function public.get_employee_food_contribution_preview(p_employee_id uuid,p_gross_amount numeric,p_order_date date default current_date)
returns jsonb language plpgsql security definer set search_path='public' as $$
declare v_canteen uuid;v_employee uuid;v_mode text;v_pct numeric;v_fixed numeric;v_gross numeric;v_state record;v_company numeric;v_employee_payable numeric;
begin
 if auth.uid() is null then raise exception 'Authentication required';end if;
 v_canteen:=public.current_canteen_id();if v_canteen is null then raise exception 'Canteen context required';end if;
 select id into v_employee from public.profiles where id=coalesce(p_employee_id,auth.uid()) and role='employee' and status<>'deleted' and canteen_id=v_canteen;
 if v_employee is null then raise exception 'Employee not found in current canteen';end if;
 if auth.uid()<>v_employee and not public.has_admin_permission('payments') and not public.has_admin_permission('orders') then raise exception 'Not authorized';end if;
 select contribution_mode,employee_contribution_percentage,fixed_monthly_amount into v_mode,v_pct,v_fixed from public.employee_food_contribution_setting_for_employee(v_employee) limit 1;
 v_mode:=coalesce(v_mode,'percentage');v_pct:=least(100,greatest(0,coalesce(v_pct,100)));v_fixed:=greatest(0,coalesce(v_fixed,0));v_gross:=round(greatest(coalesce(p_gross_amount,0),0),2);
 if v_mode='fixed_amount' then
   select * into v_state from private.fixed_contribution_state(v_employee,v_canteen,date_trunc('month',p_order_date)::date,clock_timestamp());
   v_company:=least(v_gross,greatest(0,coalesce(v_state.available,0)));v_employee_payable:=greatest(0,v_gross-v_company);
   return jsonb_build_object('contribution_mode',v_mode,'employee_contribution_percentage',case when v_gross=0 then 0 else round(v_employee_payable/v_gross*100,2) end,'fixed_monthly_amount',coalesce(v_state.total_allocated,v_fixed),'previous_eligible_gross',coalesce(v_state.consumed,0),'gross_amount',v_gross,'company_amount',v_company,'employee_amount',v_employee_payable,'remaining_allowance_before',coalesce(v_state.available,0),'available_fixed_balance',coalesce(v_state.available,0),'fixed_allocations',coalesce(v_state.total_allocated,v_fixed));
 end if;
 v_employee_payable:=round(v_gross*v_pct/100,2);v_company:=greatest(0,round(v_gross-v_employee_payable,2));
 return jsonb_build_object('contribution_mode',v_mode,'employee_contribution_percentage',v_pct,'fixed_monthly_amount',v_fixed,'previous_eligible_gross',0,'gross_amount',v_gross,'company_amount',v_company,'employee_amount',v_employee_payable,'remaining_allowance_before',0);
end;$$;
revoke all on function public.get_employee_food_contribution_preview(uuid,numeric,date) from public;grant execute on function public.get_employee_food_contribution_preview(uuid,numeric,date) to authenticated;
notify pgrst,'reload schema';
