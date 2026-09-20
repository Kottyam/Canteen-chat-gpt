-- Fix authoritative subscription state, billing-period calculation, and configured trial duration.
create or replace function public.get_canteen_subscription_state(p_canteen_id uuid)
returns jsonb language sql stable security definer set search_path=''
as $$
select case
when auth.uid() is null then jsonb_build_object('allowed',false,'status',null,'reason','verification_error')
when exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.role='admin' and p.admin_role='super_admin' and p.status='active')
then coalesce((select jsonb_build_object('allowed',true,'status',s.status,'payment_status',s.payment_status,'subscription',to_jsonb(s),'reason',s.status) from public.canteen_subscriptions s where s.canteen_id=p_canteen_id),jsonb_build_object('allowed',true,'status',null,'subscription',null,'reason','unassigned'))
else coalesce((
  select jsonb_build_object(
    'allowed',case when s.id is null then true
      when s.status='trial' then s.trial_end is not null and s.trial_end>now()
      when s.status='active' then s.subscription_end is not null and s.subscription_end>now()
      when s.status='payment_pending' then ((s.trial_end is not null and s.trial_end>now()) or (s.subscription_end is not null and s.subscription_end>now()))
      else false end,
    'status',s.status,'payment_status',s.payment_status,'subscription',to_jsonb(s),'reason',coalesce(s.status,'unassigned'))
  from public.profiles u join public.canteens c on c.id=u.canteen_id
  left join public.canteen_subscriptions s on s.canteen_id=u.canteen_id
  where u.id=(select auth.uid()) and u.status='active' and u.canteen_id=p_canteen_id and not c.archived
  limit 1
),jsonb_build_object('allowed',false,'status',null,'reason','verification_error'))
end
$$;

create or replace function public.can_canteen_operate(p_canteen_id uuid default null)
returns boolean language sql stable security definer set search_path=''
as $$
select coalesce((public.get_canteen_subscription_state(coalesce(p_canteen_id,(select p.canteen_id from public.profiles p where p.id=(select auth.uid()) limit 1)))->>'allowed')::boolean,false)
$$;

create or replace function public.resolve_subscription_billing_period(p_subscription_id uuid,p_billing_cycle text)
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare s public.canteen_subscriptions; v_start timestamptz; v_end timestamptz;
begin
if auth.uid() is null then raise exception 'Authentication required'; end if;
if p_billing_cycle not in ('monthly','annual') then raise exception 'Billing cycle must be monthly or annual'; end if;
select * into s from public.canteen_subscriptions where id=p_subscription_id;
if not found then raise exception 'Subscription not found'; end if;
if not(public.is_super_admin() or public.current_canteen_id()=s.canteen_id) then raise exception 'Not authorized'; end if;
v_start:=case
when s.status='trial' and s.trial_end is not null and s.trial_end>now() then s.trial_end
when s.status='active' and s.subscription_end is not null and s.subscription_end>now() then s.subscription_end
when s.status='payment_pending' and s.trial_end is not null and s.trial_end>now() then s.trial_end
when s.status='payment_pending' and s.subscription_end is not null and s.subscription_end>now() then s.subscription_end
else now() end;
v_end:=case when p_billing_cycle='monthly' then v_start+interval '1 month' else v_start+interval '1 year' end;
return jsonb_build_object('billing_period_start',v_start,'billing_period_end',v_end,'source_status',s.status,'subscription_id',s.id);
end $$;

