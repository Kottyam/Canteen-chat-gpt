create or replace function public.canteen_submit_subscription_payment(
  p_subscription_id uuid,
  p_amount numeric,
  p_reference text,
  p_payment_date date
)
returns public.subscription_payments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub public.canteen_subscriptions;
  v_payment public.subscription_payments;
  v_canteen_id uuid;
begin
  if auth.uid() is null or not public.is_active_canteen_admin() then
    raise exception 'Canteen Admin authorization required';
  end if;

  v_canteen_id := public.current_canteen_id();
  if v_canteen_id is null then
    raise exception 'Canteen is not configured';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Payment amount must be greater than zero';
  end if;

  if nullif(trim(coalesce(p_reference,'')),'') is null then
    raise exception 'Payment reference is required';
  end if;

  if p_payment_date is null then
    raise exception 'Payment date is required';
  end if;

  select *
    into v_sub
  from public.canteen_subscriptions
  where id=p_subscription_id
    and canteen_id=v_canteen_id
  for update;

  if not found then
    raise exception 'Subscription not found';
  end if;

  if v_sub.status not in ('payment_pending','expired') then
    raise exception 'Payment is not currently required for this subscription';
  end if;

  if exists (
    select 1
    from public.subscription_payments
    where subscription_id=v_sub.id
      and payment_status='pending'
  ) then
    raise exception 'A payment is already pending review for this subscription';
  end if;

  insert into public.subscription_payments(
    canteen_id,
    subscription_id,
    plan_id,
    amount,
    currency,
    payment_date,
    payment_status,
    transaction_reference
  )
  values(
    v_canteen_id,
    v_sub.id,
    v_sub.plan_id,
    p_amount,
    v_sub.currency,
    p_payment_date::timestamptz,
    'pending',
    trim(p_reference)
  )
  returning * into v_payment;

  update public.canteen_subscriptions
  set payment_status='pending',
      status='payment_pending',
      updated_at=now()
  where id=v_sub.id;

  return v_payment;
end;
$$;

revoke execute on function public.canteen_submit_subscription_payment(uuid,numeric,text,date) from public, anon;
grant execute on function public.canteen_submit_subscription_payment(uuid,numeric,text,date) to authenticated;

create or replace function public.super_admin_review_subscription_payment(
  p_payment_id uuid,
  p_status text
)
returns public.subscription_payments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.subscription_payments;
  v_sub public.canteen_subscriptions;
  v_plan public.subscription_plans;
  v_start timestamptz;
  v_end timestamptz;
begin
  if not public.is_super_admin() then
    raise exception 'Super Admin authorization required';
  end if;

  if p_status not in ('paid','failed') then
    raise exception 'Review status must be paid or failed';
  end if;

  select *
    into v_payment
  from public.subscription_payments
  where id=p_payment_id
  for update;

  if not found then
    raise exception 'Payment not found';
  end if;

  if v_payment.payment_status <> 'pending' then
    raise exception 'Only pending payments can be reviewed';
  end if;

  select *
    into v_sub
  from public.canteen_subscriptions
  where id=v_payment.subscription_id
  for update;

  if not found then
    raise exception 'Subscription not found';
  end if;

  if p_status='paid' then
    select *
      into v_plan
    from public.subscription_plans
    where id=v_sub.plan_id;

    if not found then
      raise exception 'Plan not found';
    end if;

    v_start := case
      when v_sub.subscription_end is not null and v_sub.subscription_end > now()
        then v_sub.subscription_end
      else now()
    end;

    v_end := case v_plan.billing_period
      when 'monthly' then v_start + interval '1 month'
      when 'quarterly' then v_start + interval '3 months'
      when 'yearly' then v_start + interval '1 year'
    end;

    update public.subscription_payments
    set payment_status='paid',
        updated_at=now(),
        billing_period_start=v_start,
        billing_period_end=v_end
    where id=v_payment.id
    returning * into v_payment;

    update public.canteen_subscriptions
    set status='active',
        payment_status='paid',
        subscription_start=v_start,
        subscription_end=v_end,
        amount=v_payment.amount,
        currency=v_payment.currency,
        updated_at=now()
    where id=v_sub.id;
  else
    update public.subscription_payments
    set payment_status='failed',
        updated_at=now()
    where id=v_payment.id
    returning * into v_payment;

    update public.canteen_subscriptions
    set status='payment_pending',
        payment_status='failed',
        updated_at=now()
    where id=v_sub.id;
  end if;

  return v_payment;
end;
$$;

revoke execute on function public.super_admin_review_subscription_payment(uuid,text) from public, anon;
grant execute on function public.super_admin_review_subscription_payment(uuid,text) to authenticated;
