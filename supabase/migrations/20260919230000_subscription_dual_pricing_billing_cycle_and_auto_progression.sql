-- Extend the existing subscription architecture with dual-cycle plan pricing,
-- explicit subscription billing cycles, and an explicit automatic/manual plan mode.
-- No duplicate subscription, payment, or plan tables are introduced.

begin;

alter table public.subscription_plans
  add column if not exists monthly_price numeric(12,2),
  add column if not exists annual_price numeric(12,2);

update public.subscription_plans
set
  monthly_price = case billing_period
    when 'yearly' then round(price / 12, 2)
    when 'quarterly' then round(price / 3, 2)
    else price
  end,
  annual_price = case billing_period
    when 'yearly' then price
    when 'quarterly' then round(price * 4, 2)
    else round(price * 12, 2)
  end
where monthly_price is null or annual_price is null;

alter table public.subscription_plans
  alter column monthly_price set not null,
  alter column annual_price set not null;

alter table public.subscription_plans
  drop constraint if exists subscription_plans_monthly_price_check,
  drop constraint if exists subscription_plans_annual_price_check;

alter table public.subscription_plans
  add constraint subscription_plans_monthly_price_check check (monthly_price >= 0),
  add constraint subscription_plans_annual_price_check check (annual_price >= 0);

alter table public.canteen_subscriptions
  add column if not exists billing_cycle text not null default 'monthly',
  add column if not exists plan_selection_mode text not null default 'manual';

alter table public.canteen_subscriptions
  drop constraint if exists canteen_subscriptions_billing_cycle_check,
  drop constraint if exists canteen_subscriptions_plan_selection_mode_check;

alter table public.canteen_subscriptions
  add constraint canteen_subscriptions_billing_cycle_check
    check (billing_cycle in ('monthly','annual')),
  add constraint canteen_subscriptions_plan_selection_mode_check
    check (plan_selection_mode in ('auto_range','manual'));

alter table public.subscription_payments
  add column if not exists billing_cycle text;

update public.canteen_subscriptions s
set billing_cycle = case
  when p.billing_period = 'yearly' then 'annual'
  else 'monthly'
end
from public.subscription_plans p
where p.id = s.plan_id;

update public.subscription_payments sp
set billing_cycle = s.billing_cycle
from public.canteen_subscriptions s
where s.id = sp.subscription_id
  and sp.billing_cycle is null;

alter table public.subscription_payments
  drop constraint if exists subscription_payments_billing_cycle_check;

alter table public.subscription_payments
  add constraint subscription_payments_billing_cycle_check
    check (billing_cycle is null or billing_cycle in ('monthly','annual'));

-- Keep the legacy price/billing_period columns as compatibility aliases.
-- The new monthly_price/annual_price fields are authoritative.
create or replace function public.validate_subscription_plan_member_range()
returns trigger
language plpgsql
security definer
set search_path=''
as $function$
begin
  if not public.is_super_admin() then
    raise exception 'Super Admin authorization required';
  end if;

  if new.pricing_model not in ('MEMBER_RANGE','FIXED_AMOUNT') then
    raise exception 'Invalid pricing model';
  end if;

  if new.monthly_price is null or new.monthly_price < 0
     or new.annual_price is null or new.annual_price < 0 then
    raise exception 'Monthly and Annual prices must be zero or greater';
  end if;

  if new.pricing_model='MEMBER_RANGE' then
    if new.min_members is null or new.max_members is null
       or new.min_members < 0 or new.max_members < new.min_members then
      raise exception 'Invalid member range: Minimum Members must be >= 0 and Maximum Members must be >= Minimum Members';
    end if;

    if new.active and exists (
      select 1
      from public.subscription_plans p
      where p.id <> new.id
        and p.active
        and p.pricing_model='MEMBER_RANGE'
        and new.min_members <= p.max_members
        and p.min_members <= new.max_members
    ) then
      raise exception 'Active plan member range overlaps another active plan';
    end if;
  else
    new.min_members := null;
    new.max_members := null;
  end if;

  -- Backward-compatible aliases for older readers.
  new.price := new.monthly_price;
  new.billing_period := 'monthly';

  return new;
end;
$function$;

-- Internal helper: not exposed as a client RPC. It resolves the single active
-- MEMBER_RANGE plan applicable to the current active employee count.
create or replace function public.resolve_member_range_plan(p_canteen_id uuid)
returns uuid
language sql
stable
set search_path=''
as $function$
  select p.id
  from public.subscription_plans p
  where p.active
    and p.pricing_model='MEMBER_RANGE'
    and p.min_members <= (
      select count(*)::integer
      from public.profiles e
      where e.canteen_id=p_canteen_id
        and e.role='employee'
        and e.status='active'
    )
    and p.max_members >= (
      select count(*)::integer
      from public.profiles e
      where e.canteen_id=p_canteen_id
        and e.role='employee'
        and e.status='active'
    )
  order by p.min_members desc, p.created_at asc
  limit 1
