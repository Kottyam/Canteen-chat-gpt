begin;

alter table public.subscription_plans
  add column if not exists billing_availability text;

update public.subscription_plans
set billing_availability=case when billing_cycle='annual' then 'annual' else 'monthly' end
where billing_availability is null;

alter table public.subscription_plans
  alter column billing_availability set default 'monthly';
alter table public.subscription_plans
  alter column billing_availability set not null;
alter table public.subscription_plans
  drop constraint if exists subscription_plans_billing_availability_check;
alter table public.subscription_plans
  add constraint subscription_plans_billing_availability_check
  check (billing_availability in ('monthly','annual','monthly_annual'));

create or replace function public.subscription_cycle_supported(p_availability text,p_cycle text)
returns boolean language sql immutable set search_path=''
as $$ select p_cycle in ('monthly','annual') and (p_availability='monthly_annual' or p_availability=p_cycle); $$;

revoke execute on function public.subscription_cycle_supported(text,text) from public,anon;
grant execute on function public.subscription_cycle_supported(text,text) to authenticated;

drop function if exists public.super_admin_upsert_subscription_plan(uuid,text,text,text,text,text,numeric,numeric,jsonb,boolean,boolean);
create or replace function public.super_admin_upsert_subscription_plan(
 p_plan_id uuid default null,p_name text default null,p_description text default null,
 p_pricing_model text default 'MEMBER_RANGE',p_billing_availability text default 'monthly',
 p_currency text default 'INR',p_monthly_price numeric default null,p_annual_price numeric default null,
 p_ranges jsonb default '[]'::jsonb,p_active boolean default true,p_is_default boolean default false)
