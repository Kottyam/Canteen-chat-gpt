create or replace function public.super_admin_record_subscription_payment(
  p_subscription_id uuid,
  p_amount numeric,
  p_status text,
  p_reference text default null,
  p_period_start timestamptz default null,
  p_period_end timestamptz default null
)
returns public.subscription_payments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub public.canteen_subscriptions;
  v_plan public.subscription_plans;
  v_payment public.subscription_payments;
  v_paid_at timestamptz;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_start timestamptz;
begin
  if not public.is_super_admin() then raise exception 'Super Admin authorization required'; end if;
  if p_status not in ('pending','paid','failed','refunded') then raise exception 'Invalid payment status'; end if;

  select * into v_sub from public.canteen_subscriptions where id=p_subscription_id for update;
  if not found then raise exception 'Subscription not found'; end if;
  select * into v_plan from public.subscription_plans where id=v_sub.plan_id;
  if not found then raise exception 'Plan not found'; end if;

  v_paid_at:=case when p_status='paid' then now() else null end;

  if p_status='paid' then
    v_start:=coalesce(p_period_start,case when v_sub.subscription_end is not null and v_sub.subscription_end>now() then v_sub.subscription_end else now() end);
    v_period_start:=v_start;
    v_period_end:=coalesce(p_period_end,case v_plan.billing_period
      when 'monthly' then v_start+interval '1 month'
      when 'quarterly' then v_start+interval '3 months'
      when 'yearly' then v_start+interval '1 year'
    end);
  else
    v_period_start:=p_period_start;
    v_period_end:=p_period_end;
  end if;

  insert into public.subscription_payments(canteen_id,subscription_id,plan_id,amount,currency,payment_date,payment_status,transaction_reference,billing_period_start,billing_period_end)
  values(v_sub.canteen_id,v_sub.id,v_sub.plan_id,coalesce(p_amount,v_sub.amount),v_sub.currency,v_paid_at,p_status,p_reference,v_period_start,v_period_end)
  returning * into v_payment;

  if p_status='paid' then
    update public.canteen_subscriptions
    set status='active',payment_status='paid',subscription_start=v_period_start,subscription_end=v_period_end,updated_at=now()
    where id=v_sub.id;
  elsif p_status='failed' then
    update public.canteen_subscriptions set payment_status='failed',status='payment_pending',updated_at=now() where id=v_sub.id;
  elsif p_status='refunded' then
    update public.canteen_subscriptions set payment_status='refunded',status='payment_pending',updated_at=now() where id=v_sub.id;
  end if;

  return v_payment;
end;
$$;

revoke execute on function public.super_admin_record_subscription_payment(uuid,numeric,text,text,timestamptz,timestamptz) from public;
grant execute on function public.super_admin_record_subscription_payment(uuid,numeric,text,text,timestamptz,timestamptz) to authenticated;
