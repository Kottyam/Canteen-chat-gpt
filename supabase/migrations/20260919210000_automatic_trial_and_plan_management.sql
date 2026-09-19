alter table public.subscription_plans
  add column if not exists is_default boolean not null default false;

create unique index if not exists subscription_plans_one_default_idx
  on public.subscription_plans (is_default)
  where is_default = true;

update public.subscription_plans
set is_default = true,
    trial_days = case when trial_days <= 0 then 30 else trial_days end,
    updated_at = now()
where active = true
  and id = (
    select id from public.subscription_plans
    where active = true
    order by created_at asc
    limit 1
  )
  and not exists (
    select 1 from public.subscription_plans where is_default = true
  );

create or replace function public.auto_assign_canteen_trial()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_plan public.subscription_plans;
  v_is_super_admin boolean := false;
begin
  select exists(
    select 1 from public.profiles p
    where p.id = new.owner_id and p.role = 'admin'
      and p.admin_role = 'super_admin' and p.status = 'active'
  ) into v_is_super_admin;
  if v_is_super_admin then return new; end if;
  if exists(select 1 from public.canteen_subscriptions s where s.canteen_id = new.id) then return new; end if;

  select * into v_plan from public.subscription_plans
  where active = true and trial_days > 0 and is_default = true
  order by created_at asc limit 1;

  if not found then
    select * into v_plan from public.subscription_plans
    where active = true and trial_days > 0
    order by created_at asc limit 1;
    if (select count(*) from public.subscription_plans where active = true and trial_days > 0) <> 1 then
      raise exception 'No unambiguous active default trial plan is configured';
    end if;
  end if;

  insert into public.canteen_subscriptions(
    canteen_id, plan_id, status, trial_start, trial_end, amount, currency, payment_status
  )
  values(
    new.id, v_plan.id, 'trial', now(),
    now() + make_interval(days => v_plan.trial_days),
    v_plan.price, v_plan.currency, 'pending'
  )
  on conflict (canteen_id) do nothing;
  return new;
end;
$function$;

revoke execute on function public.auto_assign_canteen_trial() from public, anon, authenticated;

drop trigger if exists auto_assign_canteen_trial_on_insert on public.canteens;
create trigger auto_assign_canteen_trial_on_insert
after insert on public.canteens
for each row execute function public.auto_assign_canteen_trial();

create or replace function public.super_admin_delete_plan(p_plan_id uuid)
returns void language plpgsql security definer set search_path = ''
as $function$
begin
  if not public.is_super_admin() then raise exception 'Super Admin authorization required'; end if;
  if not exists(select 1 from public.subscription_plans where id=p_plan_id) then raise exception 'Plan not found'; end if;
  if exists(select 1 from public.canteen_subscriptions where plan_id=p_plan_id)
     or exists(select 1 from public.subscription_payments where plan_id=p_plan_id) then
    raise exception 'Plan is used by subscription or payment history and cannot be deleted. Deactivate it instead.';
  end if;
  delete from public.subscription_plans where id=p_plan_id;
end;
$function$;

revoke execute on function public.super_admin_delete_plan(uuid) from public, anon;
grant execute on function public.super_admin_delete_plan(uuid) to authenticated;

create or replace function public.super_admin_set_plan_default(p_plan_id uuid)
returns public.subscription_plans language plpgsql security definer set search_path = ''
as $function$
declare v_plan public.subscription_plans;
begin
  if not public.is_super_admin() then raise exception 'Super Admin authorization required'; end if;
  select * into v_plan from public.subscription_plans where id=p_plan_id;
  if not found then raise exception 'Plan not found'; end if;
  if not v_plan.active then raise exception 'Only an active plan can be the default plan'; end if;
  update public.subscription_plans set is_default=false,updated_at=now() where is_default=true and id<>p_plan_id;
  update public.subscription_plans set is_default=true,updated_at=now() where id=p_plan_id returning * into v_plan;
  return v_plan;
end;
$function$;

revoke execute on function public.super_admin_set_plan_default(uuid) from public, anon;
grant execute on function public.super_admin_set_plan_default(uuid) to authenticated;

create or replace function public.super_admin_set_subscription(
  p_canteen_id uuid, p_action text, p_plan_id uuid default null,
  p_trial_days integer default null, p_amount numeric default null, p_currency text default null
)
returns public.canteen_subscriptions language plpgsql security definer set search_path = ''
as $function$
declare
  v_sub public.canteen_subscriptions; v_plan public.subscription_plans;
  v_now timestamptz:=now(); v_trial_days integer; v_amount numeric(12,2);
  v_currency text; v_start timestamptz; v_end timestamptz;