returns public.subscription_plans language plpgsql security definer set search_path=''
as $$
declare v_plan public.subscription_plans; v_range jsonb; v_min integer; v_max integer; v_monthly numeric(12,2); v_annual numeric(12,2);
begin
 if not public.is_super_admin() then raise exception 'Super Admin authorization required'; end if;
 if nullif(trim(coalesce(p_name,'')),'') is null then raise exception 'Plan name is required'; end if;
 if p_pricing_model not in ('FIXED_AMOUNT','MEMBER_RANGE') then raise exception 'Invalid pricing model'; end if;
 if p_billing_availability not in ('monthly','annual','monthly_annual') then raise exception 'Invalid billing availability'; end if;
 if p_pricing_model='FIXED_AMOUNT' then
   if p_billing_availability in ('monthly','monthly_annual') and (p_monthly_price is null or p_monthly_price<0) then raise exception 'Monthly fixed amount is required'; end if;
   if p_billing_availability in ('annual','monthly_annual') and (p_annual_price is null or p_annual_price<0) then raise exception 'Yearly fixed amount is required'; end if;
   p_monthly_price:=coalesce(p_monthly_price,0); p_annual_price:=coalesce(p_annual_price,0); p_ranges:='[]'::jsonb;
 elsif jsonb_typeof(coalesce(p_ranges,'[]'::jsonb))<>'array' or jsonb_array_length(coalesce(p_ranges,'[]'::jsonb))=0 then
   raise exception 'At least one member pricing range is required';
 end if;

 if p_plan_id is null then
   insert into public.subscription_plans(name,description,pricing_model,min_members,max_members,monthly_price,annual_price,price,billing_period,currency,trial_days,active,is_default,billing_cycle,billing_availability)
   values(trim(p_name),nullif(trim(p_description),''),p_pricing_model,
     case when p_pricing_model='MEMBER_RANGE' then 0 else null end,
     case when p_pricing_model='MEMBER_RANGE' then 2147483647 else null end,
     coalesce(p_monthly_price,0),coalesce(p_annual_price,0),coalesce(p_monthly_price,0),'monthly',
     upper(trim(coalesce(p_currency,'INR'))),0,p_active,false,
     case when p_billing_availability='annual' then 'annual' else 'monthly' end,p_billing_availability)
   returning * into v_plan;
 else
   select * into v_plan from public.subscription_plans where id=p_plan_id for update;
   if not found then raise exception 'Plan not found'; end if;
   update public.subscription_plans set name=trim(p_name),description=nullif(trim(p_description),''),
     pricing_model=p_pricing_model,billing_availability=p_billing_availability,
     billing_cycle=case when p_billing_availability='annual' then 'annual' else 'monthly' end,
     currency=upper(trim(coalesce(p_currency,'INR'))),monthly_price=coalesce(p_monthly_price,0),
     annual_price=coalesce(p_annual_price,0),price=coalesce(p_monthly_price,0),billing_period='monthly',
     active=p_active,updated_at=now() where id=v_plan.id returning * into v_plan;
   delete from public.subscription_plan_ranges where plan_id=v_plan.id;
 end if;

 if v_plan.pricing_model='MEMBER_RANGE' then
   for v_range in select value from jsonb_array_elements(coalesce(p_ranges,'[]'::jsonb)) loop
     v_min:=coalesce((v_range->>'min_members')::integer,(v_range->>'min')::integer);
     v_max:=coalesce((v_range->>'max_members')::integer,(v_range->>'max')::integer);
     v_monthly:=coalesce((v_range->>'monthly_price')::numeric,(v_range->>'price')::numeric);
     v_annual:=coalesce((v_range->>'annual_price')::numeric,(v_range->>'yearly_price')::numeric);
     if v_min is null or v_max is null or v_min<0 or v_max<v_min then raise exception 'Invalid member pricing range'; end if;
     if p_billing_availability in ('monthly','monthly_annual') and (v_monthly is null or v_monthly<0) then raise exception 'Monthly price is required for every member range'; end if;
     if p_billing_availability in ('annual','monthly_annual') and (v_annual is null or v_annual<0) then raise exception 'Yearly price is required for every member range'; end if;
     v_monthly:=coalesce(v_monthly,0); v_annual:=coalesce(v_annual,0);
     if exists(select 1 from public.subscription_plan_ranges x where x.plan_id=v_plan.id and x.min_members<=v_max and v_min<=x.max_members) then raise exception 'Member pricing ranges cannot overlap'; end if;
     insert into public.subscription_plan_ranges(plan_id,min_members,max_members,monthly_price,annual_price) values(v_plan.id,v_min,v_max,v_monthly,v_annual);
   end loop;
   select min(min_members),max(max_members),min(monthly_price),min(annual_price) into v_plan.min_members,v_plan.max_members,v_plan.monthly_price,v_plan.annual_price from public.subscription_plan_ranges where plan_id=v_plan.id;
   update public.subscription_plans set min_members=v_plan.min_members,max_members=v_plan.max_members,monthly_price=v_plan.monthly_price,annual_price=v_plan.annual_price,price=v_plan.monthly_price,updated_at=now() where id=v_plan.id returning * into v_plan;
 else
   update public.subscription_plans set min_members=null,max_members=null,monthly_price=coalesce(p_monthly_price,0),annual_price=coalesce(p_annual_price,0),price=coalesce(p_monthly_price,0),billing_cycle=case when p_billing_availability='annual' then 'annual' else 'monthly' end,billing_availability=p_billing_availability,updated_at=now() where id=v_plan.id returning * into v_plan;
 end if;

 if p_is_default then
   update public.subscription_plans set is_default=false,updated_at=now() where is_default and id<>v_plan.id;
   update public.subscription_plans set is_default=true,updated_at=now() where id=v_plan.id returning * into v_plan;
 end if;
 return v_plan;
end $$;

revoke execute on function public.super_admin_upsert_subscription_plan(uuid,text,text,text,text,text,numeric,numeric,jsonb,boolean,boolean) from public,anon;
grant execute on function public.super_admin_upsert_subscription_plan(uuid,text,text,text,text,text,numeric,numeric,jsonb,boolean,boolean) to authenticated;