$function$;

revoke execute on function public.resolve_member_range_plan(uuid) from public, anon, authenticated;

-- Existing customer subscriptions are preserved. We cannot infer whether an
-- old assignment was intentionally overridden, so legacy rows remain manual.
update public.canteen_subscriptions
set plan_selection_mode='manual'
where plan_selection_mode is distinct from 'manual';

-- Replace the existing Super Admin subscription RPC rather than creating a
-- parallel subscription system.
drop function if exists public.super_admin_set_subscription(uuid,text,uuid,integer,numeric,text);

create or replace function public.super_admin_set_subscription(
  p_canteen_id uuid,
  p_action text,
  p_plan_id uuid default null,
  p_trial_days integer default null,
  p_amount numeric default null,
  p_currency text default null,
  p_billing_cycle text default 'monthly',
  p_plan_selection_mode text default null
)
returns public.canteen_subscriptions
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_sub public.canteen_subscriptions;
  v_plan public.subscription_plans;
  v_selected_plan_id uuid;
  v_now timestamptz := now();
  v_trial_days integer;
  v_amount numeric(12,2);
  v_currency text;
  v_cycle text;
  v_mode text;
  v_start timestamptz;
  v_end timestamptz;
begin
  if not public.is_super_admin() then
    raise exception 'Super Admin authorization required';
  end if;

  if exists(
    select 1 from public.canteens c
    where c.id=p_canteen_id
      and (
        c.name='GoCanteen'
        or c.owner_id=(select id from public.profiles where id=(select auth.uid()) and admin_role='super_admin')
      )
  ) then
    raise exception 'Super Admin platform canteen is not a customer subscription';
  end if;

  if not exists(select 1 from public.canteens c where c.id=p_canteen_id) then
    raise exception 'Canteen not found';
  end if;

  if p_billing_cycle not in ('monthly','annual') then
    raise exception 'Billing cycle must be monthly or annual';
  end if;
  v_cycle := p_billing_cycle;

  select * into v_sub
  from public.canteen_subscriptions
  where canteen_id=p_canteen_id;

  if p_action in ('activate_trial','start_trial','activate') then
    if p_plan_id is not null then
      select * into v_plan
      from public.subscription_plans
      where id=p_plan_id and (p_action='activate_trial' or active=true);
      if not found then raise exception 'Selected plan not found or inactive'; end if;
      v_selected_plan_id := v_plan.id;
    end if;

    v_mode := coalesce(p_plan_selection_mode, case
      when v_plan.id is not null and v_plan.pricing_model='FIXED_AMOUNT' then 'manual'
      when v_plan.id is not null
       and v_plan.id=public.resolve_member_range_plan(p_canteen_id) then 'auto_range'
      else 'manual'
    end);

    if v_mode not in ('auto_range','manual') then
      raise exception 'Invalid plan selection mode';
    end if;

    if v_mode='auto_range' then
      v_selected_plan_id := public.resolve_member_range_plan(p_canteen_id);
      if v_selected_plan_id is null then
        raise exception 'No active MEMBER_RANGE plan matches the current member count';
      end if;
      select * into v_plan from public.subscription_plans where id=v_selected_plan_id;
      if v_plan.pricing_model <> 'MEMBER_RANGE' then
        raise exception 'Automatic range selection requires a MEMBER_RANGE plan';
      end if;
    else
      if v_selected_plan_id is null then
        raise exception 'Plan is required for manual plan selection';
      end if;
      select * into v_plan from public.subscription_plans where id=v_selected_plan_id;
      if not found then raise exception 'Plan not found'; end if;
      if not v_plan.active then raise exception 'Inactive plans cannot be selected'; end if;
    end if;

    if v_plan.pricing_model='FIXED_AMOUNT' then
      v_mode := 'manual';
    end if;

    v_amount := case when v_cycle='annual' then v_plan.annual_price else v_plan.monthly_price end;
    v_currency := v_plan.currency;

    if p_action='activate_trial' or p_action='start_trial' then
      v_trial_days := coalesce(p_trial_days,v_plan.trial_days);
      if v_trial_days<=0 then raise exception 'Selected plan must have trial days greater than zero'; end if;

      insert into public.canteen_subscriptions(
        canteen_id,plan_id,status,trial_start,trial_end,
        subscription_start,subscription_end,amount,currency,payment_status,
        billing_cycle,plan_selection_mode
      )
      values(
        p_canteen_id,v_selected_plan_id,'trial',v_now,
        v_now+make_interval(days=>v_trial_days),
        null,null,v_amount,v_currency,'pending',v_cycle,v_mode
      )
      on conflict(canteen_id) do update set
        plan_id=excluded.plan_id,status='trial',trial_start=excluded.trial_start,
        trial_end=excluded.trial_end,subscription_start=null,subscription_end=null,
        amount=excluded.amount,currency=excluded.currency,payment_status='pending',
        billing_cycle=excluded.billing_cycle,plan_selection_mode=excluded.plan_selection_mode,
        updated_at=now()
      returning * into v_sub;
      return v_sub;
    end if;

    if p_action='activate' then
      v_start:=v_now;
      v_end:=case v_cycle
        when 'monthly' then v_start+interval '1 month'
        when 'annual' then v_start+interval '1 year'
      end;

      insert into public.canteen_subscriptions(
        canteen_id,plan_id,status,subscription_start,subscription_end,
        amount,currency,payment_status,billing_cycle,plan_selection_mode
      )
      values(
        p_canteen_id,v_selected_plan_id,'active',v_start,v_end,
        v_amount,v_currency,'paid',v_cycle,v_mode
      )
      on conflict(canteen_id) do update set
        plan_id=excluded.plan_id,status='active',
        subscription_start=excluded.subscription_start,subscription_end=excluded.subscription_end,
        amount=excluded.amount,currency=excluded.currency,payment_status='paid',
        billing_cycle=excluded.billing_cycle,plan_selection_mode=excluded.plan_selection_mode,
        updated_at=now()
      returning * into v_sub;
      return v_sub;
    end if;
  end if;

  if p_action='extend_trial' then
    if v_sub.id is null then raise exception 'Subscription not found'; end if;
    v_trial_days:=coalesce(p_trial_days,0);
    if v_trial_days<=0 then raise exception 'Extension days must be greater than zero'; end if;
    update public.canteen_subscriptions
    set status='trial',
        trial_start=coalesce(trial_start,v_now),
        trial_end=greatest(coalesce(trial_end,v_now),v_now)+make_interval(days=>v_trial_days),
        payment_status='pending',
        updated_at=now()
    where id=v_sub.id
    returning * into v_sub;
    return v_sub;
  end if;

  if p_action='change_plan' then
    if v_sub.id is null then raise exception 'Subscription not found'; end if;
    if p_plan_id is null then raise exception 'Plan is required'; end if;
    select * into v_plan from public.subscription_plans where id=p_plan_id;
    if not found then raise exception 'Plan not found'; end if;
    if not v_plan.active then raise exception 'Inactive plans cannot be selected'; end if;
    v_cycle:=coalesce(nullif(p_billing_cycle,''),v_sub.billing_cycle,'monthly');
    v_amount:=case when v_cycle='annual' then v_plan.annual_price else v_plan.monthly_price end;
    update public.canteen_subscriptions
    set plan_id=p_plan_id,amount=v_amount,currency=v_plan.currency,
        billing_cycle=v_cycle,plan_selection_mode='manual',updated_at=now()
    where id=v_sub.id
    returning * into v_sub;
    return v_sub;
  end if;

  if p_action='suspend' then
    if v_sub.id is null then raise exception 'Subscription not found'; end if;
    update public.canteen_subscriptions set status='suspended',updated_at=now()
    where id=v_sub.id returning * into v_sub;
    return v_sub;
  end if;

  if p_action='payment_pending' then
    if v_sub.id is null then raise exception 'Subscription not found'; end if;
    update public.canteen_subscriptions
    set status='payment_pending',payment_status='pending',updated_at=now()
    where id=v_sub.id returning * into v_sub;
    return v_sub;
  end if;

  raise exception 'Unsupported subscription action';
