-- Targeted fix for the two confirmed subscription production bugs.
-- 1) Disambiguate subscription status sync scheduler call.
-- 2) Re-resolve authoritative billing period during payment confirmation.

create or replace function private.subscription_notification_scheduler()
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  r record;
  v_days integer;
  v_end timestamptz;
  v_event_key text;
begin
  -- The UUID overload has a DEFAULT argument, so an unqualified zero-argument
  -- call is ambiguous with the true zero-argument overload. NULL::uuid
  -- explicitly selects the tenant-scoped overload while preserving the
  -- system-wide scheduler behavior.
  perform private.sync_subscription_statuses_system(null::uuid);

  for r in
    select s.id,s.canteen_id,s.status,s.trial_end,s.subscription_end
    from public.canteen_subscriptions s
    where s.status in ('trial','active')
  loop
    if r.status='trial' then
      v_end:=r.trial_end;
      v_days:=((v_end at time zone 'Asia/Kolkata')::date-v_today);
      if v_days in (7,3,1) then
        v_event_key:=format('trial_expiring:%s:%s:%s',r.id,v_end::text,v_days);
        perform private.create_super_admin_subscription_notification(
          r.canteen_id,'trial_expiring','Trial Expiring',
          format('A canteen trial ends in %s day%s.',v_days,case when v_days=1 then '' else 's' end),
          jsonb_build_object('screen','payment_review','subscription_id',r.id,'trial_end',v_end,'days_remaining',v_days),
          v_event_key
        );
        perform private.create_canteen_subscription_notification(
          r.canteen_id,'trial_expiring','Trial Expiring',
          format('Your trial ends in %s day%s. Please complete your subscription payment to continue using GoCanteen.',v_days,case when v_days=1 then '' else 's' end),
          jsonb_build_object('screen','billing_subscription','subscription_id',r.id,'trial_end',v_end,'days_remaining',v_days),
          v_event_key
        );
      end if;
    else
      v_end:=r.subscription_end;
      v_days:=((v_end at time zone 'Asia/Kolkata')::date-v_today);
      if v_days in (7,3,1) then
        v_event_key:=format('subscription_expiring:%s:%s:%s',r.id,v_end::text,v_days);
        perform private.create_super_admin_subscription_notification(
          r.canteen_id,'subscription_expiring','Subscription Expiring',
          format('%s subscription expires in %s day%s.',coalesce((select c.name from public.canteens c where c.id=r.canteen_id),'Canteen'),v_days,case when v_days=1 then '' else 's' end),
          jsonb_build_object('screen','payment_review','subscription_id',r.id,'subscription_end',v_end,'days_remaining',v_days),
          v_event_key
        );
        perform private.create_canteen_subscription_notification(
          r.canteen_id,'subscription_expiring','Subscription Expiring',
          format('Your subscription expires in %s day%s. Please complete renewal payment to continue using GoCanteen.',v_days,case when v_days=1 then '' else 's' end),
          jsonb_build_object('screen','billing_subscription','subscription_id',r.id,'subscription_end',v_end,'days_remaining',v_days),
          v_event_key
        );
      end if;
    end if;
  end loop;
end
$function$;

create or replace function public.super_admin_review_subscription_payment(
  p_payment_id uuid,
  p_status text,
  p_billing_cycle text default null
)
returns public.subscription_payments
language plpgsql
security definer
set search_path to ''
as $function$
declare
  pay public.subscription_payments;
  s public.canteen_subscriptions;
  p public.subscription_plans;
  quote jsonb;
  cycle text;
  start_at timestamptz;
  end_at timestamptz;
  expected numeric(12,2);
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
    update public.canteen_subscriptions set payment_status='failed',updated_at=now() where id=s.id;
    return pay;
  end if;

  cycle:=coalesce(p_billing_cycle,pay.billing_cycle,s.billing_cycle,'monthly');
  if cycle not in ('monthly','annual') then raise exception 'Billing cycle must be monthly or annual'; end if;
  select * into p from public.subscription_plans where id=pay.plan_id and active=true;
  if not found then raise exception 'Active subscription plan not found'; end if;
  if not public.subscription_cycle_supported(p.billing_availability,cycle) then raise exception 'Selected billing cycle is not available for this plan'; end if;
  quote:=public.get_subscription_billing_quote(s.canteen_id,cycle);
  if coalesce((quote->>'required')::boolean,false)=false then raise exception '%',coalesce(quote->>'message','Subscription pricing is not currently configured.'); end if;
  if (quote->>'plan_id')::uuid<>pay.plan_id then raise exception 'Subscription plan changed after payment submission; payment must be resubmitted'; end if;
  expected:=(quote->>'amount')::numeric;
  if round(pay.amount,2)<>round(expected,2) then raise exception 'Verified payment amount does not match the current configured subscription price'; end if;

  -- Always recompute from the authoritative subscription state at review time.
  quote:=public.resolve_subscription_billing_period(s.id,cycle);
  start_at:=(quote->>'billing_period_start')::timestamptz;
  end_at:=(quote->>'billing_period_end')::timestamptz;

  update public.subscription_payments
  set payment_status='paid',billing_cycle=cycle,billing_period_start=start_at,billing_period_end=end_at,updated_at=now()
  where id=pay.id returning * into pay;

  update public.canteen_subscriptions
  set plan_id=pay.plan_id,billing_cycle=cycle,status='active',payment_status='paid',
      subscription_start=start_at,subscription_end=end_at,amount=expected,currency=p.currency,updated_at=now()
  where id=s.id;
  return pay;
end;
$function$;