drop function if exists public.get_subscription_billing_quote(uuid);
create or replace function public.get_subscription_billing_quote(p_canteen_id uuid,p_billing_cycle text default null)
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare s public.canteen_subscriptions; p public.subscription_plans; r public.subscription_plan_ranges; v_members integer; v_cycle text; v_amount numeric(12,2); v_contact text;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 if not(public.is_super_admin() or public.current_canteen_id()=p_canteen_id) then raise exception 'Not authorized'; end if;
 select * into s from public.canteen_subscriptions where canteen_id=p_canteen_id;
 if not found then return jsonb_build_object('required',false,'reason','unassigned'); end if;
 select count(*)::integer into v_members from public.profiles e where e.canteen_id=p_canteen_id and e.role='employee' and e.status='active';
 select * into p from public.subscription_plans where id=s.plan_id and active;
 if not found then raise exception 'Active subscription plan not found'; end if;
 v_cycle:=coalesce(nullif(trim(p_billing_cycle),''),s.billing_cycle,'monthly');
 if not public.subscription_cycle_supported(p.billing_availability,v_cycle) then raise exception 'Selected billing cycle is not available for this plan'; end if;
 select coalesce(nullif(trim(vendor_contact_email),''),'gocanteen1729@gmail.com') into v_contact from public.subscription_payment_settings where id=true;
 v_contact:=coalesce(v_contact,'gocanteen1729@gmail.com');

 if p.pricing_model='FIXED_AMOUNT' then
   v_amount:=case when v_cycle='annual' then p.annual_price else p.monthly_price end;
   if v_amount<=0 then return jsonb_build_object('required',false,'plan_id',p.id,'plan_name',p.name,'pricing_model',p.pricing_model,'billing_cycle',v_cycle,'amount',v_amount,'currency',p.currency,'member_count',v_members,'max_exceeded',false,'contact_email',v_contact,'message','The selected billing cycle is not priced for this plan.'); end if;
   return jsonb_build_object('required',true,'plan_id',p.id,'plan_name',p.name,'pricing_model',p.pricing_model,'billing_cycle',v_cycle,'amount',v_amount,'currency',p.currency,'member_count',v_members,'max_exceeded',false,'contact_email',v_contact,'message',null);
 end if;

 select * into r from public.subscription_plan_ranges x where x.plan_id=p.id and x.min_members<=v_members and x.max_members>=v_members order by x.min_members desc limit 1;
 if not found then
   return jsonb_build_object('required',false,'plan_id',p.id,'plan_name',p.name,'pricing_model',p.pricing_model,'billing_cycle',v_cycle,'amount',null,'currency',p.currency,'member_count',v_members,'max_exceeded',not exists(select 1 from public.subscription_plan_ranges x where x.plan_id=p.id and x.max_members>=v_members),'contact_email',v_contact,'message','Your current member count exceeds the configured pricing range. Please contact the administrator.');
 end if;
 v_amount:=case when v_cycle='annual' then r.annual_price else r.monthly_price end;
 if v_amount<=0 then return jsonb_build_object('required',false,'plan_id',p.id,'plan_name',p.name,'pricing_model',p.pricing_model,'billing_cycle',v_cycle,'amount',v_amount,'currency',p.currency,'member_count',v_members,'min_members',r.min_members,'max_members',r.max_members,'max_exceeded',false,'contact_email',v_contact,'message','The selected billing cycle is not priced for this plan.'); end if;
 return jsonb_build_object('required',true,'plan_id',p.id,'plan_name',p.name,'pricing_model',p.pricing_model,'billing_cycle',v_cycle,'amount',v_amount,'currency',p.currency,'member_count',v_members,'min_members',r.min_members,'max_members',r.max_members,'max_exceeded',false,'contact_email',v_contact,'message',null);
end $$;