create or replace function public.canteen_create_subscription_payment(p_subscription_id uuid,p_billing_cycle text,p_payment_date date,p_reference text,p_note text default null,p_payment_method_id uuid default null)
returns public.subscription_payments language plpgsql security definer set search_path=''
as $$
declare s public.canteen_subscriptions; p public.subscription_plans; m public.subscription_payment_methods; outp public.subscription_payments; pid uuid; expected numeric(12,2); period jsonb; payment_type text;
begin
if auth.uid() is null or not public.is_active_canteen_admin() then raise exception 'Canteen Admin authorization required'; end if;
select * into s from public.canteen_subscriptions where id=p_subscription_id and canteen_id=public.current_canteen_id() for update;
if not found then raise exception 'Subscription not found'; end if;
if s.status not in('trial','active','payment_pending','expired','suspended') then raise exception 'Payment is not currently required for this subscription'; end if;
if p_billing_cycle not in('monthly','annual') or nullif(trim(coalesce(p_reference,'')),'') is null or p_payment_date is null then raise exception 'Payment details are required'; end if;
if exists(select 1 from public.subscription_payments where subscription_id=s.id and payment_status='pending' and payment_type<>'plan_upgrade') then raise exception 'A payment is already pending review for this subscription'; end if;
pid:=case when s.plan_selection_mode='auto_range' then public.resolve_member_range_plan(s.canteen_id) else s.plan_id end;
select * into p from public.subscription_plans where id=pid and active;
if not found then raise exception 'Active subscription plan not found'; end if;
expected:=case when p_billing_cycle='annual' then p.annual_price else p.monthly_price end;
select * into m from public.subscription_payment_methods where id=coalesce(p_payment_method_id,(select id from public.subscription_payment_methods where active and is_default limit 1)) and active;
if not found then raise exception 'No active payment method is configured'; end if;
period:=public.resolve_subscription_billing_period(s.id,p_billing_cycle);
payment_type:=case when s.status='active' then 'renewal' else 'subscription' end;
insert into public.subscription_payments(canteen_id,subscription_id,plan_id,amount,currency,payment_date,payment_status,transaction_reference,payment_provider,payment_note,billing_cycle,payment_type,billing_period_start,billing_period_end,payment_method_id,payment_method_reference,payment_method_snapshot)
values(s.canteen_id,s.id,p.id,expected,p.currency,p_payment_date::timestamptz,'pending',trim(p_reference),m.provider,nullif(trim(coalesce(p_note,'')),''),p_billing_cycle,payment_type,(period->>'billing_period_start')::timestamptz,(period->>'billing_period_end')::timestamptz,m.id,coalesce(m.upi_id,m.display_name),jsonb_build_object('id',m.id,'provider',m.provider,'method_type',m.method_type,'display_name',m.display_name,'upi_id',m.upi_id))
returning * into outp;
update public.canteen_subscriptions set payment_status='pending',updated_at=now() where id=s.id;
return outp;
end $$;

create or replace function public.super_admin_review_subscription_payment(p_payment_id uuid,p_status text,p_billing_cycle text default null)
returns public.subscription_payments language plpgsql security definer set search_path=''
as $$
declare pay public.subscription_payments; s public.canteen_subscriptions; p public.subscription_plans; q jsonb; cycle text; start_at timestamptz; end_at timestamptz; expected numeric(12,2); period jsonb;
begin
if not public.is_super_admin() then raise exception 'Super Admin authorization required'; end if;
if p_status not in ('paid','failed') then raise exception 'Review status must be paid or failed'; end if;
select * into pay from public.subscription_payments where id=p_payment_id for update;
if not found then raise exception 'Payment not found'; end if;
if pay.payment_status<>'pending' then raise exception 'Only pending payments can be reviewed'; end if;
select * into s from public.canteen_subscriptions where id=pay.subscription_id for update;
if not found then raise exception 'Subscription not found'; end if;
if p_status='failed' then
 update public.subscription_payments set payment_status='failed',updated_at=now() where id=pay.id returning * into pay;
 update public.canteen_subscriptions set status=case when s.status='suspended' then 'suspended' when s.status='expired' then 'expired' else s.status end,payment_status='failed',updated_at=now() where id=s.id;
 return pay;
end if;
if pay.payment_type='plan_upgrade' then
 select * into p from public.subscription_plans where id=pay.plan_id and active=true;
 if not found then raise exception 'Upgrade plan is not active'; end if;
 if s.status<>'active' or s.billing_cycle<>'annual' then raise exception 'Annual subscription is required for this upgrade'; end if;
 q:=public.get_subscription_upgrade_quote(s.canteen_id,p.id); expected:=coalesce((q->>'additional_amount')::numeric,0);
 if round(pay.amount,2)<>round(expected,2) or expected<=0 then raise exception 'Upgrade payment amount no longer matches the authoritative calculation'; end if;
 update public.subscription_payments set payment_status='paid',updated_at=now(),billing_period_start=s.subscription_start,billing_period_end=s.subscription_end where id=pay.id returning * into pay;
 update public.canteen_subscriptions set plan_id=p.id,amount=p.annual_price,status='active',payment_status='paid',updated_at=now() where id=s.id;
 return pay;
end if;
cycle:=coalesce(p_billing_cycle,pay.billing_cycle,s.billing_cycle,'monthly');
if cycle not in ('monthly','annual') then raise exception 'Billing cycle must be monthly or annual'; end if;
select * into p from public.subscription_plans where id=pay.plan_id and active=true;
if not found then raise exception 'Active subscription plan not found'; end if;
expected:=case when cycle='annual' then p.annual_price else p.monthly_price end;
if round(pay.amount,2)<>round(expected,2) then raise exception 'Verified payment amount does not match the configured subscription price'; end if;
start_at:=pay.billing_period_start; end_at:=pay.billing_period_end;
if start_at is null or end_at is null then period:=public.resolve_subscription_billing_period(s.id,cycle); start_at:=(period->>'billing_period_start')::timestamptz; end_at:=(period->>'billing_period_end')::timestamptz; end if;
update public.subscription_payments set payment_status='paid',billing_cycle=cycle,billing_period_start=start_at,billing_period_end=end_at,updated_at=now() where id=pay.id returning * into pay;
update public.canteen_subscriptions set plan_id=p.id,billing_cycle=cycle,status='active',payment_status='paid',subscription_start=start_at,subscription_end=end_at,amount=expected,currency=p.currency,updated_at=now() where id=s.id;
return pay;
end $$;

