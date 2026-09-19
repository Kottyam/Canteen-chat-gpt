begin;
delete from public.subscription_payments where canteen_id='f8ba1653-e7a2-4687-a819-74b2938af2f4';
delete from public.canteen_subscriptions where canteen_id='f8ba1653-e7a2-4687-a819-74b2938af2f4';

create or replace function public.auto_assign_canteen_trial()
returns trigger language plpgsql security definer set search_path=''
as $function$
declare v_plan public.subscription_plans; v_is_super_admin boolean:=false;
begin
 select exists(select 1 from public.profiles p where p.id=new.owner_id and p.role='admin' and p.admin_role='super_admin' and p.status='active') into v_is_super_admin;
 if v_is_super_admin or new.id='f8ba1653-e7a2-4687-a819-74b2938af2f4' then return new; end if;
 if exists(select 1 from public.canteen_subscriptions s where s.canteen_id=new.id) then return new; end if;
 select * into v_plan from public.subscription_plans where active=true and trial_days>0 and is_default=true order by created_at asc limit 1;
 if not found then
  select * into v_plan from public.subscription_plans where active=true and trial_days>0 order by created_at asc limit 1;
  if (select count(*) from public.subscription_plans where active=true and trial_days>0)<>1 then raise exception 'No unambiguous active default trial plan is configured'; end if;
 end if;
 insert into public.canteen_subscriptions(canteen_id,plan_id,status,trial_start,trial_end,amount,currency,payment_status)
 values(new.id,v_plan.id,'trial',now(),now()+make_interval(days=>v_plan.trial_days),v_plan.price,v_plan.currency,'pending')
 on conflict(canteen_id) do nothing;
 return new;
end;$function$;

create or replace function public.super_admin_set_subscription(p_canteen_id uuid,p_action text,p_plan_id uuid default null,p_trial_days integer default null,p_amount numeric default null,p_currency text default null)
returns public.canteen_subscriptions language plpgsql security definer set search_path=''
as $function$
declare v_sub public.canteen_subscriptions; v_plan public.subscription_plans; v_now timestamptz:=now(); v_trial_days integer; v_amount numeric(12,2); v_currency text; v_start timestamptz; v_end timestamptz;
begin
 if not public.is_super_admin() then raise exception 'Super Admin authorization required'; end if;
 if exists(select 1 from public.canteens c join public.profiles o on o.id=c.owner_id where c.id=p_canteen_id and o.role='admin' and o.admin_role='super_admin' and o.status='active') then raise exception 'Super Admin platform canteen is not a customer subscription'; end if;
 if not exists(select 1 from public.canteens c where c.id=p_canteen_id) then raise exception 'Canteen not found'; end if;
 select * into v_sub from public.canteen_subscriptions where canteen_id=p_canteen_id;
 if p_plan_id is not null then select * into v_plan from public.subscription_plans where id=p_plan_id; if not found then raise exception 'Plan not found'; end if; if p_action in ('start_trial','change_plan','activate') and not v_plan.active then raise exception 'Inactive plans cannot be selected for new or renewed subscriptions'; end if; end if;
 if p_action in ('start_trial','activate','change_plan') and p_plan_id is null and v_sub.id is null then raise exception 'Plan is required'; end if;
 if p_plan_id is not null then v_amount:=coalesce(p_amount,v_plan.price); v_currency:=coalesce(nullif(trim(p_currency),''),v_plan.currency); elsif v_sub.id is not null then v_amount:=coalesce(p_amount,v_sub.amount); v_currency:=coalesce(nullif(trim(p_currency),''),v_sub.currency); else v_amount:=coalesce(p_amount,0); v_currency:=coalesce(nullif(trim(p_currency),''),'INR'); end if;
 if p_action='start_trial' then if p_plan_id is null then p_plan_id:=v_sub.plan_id; end if; select * into v_plan from public.subscription_plans where id=p_plan_id; v_trial_days:=coalesce(p_trial_days,v_plan.trial_days); if v_trial_days<=0 then raise exception 'Trial days must be greater than zero'; end if; insert into public.canteen_subscriptions(canteen_id,plan_id,status,trial_start,trial_end,amount,currency,payment_status) values(p_canteen_id,p_plan_id,'trial',v_now,v_now+make_interval(days=>v_trial_days),v_amount,v_currency,'pending') on conflict(canteen_id) do update set plan_id=excluded.plan_id,status='trial',trial_start=excluded.trial_start,trial_end=excluded.trial_end,subscription_start=null,subscription_end=null,amount=excluded.amount,currency=excluded.currency,payment_status='pending',updated_at=now() returning * into v_sub; return v_sub; end if;
 if p_action='extend_trial' then if v_sub.id is null then raise exception 'Subscription not found'; end if; v_trial_days:=coalesce(p_trial_days,0); if v_trial_days<=0 then raise exception 'Extension days must be greater than zero'; end if; update public.canteen_subscriptions set status='trial',trial_start=coalesce(trial_start,v_now),trial_end=greatest(coalesce(trial_end,v_now),v_now)+make_interval(days=>v_trial_days),payment_status='pending',updated_at=now() where id=v_sub.id returning * into v_sub; return v_sub; end if;
 if p_action='activate' then if p_plan_id is null then p_plan_id:=v_sub.plan_id; end if; select * into v_plan from public.subscription_plans where id=p_plan_id; if not found then raise exception 'Plan not found'; end if; if not v_plan.active then raise exception 'Inactive plans cannot be activated'; end if; v_start:=v_now; v_end:=case v_plan.billing_period when 'monthly' then v_start+interval '1 month' when 'quarterly' then v_start+interval '3 months' when 'yearly' then v_start+interval '1 year' end; insert into public.canteen_subscriptions(canteen_id,plan_id,status,subscription_start,subscription_end,amount,currency,payment_status) values(p_canteen_id,p_plan_id,'active',v_start,v_end,v_amount,v_currency,'paid') on conflict(canteen_id) do update set plan_id=excluded.plan_id,status='active',subscription_start=excluded.subscription_start,subscription_end=excluded.subscription_end,amount=excluded.amount,currency=excluded.currency,payment_status='paid',updated_at=now() returning * into v_sub; return v_sub; end if;
 if p_action='change_plan' then if v_sub.id is null then raise exception 'Subscription not found'; end if; if p_plan_id is null then raise exception 'Plan is required'; end if; update public.canteen_subscriptions set plan_id=p_plan_id,amount=v_amount,currency=v_currency,updated_at=now() where id=v_sub.id returning * into v_sub; return v_sub; end if;
 if p_action='suspend' then if v_sub.id is null then raise exception 'Subscription not found'; end if; update public.canteen_subscriptions set status='suspended',updated_at=now() where id=v_sub.id returning * into v_sub; return v_sub; end if;
 if p_action='payment_pending' then if v_sub.id is null then raise exception 'Subscription not found'; end if; update public.canteen_subscriptions set status='payment_pending',payment_status='pending',updated_at=now() where id=v_sub.id returning * into v_sub; return v_sub; end if;
 raise exception 'Unsupported subscription action';