revoke execute on function public.get_subscription_billing_quote(uuid,text) from public,anon;
grant execute on function public.get_subscription_billing_quote(uuid,text) to authenticated;

drop function if exists public.super_admin_set_subscription(uuid,text,uuid,integer,numeric,text,text,text);
create or replace function public.super_admin_set_subscription(p_canteen_id uuid,p_action text,p_plan_id uuid default null,p_trial_days integer default null,p_amount numeric default null,p_currency text default null,p_billing_cycle text default 'monthly',p_plan_selection_mode text default null)
returns public.canteen_subscriptions language plpgsql security definer set search_path=''
as $$
declare v_sub public.canteen_subscriptions; v_plan public.subscription_plans; v_plan_id uuid; v_range public.subscription_plan_ranges; v_members integer; v_now timestamptz:=now(); v_trial_days integer; v_cycle text; v_mode text; v_amount numeric(12,2); v_start timestamptz; v_end timestamptz;
begin
 if not public.is_super_admin() then raise exception 'Super Admin authorization required'; end if;
 if exists(select 1 from public.canteens c where c.id=p_canteen_id and (c.name='GoCanteen' or c.owner_id=(select id from public.profiles where id=(select auth.uid()) and admin_role='super_admin'))) then raise exception 'Super Admin platform canteen is not a customer subscription'; end if;
 if not exists(select 1 from public.canteens c where c.id=p_canteen_id) then raise exception 'Canteen not found'; end if;
 select * into v_sub from public.canteen_subscriptions where canteen_id=p_canteen_id for update;
 select count(*)::integer into v_members from public.profiles e where e.canteen_id=p_canteen_id and e.role='employee' and e.status='active';

 if p_action in ('activate_trial','activate') then
   if v_sub.id is not null then
     if v_sub.trial_used_at is not null and p_action='activate_trial' then raise exception 'This canteen has already used its initial trial'; end if;
     if v_sub.trial_used_at is not null and p_action='activate' and v_sub.status not in ('payment_pending','trial') then raise exception 'This canteen is already activated. Use Change Plan or Renewal instead.'; end if;
   end if;
   if p_plan_id is null then v_plan_id:=public.resolve_member_range_plan(p_canteen_id); if v_plan_id is null then raise exception 'A configured MEMBER_RANGE plan does not match the current member count'; end if; else v_plan_id:=p_plan_id; end if;
   select * into v_plan from public.subscription_plans where id=v_plan_id and active=true; if not found then raise exception 'Selected plan not found or inactive'; end if;
   v_cycle:=coalesce(nullif(trim(p_billing_cycle),''),'monthly');
   if not public.subscription_cycle_supported(v_plan.billing_availability,v_cycle) then raise exception 'Selected billing cycle is not available for the selected plan'; end if;
   v_mode:=case when v_plan.pricing_model='MEMBER_RANGE' and p_plan_selection_mode='auto_range' then 'auto_range' else 'manual' end;
   if v_plan.pricing_model='FIXED_AMOUNT' then v_amount:=case when v_cycle='annual' then v_plan.annual_price else v_plan.monthly_price end;
   else select * into v_range from public.subscription_plan_ranges where plan_id=v_plan.id and min_members<=v_members and max_members>=v_members order by min_members desc limit 1; if not found then raise exception 'Your current member count exceeds the configured pricing range. Please contact the administrator.'; end if; v_amount:=case when v_cycle='annual' then v_range.annual_price else v_range.monthly_price end; end if;
   if v_amount<=0 then raise exception 'The selected billing cycle is not priced for this plan'; end if;

   if p_action='activate_trial' then
     v_trial_days:=coalesce(p_trial_days,30); if v_trial_days<=0 then raise exception 'Trial duration must be greater than zero when trial is enabled'; end if;
     insert into public.canteen_subscriptions(canteen_id,plan_id,status,trial_start,trial_end,subscription_start,subscription_end,amount,currency,payment_status,billing_cycle,plan_selection_mode,trial_used_at,effective_amount_override)
     values(p_canteen_id,v_plan.id,'trial',v_now,v_now+make_interval(days=>v_trial_days),null,null,v_amount,v_plan.currency,'pending',v_cycle,v_mode,coalesce(v_sub.trial_used_at,v_now),null)
     on conflict(canteen_id) do update set plan_id=excluded.plan_id,status='trial',trial_start=excluded.trial_start,trial_end=excluded.trial_end,subscription_start=null,subscription_end=null,amount=excluded.amount,currency=excluded.currency,payment_status='pending',billing_cycle=excluded.billing_cycle,plan_selection_mode=excluded.plan_selection_mode,trial_used_at=coalesce(public.canteen_subscriptions.trial_used_at,excluded.trial_used_at),effective_amount_override=null,updated_at=now()
     returning * into v_sub; return v_sub;
   end if;

   v_start:=coalesce(v_sub.subscription_start,v_now); v_end:=case when v_cycle='annual' then v_start+interval '1 year' else v_start+interval '1 month' end;
   insert into public.canteen_subscriptions(canteen_id,plan_id,status,trial_start,trial_end,subscription_start,subscription_end,amount,currency,payment_status,billing_cycle,plan_selection_mode,trial_used_at,effective_amount_override)
   values(p_canteen_id,v_plan.id,'active',v_sub.trial_start,v_sub.trial_end,v_start,v_end,v_amount,v_plan.currency,'paid',v_cycle,v_mode,coalesce(v_sub.trial_used_at,v_now),null)
   on conflict(canteen_id) do update set plan_id=excluded.plan_id,status='active',subscription_start=excluded.subscription_start,subscription_end=excluded.subscription_end,amount=excluded.amount,currency=excluded.currency,payment_status='paid',billing_cycle=excluded.billing_cycle,plan_selection_mode=excluded.plan_selection_mode,trial_used_at=coalesce(public.canteen_subscriptions.trial_used_at,excluded.trial_used_at),effective_amount_override=null,updated_at=now()
   returning * into v_sub; return v_sub;
 end if;

 if p_action='extend_trial' then raise exception 'Trial extension is not supported. The initial trial is a one-time activation property.'; end if;

 if p_action='change_plan' then
   if v_sub.id is null then raise exception 'Subscription not found'; end if;
   if p_plan_id is null then raise exception 'Plan is required'; end if;
   select * into v_plan from public.subscription_plans where id=p_plan_id and active=true; if not found then raise exception 'Selected plan not found or inactive'; end if;
   v_cycle:=coalesce(nullif(trim(p_billing_cycle),''),v_sub.billing_cycle,'monthly');
   if not public.subscription_cycle_supported(v_plan.billing_availability,v_cycle) then raise exception 'Selected billing cycle is not available for the selected plan'; end if;
   if v_plan.pricing_model='FIXED_AMOUNT' then v_amount:=case when v_cycle='annual' then v_plan.annual_price else v_plan.monthly_price end;
   else select * into v_range from public.subscription_plan_ranges where plan_id=v_plan.id and min_members<=v_members and max_members>=v_members order by min_members desc limit 1; if not found then raise exception 'Your current member count exceeds the configured pricing range. Please contact the administrator.'; end if; v_amount:=case when v_cycle='annual' then v_range.annual_price else v_range.monthly_price end; end if;
   if v_amount<=0 then raise exception 'The selected billing cycle is not priced for this plan'; end if;
   update public.canteen_subscriptions set plan_id=v_plan.id,amount=v_amount,currency=v_plan.currency,billing_cycle=v_cycle,plan_selection_mode='manual',effective_amount_override=null,updated_at=now() where id=v_sub.id returning * into v_sub; return v_sub;
 end if;

 if p_action='suspend' then if v_sub.id is null then raise exception 'Subscription not found'; end if; update public.canteen_subscriptions set status='suspended',updated_at=now() where id=v_sub.id returning * into v_sub; return v_sub; end if;
 if p_action='payment_pending' then if v_sub.id is null then raise exception 'Subscription not found'; end if; update public.canteen_subscriptions set payment_status='pending',updated_at=now() where id=v_sub.id returning * into v_sub; return v_sub; end if;
 raise exception 'Unsupported subscription action';