end;
$function$;

revoke execute on function public.super_admin_set_subscription(uuid,text,uuid,integer,numeric,text,text,text) from public, anon;\ngrant execute on function public.super_admin_set_subscription(uuid,text,uuid,integer,numeric,text,text,text) to authenticated;

-- Replace the payment submission RPC with cycle-aware validation.
drop function if exists public.canteen_submit_subscription_payment(uuid,numeric,text,date,text);

create or replace function public.canteen_submit_subscription_payment(
  p_subscription_id uuid,
  p_amount numeric,
  p_reference text,
  p_payment_date date,
  p_note text default null
)
returns public.subscription_payments
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_sub public.canteen_subscriptions;
  v_payment public.subscription_payments;
  v_canteen_id uuid;
  v_plan public.subscription_plans;
  v_expected numeric(12,2);
  v_original_status text;
begin
  if auth.uid() is null or not public.is_active_canteen_admin() then
    raise exception 'Canteen Admin authorization required';
  end if;

  v_canteen_id:=public.current_canteen_id();
  if v_canteen_id is null then raise exception 'Canteen is not configured'; end if;
  if exists(select 1 from public.canteens where id=v_canteen_id and archived=true) then
    raise exception 'Archived Canteens cannot submit subscription payments';
  end if;

  if p_amount is null or p_amount <= 0 then raise exception 'Payment amount must be greater than zero'; end if;
  if nullif(trim(coalesce(p_reference,'')),'') is null then raise exception 'Payment reference is required'; end if;
  if p_payment_date is null then raise exception 'Payment date is required'; end if;

  select * into v_sub
  from public.canteen_subscriptions
  where id=p_subscription_id and canteen_id=v_canteen_id
  for update;
  if not found then raise exception 'Subscription not found'; end if;

  if v_sub.status not in ('payment_pending','expired','suspended') then
    raise exception 'Payment is not currently required for this subscription';
  end if;

  v_original_status:=v_sub.status;

  select * into v_plan from public.subscription_plans where id=v_sub.plan_id;
  if not found then raise exception 'Plan not found'; end if;
  v_expected:=case when v_sub.billing_cycle='annual' then v_plan.annual_price else v_plan.monthly_price end;

  if round(p_amount,2) <> round(v_expected,2) then
    raise exception 'Payment amount must match the configured % subscription price', v_sub.billing_cycle;
  end if;

  if exists(select 1 from public.subscription_payments where subscription_id=v_sub.id and payment_status='pending') then
    raise exception 'A payment is already pending review for this subscription';
  end if;

  insert into public.subscription_payments(
    canteen_id,subscription_id,plan_id,amount,currency,payment_date,payment_status,
    transaction_reference,payment_provider,payment_note,billing_cycle
  )
  values(
    v_canteen_id,v_sub.id,v_sub.plan_id,p_amount,v_sub.currency,p_payment_date::timestamptz,
    'pending',trim(p_reference),'manual',nullif(trim(coalesce(p_note,'')),''),
    v_sub.billing_cycle
  )
  returning * into v_payment;

  update public.canteen_subscriptions
  set payment_status='pending',
      status=case when v_original_status='suspended' then 'suspended' else 'payment_pending' end,
      updated_at=now()
  where id=v_sub.id;

  return v_payment;