create or replace function public.super_admin_set_subscription(p_canteen_id uuid,p_action text,p_plan_id uuid default null,p_trial_days integer default null,p_amount numeric default null,p_currency text default null,p_billing_cycle text default 'monthly',p_plan_selection_mode text default null)
returns public.canteen_subscriptions language plpgsql security definer set search_path=''
as $$
declare v_sub public.canteen_subscriptions; v_plan public.subscription_plans; v_selected_plan_id uuid; v_now timestamptz:=now(); v_trial_days integer; v_amount numeric(12,2); v_currency text; v_cycle text; v_mode text; v_start timestamptz; v_end timestamptz;
begin
if not public.is_super_admin() then raise exception 'Super Admin authorization required'; end if;
if exists(select 1 from public.canteens c where c.id=p_canteen_id and (c.name='GoCanteen' or c.owner_id=(select id from public.profiles where id=(select auth.uid()) and admin_role='super_admin'))) then raise exception 'Super Admin platform canteen is not a customer subscription'; end if;
if not exists(select 1 from public.canteens c where c.id=p_canteen_id) then raise exception 'Canteen not found'; end if;
if p_billing_cycle not in ('monthly','annual') then raise exception 'Billing cycle must be monthly or annual'; end if;
v_cycle:=p_billing_cycle;
select * into v_sub from public.canteen_subscriptions where canteen_id=p_canteen_id;
if p_action in ('activate_trial','start_trial','activate') then
 if p_plan_id is not null then select * into v_plan from public.subscription_plans where id=p_plan_id and (p_action='activate_trial' or active=true); if not found then raise exception 'Selected plan not found or inactive'; end if; v_selected_plan_id:=v_plan.id; end if;
 v_mode:=coalesce(p_plan_selection_mode,case when v_plan.id is not null and v_plan.pricing_model='FIXED_AMOUNT' then 'manual' when v_plan.id is not null and v_plan.id=public.resolve_member_range_plan(p_canteen_id) then 'auto_range' else 'manual' end);
 if v_mode not in ('auto_range','manual') then raise exception 'Invalid plan selection mode'; end if;
 if v_mode='auto_range' then v_selected_plan_id:=public.resolve_member_range_plan(p_canteen_id); if v_selected_plan_id is null then raise exception 'No active MEMBER_RANGE plan matches the current member count'; end if; select * into v_plan from public.subscription_plans where id=v_selected_plan_id;
 else if v_selected_plan_id is null then raise exception 'Plan is required for manual plan selection'; end if; select * into v_plan from public.subscription_plans where id=v_selected_plan_id; if not found then raise exception 'Plan not found'; end if; if not v_plan.active then raise exception 'Inactive plans cannot be selected'; end if; end if;
 if v_plan.pricing_model='FIXED_AMOUNT' then v_mode:='manual'; end if;
 v_amount:=case when v_cycle='annual' then v_plan.annual_price else v_plan.monthly_price end; v_currency:=v_plan.currency;
 if p_action in ('activate_trial','start_trial') then
  v_trial_days:=v_plan.trial_days; if v_trial_days<=0 then raise exception 'Selected plan must have trial days greater than zero'; end if;
  insert into public.canteen_subscriptions(canteen_id,plan_id,status,trial_start,trial_end,subscription_start,subscription_end,amount,currency,payment_status,billing_cycle,plan_selection_mode)
  values(p_canteen_id,v_selected_plan_id,'trial',v_now,v_now+make_interval(days=>v_trial_days),null,null,v_amount,v_currency,'pending',v_cycle,v_mode)
  on conflict(canteen_id) do update set plan_id=excluded.plan_id,status='trial',trial_start=excluded.trial_start,trial_end=excluded.trial_end,subscription_start=null,subscription_end=null,amount=excluded.amount,currency=excluded.currency,payment_status='pending',billing_cycle=excluded.billing_cycle,plan_selection_mode=excluded.plan_selection_mode,updated_at=now()
  returning * into v_sub; return v_sub;
 end if;
 if p_action='activate' then
  v_start:=v_now; v_end:=case v_cycle when 'monthly' then v_start+interval '1 month' when 'annual' then v_start+interval '1 year' end;
  insert into public.canteen_subscriptions(canteen_id,plan_id,status,subscription_start,subscription_end,amount,currency,payment_status,billing_cycle,plan_selection_mode)
  values(p_canteen_id,v_selected_plan_id,'active',v_start,v_end,v_amount,v_currency,'paid',v_cycle,v_mode)
  on conflict(canteen_id) do update set plan_id=excluded.plan_id,status='active',subscription_start=excluded.subscription_start,subscription_end=excluded.subscription_end,amount=excluded.amount,currency=excluded.currency,payment_status='paid',billing_cycle=excluded.billing_cycle,plan_selection_mode=excluded.plan_selection_mode,updated_at=now()
  returning * into v_sub; return v_sub;
 end if;