end;$function$;

create or replace function public.super_admin_platform_stats()
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare v_result jsonb;
begin
 if not public.is_super_admin() then raise exception 'Super Admin authorization required'; end if;
 perform public.sync_subscription_statuses(null);
 select jsonb_build_object(
 'total_canteens',(select count(*) from public.canteens c where not exists(select 1 from public.profiles p where p.id=c.owner_id and p.role='admin' and p.admin_role='super_admin' and p.status='active')),
 'active_canteens',(select count(*) from public.canteens c join public.canteen_subscriptions s on s.canteen_id=c.id where s.status='active' and not exists(select 1 from public.profiles p where p.id=c.owner_id and p.role='admin' and p.admin_role='super_admin' and p.status='active')),
 'trial_canteens',(select count(*) from public.canteen_subscriptions s join public.canteens c on c.id=s.canteen_id where s.status='trial' and not exists(select 1 from public.profiles p where p.id=c.owner_id and p.role='admin' and p.admin_role='super_admin' and p.status='active')),
 'payment_pending',(select count(*) from public.canteen_subscriptions s join public.canteens c on c.id=s.canteen_id where s.status='payment_pending' and not exists(select 1 from public.profiles p where p.id=c.owner_id and p.role='admin' and p.admin_role='super_admin' and p.status='active')),
 'expired',(select count(*) from public.canteen_subscriptions s join public.canteens c on c.id=s.canteen_id where s.status='expired' and not exists(select 1 from public.profiles p where p.id=c.owner_id and p.role='admin' and p.admin_role='super_admin' and p.status='active')),
 'suspended',(select count(*) from public.canteen_subscriptions s join public.canteens c on c.id=s.canteen_id where s.status='suspended' and not exists(select 1 from public.profiles p where p.id=c.owner_id and p.role='admin' and p.admin_role='super_admin' and p.status='active')),
 'total_employees',(select count(*) from public.profiles p where p.role='employee' and not exists(select 1 from public.canteens c join public.profiles o on o.id=c.owner_id where c.id=p.canteen_id and o.role='admin' and o.admin_role='super_admin' and o.status='active')),
 'total_admins',(select count(*) from public.profiles p where p.role='admin' and p.admin_role<>'super_admin' and p.canteen_id is not null and not exists(select 1 from public.canteens c join public.profiles o on o.id=c.owner_id where c.id=p.canteen_id and o.role='admin' and o.admin_role='super_admin' and o.status='active'))
 ) into v_result; return v_result;
end;$function$;
commit;