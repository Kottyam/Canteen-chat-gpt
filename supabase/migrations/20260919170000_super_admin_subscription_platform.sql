create table if not exists public.subscription_plans (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  price numeric(12,2) not null default 0 check (price >= 0),
  billing_period text not null default 'monthly' check (billing_period in ('monthly','quarterly','yearly')),
  currency text not null default 'INR' check (length(currency) between 3 and 3),
  trial_days integer not null default 0 check (trial_days >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.canteen_subscriptions (
  id uuid primary key default gen_random_uuid(),
  canteen_id uuid not null unique references public.canteens(id) on delete cascade,
  plan_id uuid not null references public.subscription_plans(id),
  status text not null default 'payment_pending' check (status in ('trial','active','payment_pending','expired','suspended')),
  trial_start timestamptz,
  trial_end timestamptz,
  subscription_start timestamptz,
  subscription_end timestamptz,
  amount numeric(12,2) not null default 0 check (amount >= 0),
  currency text not null default 'INR' check (length(currency) between 3 and 3),
  payment_status text not null default 'pending' check (payment_status in ('pending','paid','failed','refunded')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint canteen_subscription_dates_check check (
    (trial_end is null or trial_start is not null)
    and (subscription_end is null or subscription_start is not null)
  )
);

create table if not exists public.subscription_payments (
  id uuid primary key default gen_random_uuid(),
  canteen_id uuid not null references public.canteens(id) on delete cascade,
  subscription_id uuid not null references public.canteen_subscriptions(id) on delete cascade,
  plan_id uuid not null references public.subscription_plans(id),
  amount numeric(12,2) not null check (amount >= 0),
  currency text not null default 'INR' check (length(currency) between 3 and 3),
  payment_date timestamptz,
  payment_status text not null default 'pending' check (payment_status in ('pending','paid','failed','refunded')),
  transaction_reference text,
  billing_period_start timestamptz,
  billing_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_canteen_subscriptions_status on public.canteen_subscriptions(status);
create index if not exists idx_canteen_subscriptions_plan on public.canteen_subscriptions(plan_id);
create index if not exists idx_subscription_payments_canteen on public.subscription_payments(canteen_id, payment_date desc);
create index if not exists idx_subscription_payments_subscription on public.subscription_payments(subscription_id, created_at desc);

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'admin'
      and p.admin_role = 'super_admin'
      and p.status = 'active'
  )
$$;

revoke execute on function public.is_super_admin() from public;
grant execute on function public.is_super_admin() to authenticated;

create or replace function public.sync_subscription_statuses(p_canteen_id uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_allowed boolean := false;
begin
  if v_uid is null then
    raise exception 'Authentication required';
  end if;

  if public.is_super_admin() then
    v_allowed := true;
  elsif p_canteen_id is not null and public.current_canteen_id() = p_canteen_id then
    v_allowed := true;
  end if;

  if not v_allowed then
    raise exception 'Not authorized';
  end if;

  update public.canteen_subscriptions
  set status = 'payment_pending', updated_at = now()
  where status = 'trial'
    and trial_end is not null
    and trial_end <= now()
    and (p_canteen_id is null or canteen_id = p_canteen_id);

  update public.canteen_subscriptions
  set status = 'expired', updated_at = now()
  where status = 'active'
    and subscription_end is not null
    and subscription_end <= now()
    and (p_canteen_id is null or canteen_id = p_canteen_id);
end;
$$;

revoke execute on function public.sync_subscription_statuses(uuid) from public;
grant execute on function public.sync_subscription_statuses(uuid) to authenticated;

create or replace function public.super_admin_set_subscription(
  p_canteen_id uuid,
  p_action text,
  p_plan_id uuid default null,
  p_trial_days integer default null,
  p_amount numeric default null,
  p_currency text default null
)
returns public.canteen_subscriptions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub public.canteen_subscriptions;
  v_plan public.subscription_plans;
  v_now timestamptz := now();
  v_trial_days integer;
  v_amount numeric(12,2);
  v_currency text;
  v_start timestamptz;
  v_end timestamptz;
begin
  if not public.is_super_admin() then
    raise exception 'Super Admin authorization required';
  end if;

  if not exists (select 1 from public.canteens c where c.id = p_canteen_id) then
    raise exception 'Canteen not found';
  end if;

  if p_plan_id is not null then
    select * into v_plan from public.subscription_plans where id = p_plan_id;
    if not found then raise exception 'Plan not found'; end if;
  end if;

  select * into v_sub from public.canteen_subscriptions where canteen_id = p_canteen_id;

  if p_action in ('start_trial','activate','change_plan') and p_plan_id is null and v_sub.id is null then
    raise exception 'Plan is required';
  end if;

  if p_plan_id is not null then
    v_amount := coalesce(p_amount, v_plan.price);
    v_currency := coalesce(nullif(trim(p_currency),''), v_plan.currency);
  elsif v_sub.id is not null then
    v_amount := coalesce(p_amount, v_sub.amount);
    v_currency := coalesce(nullif(trim(p_currency),''), v_sub.currency);
  else
    v_amount := coalesce(p_amount,0);
    v_currency := coalesce(nullif(trim(p_currency),''),'INR');
  end if;

  if p_action = 'start_trial' then
    if p_plan_id is null then p_plan_id := v_sub.plan_id; end if;
    select * into v_plan from public.subscription_plans where id = p_plan_id;
    v_trial_days := coalesce(p_trial_days, v_plan.trial_days);
    if v_trial_days <= 0 then raise exception 'Trial days must be greater than zero'; end if;
    insert into public.canteen_subscriptions(canteen_id,plan_id,status,trial_start,trial_end,subscription_start,subscription_end,amount,currency,payment_status)
    values(p_canteen_id,p_plan_id,'trial',v_now,v_now + make_interval(days => v_trial_days),null,null,v_amount,v_currency,'pending')
    on conflict(canteen_id) do update set
      plan_id=excluded.plan_id,status='trial',trial_start=excluded.trial_start,trial_end=excluded.trial_end,
      subscription_start=null,subscription_end=null,amount=excluded.amount,currency=excluded.currency,payment_status='pending',updated_at=now()
    returning * into v_sub;
    return v_sub;
  end if;

  if p_action = 'extend_trial' then
    if v_sub.id is null then raise exception 'Subscription not found'; end if;
    v_trial_days := coalesce(p_trial_days,0);
    if v_trial_days <= 0 then raise exception 'Extension days must be greater than zero'; end if;
    update public.canteen_subscriptions
    set status='trial',
        trial_start=coalesce(trial_start,v_now),
        trial_end=greatest(coalesce(trial_end,v_now),v_now)+make_interval(days => v_trial_days),
        payment_status='pending',
        updated_at=now()
    where id=v_sub.id
    returning * into v_sub;
    return v_sub;
  end if;

  if p_action = 'activate' then
    if p_plan_id is null then p_plan_id := v_sub.plan_id; end if;
    select * into v_plan from public.subscription_plans where id = p_plan_id;
    if not found then raise exception 'Plan not found'; end if;
    v_start := v_now;
    v_end := case v_plan.billing_period
      when 'monthly' then v_start + interval '1 month'
      when 'quarterly' then v_start + interval '3 months'
      when 'yearly' then v_start + interval '1 year'
    end;
    insert into public.canteen_subscriptions(canteen_id,plan_id,status,trial_start,trial_end,subscription_start,subscription_end,amount,currency,payment_status)
    values(p_canteen_id,p_plan_id,'active',null,null,v_start,v_end,v_amount,v_currency,'paid')
    on conflict(canteen_id) do update set
      plan_id=excluded.plan_id,status='active',subscription_start=excluded.subscription_start,
      subscription_end=excluded.subscription_end,amount=excluded.amount,currency=excluded.currency,
      payment_status='paid',updated_at=now()
    returning * into v_sub;
    return v_sub;
  end if;

  if p_action = 'change_plan' then
    if v_sub.id is null then raise exception 'Subscription not found'; end if;
    if p_plan_id is null then raise exception 'Plan is required'; end if;
    update public.canteen_subscriptions
    set plan_id=p_plan_id,amount=v_amount,currency=v_currency,updated_at=now()
    where id=v_sub.id
    returning * into v_sub;
    return v_sub;
  end if;

  if p_action = 'suspend' then
    if v_sub.id is null then raise exception 'Subscription not found'; end if;
    update public.canteen_subscriptions
    set status='suspended',updated_at=now()
    where id=v_sub.id
    returning * into v_sub;
    return v_sub;
  end if;

  if p_action = 'payment_pending' then
    if v_sub.id is null then raise exception 'Subscription not found'; end if;
    update public.canteen_subscriptions
    set status='payment_pending',payment_status='pending',updated_at=now()
    where id=v_sub.id
    returning * into v_sub;
    return v_sub;
  end if;

  raise exception 'Unsupported subscription action';
end;
$$;

revoke execute on function public.super_admin_set_subscription(uuid,text,uuid,integer,numeric,text) from public;
grant execute on function public.super_admin_set_subscription(uuid,text,uuid,integer,numeric,text) to authenticated;

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
  v_payment public.subscription_payments;
  v_paid_at timestamptz;
  v_period_start timestamptz;
  v_period_end timestamptz;
begin
  if not public.is_super_admin() then raise exception 'Super Admin authorization required'; end if;
  if p_status not in ('pending','paid','failed','refunded') then raise exception 'Invalid payment status'; end if;
  select * into v_sub from public.canteen_subscriptions where id=p_subscription_id for update;
  if not found then raise exception 'Subscription not found'; end if;

  v_paid_at := case when p_status='paid' then now() else null end;
  v_period_start := coalesce(p_period_start, v_sub.subscription_start);
  v_period_end := coalesce(p_period_end, v_sub.subscription_end);

  insert into public.subscription_payments(canteen_id,subscription_id,plan_id,amount,currency,payment_date,payment_status,transaction_reference,billing_period_start,billing_period_end)
  values(v_sub.canteen_id,v_sub.id,v_sub.plan_id,coalesce(p_amount,v_sub.amount),v_sub.currency,v_paid_at,p_status,p_reference,v_period_start,v_period_end)
  returning * into v_payment;

  if p_status='paid' then
    update public.canteen_subscriptions
    set status='active',
        payment_status='paid',
        subscription_start=coalesce(v_sub.subscription_start,now()),
        subscription_end=coalesce(p_period_end,
          case (select billing_period from public.subscription_plans where id=v_sub.plan_id)
            when 'monthly' then coalesce(v_sub.subscription_start,now()) + interval '1 month'
            when 'quarterly' then coalesce(v_sub.subscription_start,now()) + interval '3 months'
            when 'yearly' then coalesce(v_sub.subscription_start,now()) + interval '1 year'
          end),
        updated_at=now()
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

alter table public.subscription_plans enable row level security;
alter table public.canteen_subscriptions enable row level security;
alter table public.subscription_payments enable row level security;

grant select on public.subscription_plans to authenticated;
grant insert,update,delete on public.subscription_plans to authenticated;
grant select on public.canteen_subscriptions to authenticated;
grant select on public.subscription_payments to authenticated;

drop policy if exists "subscription_plans_super_admin_select" on public.subscription_plans;
create policy "subscription_plans_super_admin_select" on public.subscription_plans
for select to authenticated using ((select public.is_super_admin()));

drop policy if exists "subscription_plans_canteen_select_active" on public.subscription_plans;
create policy "subscription_plans_canteen_select_active" on public.subscription_plans
for select to authenticated using (active=true);

drop policy if exists "subscription_plans_super_admin_insert" on public.subscription_plans;
create policy "subscription_plans_super_admin_insert" on public.subscription_plans
for insert to authenticated with check ((select public.is_super_admin()));

drop policy if exists "subscription_plans_super_admin_update" on public.subscription_plans;
create policy "subscription_plans_super_admin_update" on public.subscription_plans
for update to authenticated using ((select public.is_super_admin())) with check ((select public.is_super_admin()));

drop policy if exists "subscription_plans_super_admin_delete" on public.subscription_plans;
create policy "subscription_plans_super_admin_delete" on public.subscription_plans
for delete to authenticated using ((select public.is_super_admin()));

drop policy if exists "canteen_subscriptions_super_admin_select" on public.canteen_subscriptions;
create policy "canteen_subscriptions_super_admin_select" on public.canteen_subscriptions
for select to authenticated using ((select public.is_super_admin()));

drop policy if exists "canteen_subscriptions_canteen_select" on public.canteen_subscriptions;
create policy "canteen_subscriptions_canteen_select" on public.canteen_subscriptions
for select to authenticated using (canteen_id=(select public.current_canteen_id()));

drop policy if exists "subscription_payments_super_admin_select" on public.subscription_payments;
create policy "subscription_payments_super_admin_select" on public.subscription_payments
for select to authenticated using ((select public.is_super_admin()));

drop policy if exists "subscription_payments_canteen_select" on public.subscription_payments;
create policy "subscription_payments_canteen_select" on public.subscription_payments
for select to authenticated using (canteen_id=(select public.current_canteen_id()));

alter table public.profiles enable row level security;
drop policy if exists "platform_super_admin_profiles_select" on public.profiles;
create policy "platform_super_admin_profiles_select" on public.profiles
for select to authenticated using ((select public.is_super_admin()));

alter table public.canteens enable row level security;
drop policy if exists "platform_super_admin_canteens_select" on public.canteens;
create policy "platform_super_admin_canteens_select" on public.canteens
for select to authenticated using ((select public.is_super_admin()));

grant select on public.profiles to authenticated;
grant select on public.canteens to authenticated;

create or replace function public.super_admin_platform_stats()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not public.is_super_admin() then raise exception 'Super Admin authorization required'; end if;
  perform public.sync_subscription_statuses(null);
  select jsonb_build_object(
    'total_canteens',(select count(*) from public.canteens),
    'active_canteens',(select count(*) from public.canteens c join public.canteen_subscriptions s on s.canteen_id=c.id where s.status='active'),
    'trial_canteens',(select count(*) from public.canteen_subscriptions where status='trial'),
    'payment_pending',(select count(*) from public.canteen_subscriptions where status='payment_pending'),
    'expired',(select count(*) from public.canteen_subscriptions where status='expired'),
    'suspended',(select count(*) from public.canteen_subscriptions where status='suspended'),
    'total_employees',(select count(*) from public.profiles where role='employee'),
    'total_admins',(select count(*) from public.profiles where role='admin' and admin_role<>'super_admin')
  ) into v_result;
  return v_result;
end;
$$;

revoke execute on function public.super_admin_platform_stats() from public;
grant execute on function public.super_admin_platform_stats() to authenticated;