end;
$function$;

revoke execute on function public.canteen_submit_subscription_payment(uuid,numeric,text,date,text) from public, anon;\ngrant execute on function public.canteen_submit_subscription_payment(uuid,numeric,text,date,text) to authenticated;

-- Replace the existing payment-review RPC. The same RPC now records the
-- verified cycle and activates the subscription in that cycle.
drop function if exists public.super_admin_review_subscription_payment(uuid,text);

create or replace function public.super_admin_review_subscription_payment(
  p_payment_id uuid,
  p_status text,
  p_billing_cycle text default null
)
returns public.subscription_payments
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_payment public.subscription_payments;
  v_sub public.canteen_subscriptions;
  v_plan public.subscription_plans;
  v_start timestamptz;
  v_end timestamptz;
  v_original_status text;
  v_cycle text;
  v_expected numeric(12,2);
  v_next_plan_id uuid;
begin
  if not public.is_super_admin() then raise exception 'Super Admin authorization required'; end if;
  if p_status not in ('paid','failed') then raise exception 'Review status must be paid or failed'; end if;
  if p_billing_cycle is not null and p_billing_cycle not in ('monthly','annual') then
    raise exception 'Billing cycle must be monthly or annual';
  end if;

  select * into v_payment from public.subscription_payments where id=p_payment_id for update;
  if not found then raise exception 'Payment not found'; end if;
  if v_payment.payment_status <> 'pending' then raise exception 'Only pending payments can be reviewed'; end if;

  select * into v_sub from public.canteen_subscriptions where id=v_payment.subscription_id for update;
  if not found then raise exception 'Subscription not found'; end if;
  v_original_status:=v_sub.status;

  if p_status='paid' then
    v_cycle:=coalesce(p_billing_cycle,v_sub.billing_cycle,'monthly');

    if v_sub.plan_selection_mode='auto_range' then
      v_next_plan_id:=public.resolve_member_range_plan(v_sub.canteen_id);
      if v_next_plan_id is null then
        raise exception 'No active MEMBER_RANGE plan matches the current member count';
      end if;
      select * into v_plan from public.subscription_plans where id=v_next_plan_id and active=true;
    else
      select * into v_plan from public.subscription_plans where id=v_sub.plan_id and active=true;
    end if;

    if not found then raise exception 'Active subscription plan not found'; end if;

    v_expected:=case when v_cycle='annual' then v_plan.annual_price else v_plan.monthly_price end;
    if round(v_payment.amount,2) <> round(v_expected,2) then
      raise exception 'Verified payment amount does not match the selected % subscription price', v_cycle;
    end if;

    v_start:=case
      when v_sub.subscription_end is not null and v_sub.subscription_end > now() then v_sub.subscription_end
      else now()
    end;

    v_end:=case v_cycle
      when 'monthly' then v_start+interval '1 month'
      when 'annual' then v_start+interval '1 year'
    end;

    update public.subscription_payments
    set payment_status='paid',
        plan_id=v_plan.id,
        billing_cycle=v_cycle,
        updated_at=now(),
        billing_period_start=v_start,
        billing_period_end=v_end
    where id=v_payment.id
    returning * into v_payment;

    update public.canteen_subscriptions
    set plan_id=v_plan.id,
        plan_selection_mode=v_sub.plan_selection_mode,
        billing_cycle=v_cycle,
        status='active',
        payment_status='paid',
        subscription_start=v_start,
        subscription_end=v_end,
        amount=v_expected,
        currency=v_plan.currency,
        updated_at=now()
    where id=v_sub.id;
  else
    update public.subscription_payments
    set payment_status='failed',updated_at=now()
    where id=v_payment.id
    returning * into v_payment;

    update public.canteen_subscriptions
    set status=case when v_original_status='suspended' then 'suspended' else 'payment_pending' end,
        payment_status='failed',updated_at=now()
    where id=v_sub.id;
  end if;

  return v_payment;