begin
  if not public.is_super_admin() then raise exception 'Super Admin authorization required'; end if;
  if not exists(select 1 from public.canteens c where c.id=p_canteen_id) then raise exception 'Canteen not found'; end if;
  if p_plan_id is not null then
    select * into v_plan from public.subscription_plans where id=p_plan_id;
    if not found then raise exception 'Plan not found'; end if;
    if p_action in ('start_trial','change_plan','activate') and not v_plan.active then
      raise exception 'Inactive plans cannot be selected for new or renewed subscriptions';
    end if;
  end if;
  select * into v_sub from public.canteen_subscriptions where canteen_id=p_canteen_id;
  if p_action in ('start_trial','activate','change_plan') and p_plan_id is null and v_sub.id is null then raise exception 'Plan is required'; end if;
  if p_plan_id is not null then
    v_amount:=coalesce(p_amount,v_plan.price); v_currency:=coalesce(nullif(trim(p_currency),''),v_plan.currency);
  elsif v_sub.id is not null then
    v_amount:=coalesce(p_amount,v_sub.amount); v_currency:=coalesce(nullif(trim(p_currency),''),v_sub.currency);
  else
    v_amount:=coalesce(p_amount,0); v_currency:=coalesce(nullif(trim(p_currency),''),'INR');
  end if;

  if p_action='start_trial' then
    if p_plan_id is null then p_plan_id:=v_sub.plan_id; end if;
    select * into v_plan from public.subscription_plans where id=p_plan_id;
    v_trial_days:=coalesce(p_trial_days,v_plan.trial_days);
    if v_trial_days<=0 then raise exception 'Trial days must be greater than zero'; end if;
    insert into public.canteen_subscriptions(canteen_id,plan_id,status,trial_start,trial_end,amount,currency,payment_status)
    values(p_canteen_id,p_plan_id,'trial',v_now,v_now+make_interval(days=>v_trial_days),v_amount,v_currency,'pending')
    on conflict(canteen_id) do update set plan_id=excluded.plan_id,status='trial',trial_start=excluded.trial_start,trial_end=excluded.trial_end,subscription_start=null,subscription_end=null,amount=excluded.amount,currency=excluded.currency,payment_status='pending',updated_at=now()
    returning * into v_sub; return v_sub;
  end if;

  if p_action='extend_trial' then
    if v_sub.id is null then raise exception 'Subscription not found'; end if;
    v_trial_days:=coalesce(p_trial_days,0); if v_trial_days<=0 then raise exception 'Extension days must be greater than zero'; end if;
    update public.canteen_subscriptions set status='trial',trial_start=coalesce(trial_start,v_now),trial_end=greatest(coalesce(trial_end,v_now),v_now)+make_interval(days=>v_trial_days),payment_status='pending',updated_at=now()
    where id=v_sub.id returning * into v_sub; return v_sub;
  end if;

  if p_action='activate' then
    if p_plan_id is null then p_plan_id:=v_sub.plan_id; end if;
    select * into v_plan from public.subscription_plans where id=p_plan_id;
    if not found then raise exception 'Plan not found'; end if;
    if not v_plan.active then raise exception 'Inactive plans cannot be activated'; end if;
    v_start:=v_now;
    v_end:=case v_plan.billing_period when 'monthly' then v_start+interval '1 month' when 'quarterly' then v_start+interval '3 months' when 'yearly' then v_start+interval '1 year' end;
    insert into public.canteen_subscriptions(canteen_id,plan_id,status,subscription_start,subscription_end,amount,currency,payment_status)
    values(p_canteen_id,p_plan_id,'active',v_start,v_end,v_amount,v_currency,'paid')
    on conflict(canteen_id) do update set plan_id=excluded.plan_id,status='active',subscription_start=excluded.subscription_start,subscription_end=excluded.subscription_end,amount=excluded.amount,currency=excluded.currency,payment_status='paid',updated_at=now()
    returning * into v_sub; return v_sub;
  end if;

  if p_action='change_plan' then
    if v_sub.id is null then raise exception 'Subscription not found'; end if;
    if p_plan_id is null then raise exception 'Plan is required'; end if;
    update public.canteen_subscriptions set plan_id=p_plan_id,amount=v_amount,currency=v_currency,updated_at=now() where id=v_sub.id returning * into v_sub; return v_sub;
  end if;

  if p_action='suspend' then
    if v_sub.id is null then raise exception 'Subscription not found'; end if;
    update public.canteen_subscriptions set status='suspended',updated_at=now() where id=v_sub.id returning * into v_sub; return v_sub;
  end if;

  if p_action='payment_pending' then
    if v_sub.id is null then raise exception 'Subscription not found'; end if;
    update public.canteen_subscriptions set status='payment_pending',payment_status='pending',updated_at=now() where id=v_sub.id returning * into v_sub; return v_sub;
  end if;
  raise exception 'Unsupported subscription action';
end;
$function$;

revoke execute on function public.super_admin_set_subscription(uuid,text,uuid,integer,numeric,text) from public, anon;
grant execute on function public.super_admin_set_subscription(uuid,text,uuid,integer,numeric,text) to authenticated;

insert into public.canteen_subscriptions(
  canteen_id, plan_id, status, trial_start, trial_end, amount, currency, payment_status
)
select c.id,p.id,'trial',now(),now()+make_interval(days=>p.trial_days),p.price,p.currency,'pending'
from public.canteens c
cross join lateral (
  select sp.* from public.subscription_plans sp
  where sp.active=true and sp.trial_days>0 and sp.is_default=true limit 1
) p
where not exists(
  select 1 from public.profiles op
  where op.id=c.owner_id and op.role='admin' and op.admin_role='super_admin' and op.status='active'
)
and not exists(select 1 from public.canteen_subscriptions s where s.canteen_id=c.id)
on conflict(canteen_id) do nothing;