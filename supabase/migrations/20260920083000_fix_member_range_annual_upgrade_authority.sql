-- Preserve annual upgrade behavior when a higher slab is within the same MEMBER_RANGE plan.
create or replace function public.get_subscription_upgrade_quote(p_canteen_id uuid,p_new_plan_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare v_uid uuid:=auth.uid(); v_sub public.canteen_subscriptions; v_old public.subscription_plans; v_new public.subscription_plans; v_new_id uuid; v_members integer; v_remaining integer; v_current_annual numeric(12,2); v_new_annual numeric(12,2); v_old_monthly numeric(12,2); v_new_monthly numeric(12,2); v_diff numeric(12,2); v_amount numeric(12,2);
begin
if v_uid is null then raise exception 'Authentication required'; end if;
if not(public.is_super_admin() or public.current_canteen_id()=p_canteen_id) then raise exception 'Not authorized'; end if;
select * into v_sub from public.canteen_subscriptions where canteen_id=p_canteen_id; if not found then raise exception 'Subscription not found'; end if;
if v_sub.status<>'active' or v_sub.billing_cycle<>'annual' then return jsonb_build_object('required',false,'reason','upgrade_only_applies_to_active_annual_subscriptions'); end if;
select * into v_old from public.subscription_plans where id=v_sub.plan_id; if not found then raise exception 'Current plan not found'; end if;
v_members:=(select count(*)::integer from public.profiles e where e.canteen_id=p_canteen_id and e.role='employee' and e.status='active');
v_new_id:=coalesce(p_new_plan_id,case when v_sub.plan_selection_mode='auto_range' then public.resolve_member_range_plan(p_canteen_id) else null end);
if v_new_id is null then return jsonb_build_object('required',false,'active_members',v_members,'current_plan_id',v_old.id); end if;
select * into v_new from public.subscription_plans where id=v_new_id and active=true; if not found then raise exception 'New plan not found'; end if;
if v_new.pricing_model='MEMBER_RANGE' then select r.annual_price into v_new_annual from public.subscription_plan_ranges r where r.plan_id=v_new.id and r.min_members<=v_members and r.max_members>=v_members order by r.min_members desc limit 1; if v_new_annual is null then return jsonb_build_object('required',false,'active_members',v_members,'current_plan_id',v_old.id,'reason','new_plan_member_count_exceeds_configured_range'); end if; else v_new_annual:=v_new.monthly_price; end if;
v_current_annual:=v_sub.amount; v_old_monthly:=round(v_current_annual/12,2); v_new_monthly:=round(v_new_annual/12,2); v_diff:=round(v_new_monthly-v_old_monthly,2);
select greatest(0,count(*)::integer) into v_remaining from generate_series(1,120) g(n) where now()+(g.n*interval '1 month')<v_sub.subscription_end;
v_amount:=greatest(0,round(v_diff*v_remaining,2));
return jsonb_build_object('required',v_amount>0,'active_members',v_members,'current_plan_id',v_old.id,'current_plan_name',v_old.name,'current_monthly_equivalent',v_old_monthly,'new_plan_id',v_new.id,'new_plan_name',v_new.name,'new_monthly_equivalent',v_new_monthly,'monthly_difference',v_diff,'remaining_full_months',v_remaining,'additional_amount',v_amount,'currency',v_new.currency,'original_subscription_start',v_sub.subscription_start,'original_subscription_end',v_sub.subscription_end);
end $$;

create or replace function public.super_admin_review_subscription_payment(p_payment_id uuid,p_status text,p_billing_cycle text default null)
returns public.subscription_payments language plpgsql security definer set search_path=''
as $$
declare pay public.subscription_payments; s public.canteen_subscriptions; p public.subscription_plans; q jsonb; cycle text; start_at timestamptz; end_at timestamptz; expected numeric(12,2); full_new_amount numeric(12,2); members integer;
begin
if not public.is_super_admin() then raise exception 'Super Admin authorization required'; end if;
if p_status not in ('paid','failed') then raise exception 'Review status must be paid or failed'; end if;
select * into pay from public.subscription_payments where id=p_payment_id for update; if not found then raise exception 'Payment not found'; end if;
if pay.payment_status<>'pending' then raise exception 'Only pending payments can be reviewed'; end if;
select * into s from public.canteen_subscriptions where id=pay.subscription_id for update; if not found then raise exception 'Subscription not found'; end if;
if p_status='failed' then update public.subscription_payments set payment_status='failed',updated_at=now() where id=pay.id returning * into pay; update public.canteen_subscriptions set payment_status='failed',updated_at=now() where id=s.id; return pay; end if;
if pay.payment_type='plan_upgrade' then
 select * into p from public.subscription_plans where id=pay.plan_id and active=true; if not found then raise exception 'Upgrade plan is not active'; end if;
 if s.status<>'active' or s.billing_cycle<>'annual' then raise exception 'Annual subscription is required for this upgrade'; end if;
 q:=public.get_subscription_upgrade_quote(s.canteen_id,p.id); expected:=coalesce((q->>'additional_amount')::numeric,0); if round(pay.amount,2)<>round(expected,2) or expected<=0 then raise exception 'Upgrade payment amount no longer matches the authoritative calculation'; end if;
 members:=(select count(*)::integer from public.profiles e where e.canteen_id=s.canteen_id and e.role='employee' and e.status='active');
 if p.pricing_model='MEMBER_RANGE' then select r.annual_price into full_new_amount from public.subscription_plan_ranges r where r.plan_id=p.id and r.min_members<=members and r.max_members>=members order by r.min_members desc limit 1; if full_new_amount is null then raise exception 'Current member count exceeds the configured pricing range for the upgraded plan'; end if; else full_new_amount:=p.monthly_price; end if;
 update public.subscription_payments set payment_status='paid',billing_period_start=s.subscription_start,billing_period_end=s.subscription_end,updated_at=now() where id=pay.id returning * into pay;
 update public.canteen_subscriptions set plan_id=p.id,amount=full_new_amount,status='active',payment_status='paid',updated_at=now() where id=s.id;
 return pay;
end if;
cycle:=coalesce(pay.billing_cycle,s.billing_cycle); if cycle not in ('monthly','annual') then raise exception 'Billing cycle must be monthly or annual'; end if;
select * into p from public.subscription_plans where id=pay.plan_id and active=true; if not found then raise exception 'Active subscription plan not found'; end if;
q:=public.get_subscription_billing_quote(s.canteen_id); if coalesce((q->>'required')::boolean,false)=false then raise exception '%',coalesce(q->>'message','Subscription pricing is not currently configured.'); end if;
if (q->>'billing_cycle')<>cycle then raise exception 'The configured billing cycle changed after payment submission'; end if;
expected:=(q->>'amount')::numeric; if round(pay.amount,2)<>round(expected,2) then raise exception 'Verified payment amount does not match the current configured subscription price'; end if;
start_at:=pay.billing_period_start; end_at:=pay.billing_period_end; if start_at is null or end_at is null then q:=public.resolve_subscription_billing_period(s.id,cycle); start_at:=(q->>'billing_period_start')::timestamptz; end_at:=(q->>'billing_period_end')::timestamptz; end if;
update public.subscription_payments set payment_status='paid',billing_cycle=cycle,billing_period_start=start_at,billing_period_end=end_at,updated_at=now() where id=pay.id returning * into pay;
update public.canteen_subscriptions set plan_id=pay.plan_id,billing_cycle=cycle,status='active',payment_status='paid',subscription_start=start_at,subscription_end=end_at,amount=expected,currency=p.currency,updated_at=now() where id=s.id;
return pay;
end $$;