end $$;

revoke execute on function public.super_admin_set_subscription(uuid,text,uuid,integer,numeric,text,text,text) from public,anon;
grant execute on function public.super_admin_set_subscription(uuid,text,uuid,integer,numeric,text,text,text) to authenticated;

drop function if exists public.super_admin_review_subscription_payment(uuid,text,text);
create or replace function public.super_admin_review_subscription_payment(p_payment_id uuid,p_status text,p_billing_cycle text default null)
returns public.subscription_payments language plpgsql security definer set search_path=''
as $$
declare pay public.subscription_payments; s public.canteen_subscriptions; p public.subscription_plans; quote jsonb; cycle text; start_at timestamptz; end_at timestamptz; expected numeric(12,2);
begin
 if not public.is_super_admin() then raise exception 'Super Admin authorization required'; end if;
 if p_status not in ('paid','failed') then raise exception 'Review status must be paid or failed'; end if;
 select * into pay from public.subscription_payments where id=p_payment_id for update; if not found then raise exception 'Payment not found'; end if;
 if pay.payment_status<>'pending' then raise exception 'Only pending payments can be reviewed'; end if;
 select * into s from public.canteen_subscriptions where id=pay.subscription_id for update; if not found then raise exception 'Subscription not found'; end if;
 if p_status='failed' then
   update public.subscription_payments set payment_status='failed',updated_at=now() where id=pay.id returning * into pay;
   update public.canteen_subscriptions set payment_status='failed',updated_at=now() where id=s.id; return pay;
 end if;
 cycle:=coalesce(p_billing_cycle,pay.billing_cycle,s.billing_cycle,'monthly');
 if cycle not in ('monthly','annual') then raise exception 'Billing cycle must be monthly or annual'; end if;
 select * into p from public.subscription_plans where id=pay.plan_id and active=true; if not found then raise exception 'Active subscription plan not found'; end if;
 if not public.subscription_cycle_supported(p.billing_availability,cycle) then raise exception 'Selected billing cycle is not available for this plan'; end if;
 quote:=public.get_subscription_billing_quote(s.canteen_id,cycle);
 if coalesce((quote->>'required')::boolean,false)=false then raise exception '%',coalesce(quote->>'message','Subscription pricing is not currently configured.'); end if;
 if (quote->>'plan_id')::uuid<>pay.plan_id then raise exception 'Subscription plan changed after payment submission; payment must be resubmitted'; end if;
 expected:=(quote->>'amount')::numeric;
 if round(pay.amount,2)<>round(expected,2) then raise exception 'Verified payment amount does not match the current configured subscription price'; end if;
 start_at:=pay.billing_period_start; end_at:=pay.billing_period_end;
 if start_at is null or end_at is null then quote:=public.resolve_subscription_billing_period(s.id,cycle); start_at:=(quote->>'billing_period_start')::timestamptz; end_at:=(quote->>'billing_period_end')::timestamptz; end if;
 update public.subscription_payments set payment_status='paid',billing_cycle=cycle,billing_period_start=start_at,billing_period_end=end_at,updated_at=now() where id=pay.id returning * into pay;
 update public.canteen_subscriptions set plan_id=pay.plan_id,billing_cycle=cycle,status='active',payment_status='paid',subscription_start=start_at,subscription_end=end_at,amount=expected,currency=p.currency,updated_at=now() where id=s.id;
 return pay;
end $$;

revoke execute on function public.super_admin_review_subscription_payment(uuid,text,text) from public,anon;
grant execute on function public.super_admin_review_subscription_payment(uuid,text,text) to authenticated;

commit;