end;
$function$;

revoke execute on function public.super_admin_review_subscription_payment(uuid,text,text) from public, anon;\ngrant execute on function public.super_admin_review_subscription_payment(uuid,text,text) to authenticated;

-- Status synchronization keeps the current paid period intact. Automatic
-- MEMBER_RANGE progression happens only when the old period has ended (or the
-- trial has ended), so historical paid periods are never retroactively changed.
create or replace function public.sync_subscription_statuses(p_canteen_id uuid default null)
returns void
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_uid uuid:=auth.uid();
  v_allowed boolean:=false;
  v_sub public.canteen_subscriptions;
  v_next_plan_id uuid;
  v_next_plan public.subscription_plans;
  v_amount numeric(12,2);
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if public.is_super_admin() then
    v_allowed:=true;
  elsif p_canteen_id is not null and public.current_canteen_id()=p_canteen_id then
    v_allowed:=true;
  end if;
  if not v_allowed then raise exception 'Not authorized'; end if;
  -- A failed verification must not be able to change subscription state. This RPC is
  -- only a synchronization helper and is invoked by an already-authenticated user.

  for v_sub in
    select *
    from public.canteen_subscriptions
    where (p_canteen_id is null or canteen_id=p_canteen_id)
      and (
        (status='trial' and trial_end is not null and trial_end<=now())
        or (status='active' and subscription_end is not null and subscription_end<=now())
      )
  loop
    if v_sub.plan_selection_mode='auto_range' then
      v_next_plan_id:=public.resolve_member_range_plan(v_sub.canteen_id);
      if v_next_plan_id is not null then
        select * into v_next_plan from public.subscription_plans where id=v_next_plan_id and active=true;
        v_amount:=case when v_sub.billing_cycle='annual' then v_next_plan.annual_price else v_next_plan.monthly_price end;
      else
        v_next_plan_id:=v_sub.plan_id;
        select * into v_next_plan from public.subscription_plans where id=v_next_plan_id;
        v_amount:=v_sub.amount;
      end if;
    else
      v_next_plan_id:=v_sub.plan_id;
      select * into v_next_plan from public.subscription_plans where id=v_next_plan_id;
      v_amount:=v_sub.amount;
    end if;

    update public.canteen_subscriptions
    set plan_id=v_next_plan_id,
        amount=coalesce(v_amount,amount),
        status=case when v_sub.status='trial' then 'payment_pending' else 'expired' end,
        updated_at=now()
    where id=v_sub.id;
  end loop;
end;
$function$;

revoke execute on function public.sync_subscription_statuses(uuid) from public, anon;\ngrant execute on function public.sync_subscription_statuses(uuid) to authenticated;

commit;