end if;
if p_action='extend_trial' then
 if v_sub.id is null then raise exception 'Subscription not found'; end if;
 v_trial_days:=coalesce(p_trial_days,0); if v_trial_days<=0 then raise exception 'Extension days must be greater than zero'; end if;
 update public.canteen_subscriptions set status='trial',trial_start=coalesce(trial_start,v_now),trial_end=greatest(coalesce(trial_end,v_now),v_now)+make_interval(days=>v_trial_days),payment_status='pending',updated_at=now() where id=v_sub.id returning * into v_sub; return v_sub;
end if;
if p_action='change_plan' then
 if v_sub.id is null then raise exception 'Subscription not found'; end if;
 if p_plan_id is null then raise exception 'Plan is required'; end if;
 select * into v_plan from public.subscription_plans where id=p_plan_id; if not found then raise exception 'Plan not found'; end if; if not v_plan.active then raise exception 'Inactive plans cannot be selected'; end if;
 v_cycle:=coalesce(nullif(p_billing_cycle,''),v_sub.billing_cycle,'monthly'); v_amount:=case when v_cycle='annual' then v_plan.annual_price else v_plan.monthly_price end;
 update public.canteen_subscriptions set plan_id=p_plan_id,amount=v_amount,currency=v_plan.currency,billing_cycle=v_cycle,plan_selection_mode='manual',updated_at=now() where id=v_sub.id returning * into v_sub; return v_sub;
end if;
if p_action='suspend' then if v_sub.id is null then raise exception 'Subscription not found'; end if; update public.canteen_subscriptions set status='suspended',updated_at=now() where id=v_sub.id returning * into v_sub; return v_sub; end if;
if p_action='payment_pending' then if v_sub.id is null then raise exception 'Subscription not found'; end if; update public.canteen_subscriptions set status='payment_pending',payment_status='pending',updated_at=now() where id=v_sub.id returning * into v_sub; return v_sub; end if;
raise exception 'Unsupported subscription action';
end $$;

-- Repair historical test/customer data created with an overridden trial length.
update public.canteen_subscriptions s
set trial_end=s.trial_start+make_interval(days=>p.trial_days),
    subscription_start=s.trial_start+make_interval(days=>p.trial_days),
    subscription_end=s.trial_start+make_interval(days=>p.trial_days)+case when s.billing_cycle='annual' then interval '1 year' else interval '1 month' end,
    updated_at=now()
from public.subscription_plans p
where p.id=s.plan_id
  and s.trial_start is not null
  and s.trial_end is not null
  and extract(epoch from (s.trial_end-s.trial_start))/86400 > p.trial_days
  and s.status='active'
  and exists(select 1 from public.subscription_payments sp where sp.subscription_id=s.id and sp.payment_status='paid' and sp.payment_type='subscription' and sp.billing_period_start=s.subscription_start);

update public.subscription_payments sp
set billing_period_start=s.trial_start+make_interval(days=>p.trial_days),
    billing_period_end=s.trial_start+make_interval(days=>p.trial_days)+case when sp.billing_cycle='annual' then interval '1 year' else interval '1 month' end,
    updated_at=now()
from public.canteen_subscriptions s
join public.subscription_plans p on p.id=s.plan_id
where sp.subscription_id=s.id
  and sp.payment_status='paid'
  and sp.payment_type='subscription'
  and s.trial_start is not null
  and sp.payment_date < s.trial_start+make_interval(days=>p.trial_days)
  and extract(epoch from (s.trial_end-s.trial_start))/86400 = p.trial_days;

revoke execute on function public.get_canteen_subscription_state(uuid) from public,anon;
grant execute on function public.get_canteen_subscription_state(uuid) to authenticated;
revoke execute on function public.resolve_subscription_billing_period(uuid,text) from public,anon;
grant execute on function public.resolve_subscription_billing_period(uuid,text) to authenticated;