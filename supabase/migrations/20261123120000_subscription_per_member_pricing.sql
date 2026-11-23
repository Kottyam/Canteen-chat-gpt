-- Additive subscription pricing method: PER_MEMBER (amount = per-member price * active member count).
-- Does not modify any existing subscription plans, canteen subscriptions, or payment rows.

alter table public.subscription_plans
  add column if not exists per_member_price numeric(12,2);

alter table public.subscription_plans
  drop constraint if exists subscription_plans_per_member_price_check;
alter table public.subscription_plans
  add constraint subscription_plans_per_member_price_check
  check (per_member_price is null or per_member_price >= 0);

alter table public.subscription_plans
  drop constraint if exists subscription_plans_pricing_model_check;
alter table public.subscription_plans
  add constraint subscription_plans_pricing_model_check
  check (pricing_model = any (array['MEMBER_RANGE'::text, 'FIXED_AMOUNT'::text, 'PER_MEMBER'::text]));

alter table public.subscription_plans
  drop constraint if exists subscription_plans_member_range_check;
alter table public.subscription_plans
  add constraint subscription_plans_member_range_check
  check (
    pricing_model = any (array['FIXED_AMOUNT'::text, 'PER_MEMBER'::text])
    or (
      min_members is not null
      and max_members is not null
      and min_members >= 0
      and max_members >= min_members
    )
  );

create or replace function public.validate_subscription_plan_member_range()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if not public.is_super_admin() then
    raise exception 'Super Admin authorization required';
  end if;
  if new.pricing_model not in ('MEMBER_RANGE', 'FIXED_AMOUNT', 'PER_MEMBER') then
    raise exception 'Invalid pricing model';
  end if;
  if new.monthly_price is null or new.monthly_price < 0 or new.annual_price is null or new.annual_price < 0 then
    raise exception 'Monthly and Annual prices must be zero or greater';
  end if;
  if new.pricing_model = 'MEMBER_RANGE' then
    if new.min_members is null or new.max_members is null or new.min_members < 0 or new.max_members < new.min_members then
      raise exception 'Invalid member range: Minimum Members must be >= 0 and Maximum Members must be >= Minimum Members';
    end if;
    new.per_member_price := null;
  elsif new.pricing_model = 'PER_MEMBER' then
    new.min_members := null;
    new.max_members := null;
    new.billing_cycle := case when new.billing_availability = 'annual' then 'annual' else 'monthly' end;
    new.per_member_price := case when new.billing_availability = 'annual' then new.annual_price else new.monthly_price end;
  else
    new.min_members := null;
    new.max_members := null;
    new.billing_cycle := 'monthly';
    new.per_member_price := null;
  end if;
  new.price := new.monthly_price;
  new.billing_period := 'monthly';
  return new;
end
$function$;

create or replace function public.super_admin_upsert_subscription_plan(
  p_plan_id uuid default null,
  p_name text default null,
  p_description text default null,
  p_pricing_model text default 'MEMBER_RANGE',
  p_billing_availability text default 'monthly',
  p_currency text default 'INR',
  p_monthly_price numeric default null,
  p_annual_price numeric default null,
  p_ranges jsonb default '[]'::jsonb,
  p_active boolean default true,
  p_is_default boolean default false
)
returns public.subscription_plans
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_plan public.subscription_plans;
  v_range jsonb;
  v_min integer;
  v_max integer;
  v_monthly numeric(12,2);
  v_annual numeric(12,2);
  v_per_member numeric(12,2);
begin
  if not public.is_super_admin() then
    raise exception 'Super Admin authorization required';
  end if;
  if nullif(trim(coalesce(p_name, '')), '') is null then
    raise exception 'Plan name is required';
  end if;
  if p_pricing_model not in ('FIXED_AMOUNT', 'MEMBER_RANGE', 'PER_MEMBER') then
    raise exception 'Invalid pricing model';
  end if;
  if p_billing_availability not in ('monthly', 'annual', 'monthly_annual') then
    raise exception 'Invalid billing availability';
  end if;

  if p_pricing_model in ('FIXED_AMOUNT', 'PER_MEMBER') then
    if p_billing_availability in ('monthly', 'monthly_annual') and (p_monthly_price is null or p_monthly_price < 0) then
      if p_pricing_model = 'PER_MEMBER' then
        raise exception 'Monthly per-member price is required';
      else
        raise exception 'Monthly fixed amount is required';
      end if;
    end if;
    if p_billing_availability in ('annual', 'monthly_annual') and (p_annual_price is null or p_annual_price < 0) then
      if p_pricing_model = 'PER_MEMBER' then
        raise exception 'Yearly per-member price is required';
      else
        raise exception 'Yearly fixed amount is required';
      end if;
    end if;
    p_monthly_price := coalesce(p_monthly_price, 0);
    p_annual_price := coalesce(p_annual_price, 0);
    p_ranges := '[]'::jsonb;
    v_per_member := case
      when p_pricing_model = 'PER_MEMBER' then
        case when p_billing_availability = 'annual' then p_annual_price else p_monthly_price end
      else null
    end;
  else
    v_per_member := null;
    if jsonb_typeof(coalesce(p_ranges, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_ranges, '[]'::jsonb)) = 0 then
      raise exception 'At least one member pricing range is required';
    end if;
  end if;

  if p_plan_id is null then
    insert into public.subscription_plans(
      name, description, pricing_model, min_members, max_members,
      monthly_price, annual_price, price, per_member_price, billing_period, currency,
      trial_days, active, is_default, billing_cycle, billing_availability
    )
    values(
      trim(p_name),
      nullif(trim(p_description), ''),
      p_pricing_model,
      case when p_pricing_model = 'MEMBER_RANGE' then 0 else null end,
      case when p_pricing_model = 'MEMBER_RANGE' then 2147483647 else null end,
      coalesce(p_monthly_price, 0),
      coalesce(p_annual_price, 0),
      coalesce(p_monthly_price, 0),
      v_per_member,
      'monthly',
      upper(trim(coalesce(p_currency, 'INR'))),
      0,
      p_active,
      false,
      case when p_billing_availability = 'annual' then 'annual' else 'monthly' end,
      p_billing_availability
    )
    returning * into v_plan;
  else
    select * into v_plan from public.subscription_plans where id = p_plan_id for update;
    if not found then
      raise exception 'Plan not found';
    end if;
    update public.subscription_plans
    set name = trim(p_name),
        description = nullif(trim(p_description), ''),
        pricing_model = p_pricing_model,
        billing_availability = p_billing_availability,
        billing_cycle = case when p_billing_availability = 'annual' then 'annual' else 'monthly' end,
        currency = upper(trim(coalesce(p_currency, 'INR'))),
        monthly_price = coalesce(p_monthly_price, 0),
        annual_price = coalesce(p_annual_price, 0),
        price = coalesce(p_monthly_price, 0),
        per_member_price = v_per_member,
        billing_period = 'monthly',
        active = p_active,
        updated_at = now()
    where id = v_plan.id
    returning * into v_plan;

    delete from public.subscription_plan_ranges where plan_id = v_plan.id;
  end if;

  if v_plan.pricing_model = 'MEMBER_RANGE' then
    for v_range in select value from jsonb_array_elements(coalesce(p_ranges, '[]'::jsonb)) loop
      v_min := coalesce((v_range->>'min_members')::integer, (v_range->>'min')::integer);
      v_max := coalesce((v_range->>'max_members')::integer, (v_range->>'max')::integer);
      v_monthly := coalesce((v_range->>'monthly_price')::numeric, (v_range->>'price')::numeric);
      v_annual := coalesce((v_range->>'annual_price')::numeric, (v_range->>'yearly_price')::numeric);
      if v_min is null or v_max is null or v_min < 0 or v_max < v_min then
        raise exception 'Invalid member pricing range';
      end if;
      if p_billing_availability in ('monthly', 'monthly_annual') and (v_monthly is null or v_monthly < 0) then
        raise exception 'Monthly price is required for every member range';
      end if;
      if p_billing_availability in ('annual', 'monthly_annual') and (v_annual is null or v_annual < 0) then
        raise exception 'Yearly price is required for every member range';
      end if;
      v_monthly := coalesce(v_monthly, 0);
      v_annual := coalesce(v_annual, 0);
      if exists(select 1 from public.subscription_plan_ranges x where x.plan_id = v_plan.id and x.min_members <= v_max and v_min <= x.max_members) then
        raise exception 'Member pricing ranges cannot overlap';
      end if;
      insert into public.subscription_plan_ranges(plan_id, min_members, max_members, monthly_price, annual_price)
      values(v_plan.id, v_min, v_max, v_monthly, v_annual);
    end loop;
    select min(min_members), max(max_members), min(monthly_price), min(annual_price)
    into v_plan.min_members, v_plan.max_members, v_plan.monthly_price, v_plan.annual_price
    from public.subscription_plan_ranges
    where plan_id = v_plan.id;
    update public.subscription_plans
    set min_members = v_plan.min_members,
        max_members = v_plan.max_members,
        monthly_price = v_plan.monthly_price,
        annual_price = v_plan.annual_price,
        price = v_plan.monthly_price,
        per_member_price = null,
        updated_at = now()
    where id = v_plan.id
    returning * into v_plan;
  else
    update public.subscription_plans
    set min_members = null,
        max_members = null,
        monthly_price = coalesce(p_monthly_price, 0),
        annual_price = coalesce(p_annual_price, 0),
        price = coalesce(p_monthly_price, 0),
        per_member_price = v_per_member,
        billing_cycle = case when p_billing_availability = 'annual' then 'annual' else 'monthly' end,
        billing_availability = p_billing_availability,
        updated_at = now()
    where id = v_plan.id
    returning * into v_plan;
  end if;

  if p_is_default then
    update public.subscription_plans set is_default = false, updated_at = now() where is_default and id <> v_plan.id;
    update public.subscription_plans set is_default = true, updated_at = now() where id = v_plan.id returning * into v_plan;
  end if;
  return v_plan;
end;
$function$;

create or replace function public.get_subscription_billing_quote(
  p_canteen_id uuid,
  p_billing_cycle text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  s public.canteen_subscriptions;
  p public.subscription_plans;
  r public.subscription_plan_ranges;
  v_members integer;
  v_cycle text;
  v_unit numeric(12,2);
  v_amount numeric(12,2);
  v_contact text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if not (public.is_super_admin() or public.current_canteen_id() = p_canteen_id) then
    raise exception 'Not authorized';
  end if;
  select * into s from public.canteen_subscriptions where canteen_id = p_canteen_id;
  if not found then
    return jsonb_build_object('required', false, 'reason', 'unassigned');
  end if;

  select count(*)::integer into v_members
  from public.profiles e
  where e.canteen_id = p_canteen_id and e.role = 'employee' and e.status = 'active';

  select * into p from public.subscription_plans where id = s.plan_id and active;
  if not found then
    raise exception 'Active subscription plan not found';
  end if;

  v_cycle := coalesce(nullif(trim(p_billing_cycle), ''), s.billing_cycle, 'monthly');
  if not public.subscription_cycle_supported(p.billing_availability, v_cycle) then
    raise exception 'Selected billing cycle is not available for this plan';
  end if;

  select coalesce(nullif(trim(vendor_contact_email), ''), 'gocanteen1729@gmail.com')
  into v_contact
  from public.subscription_payment_settings
  where id = true;
  v_contact := coalesce(v_contact, 'gocanteen1729@gmail.com');

  if p.pricing_model = 'FIXED_AMOUNT' then
    v_amount := case when v_cycle = 'annual' then p.annual_price else p.monthly_price end;
    if v_amount <= 0 then
      return jsonb_build_object(
        'required', false, 'plan_id', p.id, 'plan_name', p.name, 'pricing_model', p.pricing_model,
        'billing_cycle', v_cycle, 'amount', v_amount, 'currency', p.currency, 'member_count', v_members,
        'max_exceeded', false, 'contact_email', v_contact,
        'message', 'The selected billing cycle is not priced for this plan.'
      );
    end if;
    return jsonb_build_object(
      'required', true, 'plan_id', p.id, 'plan_name', p.name, 'pricing_model', p.pricing_model,
      'billing_cycle', v_cycle, 'amount', v_amount, 'currency', p.currency, 'member_count', v_members,
      'max_exceeded', false, 'contact_email', v_contact, 'message', null
    );
  end if;

  if p.pricing_model = 'PER_MEMBER' then
    v_unit := case when v_cycle = 'annual' then p.annual_price else p.monthly_price end;
    if v_unit <= 0 then
      return jsonb_build_object(
        'required', false, 'plan_id', p.id, 'plan_name', p.name, 'pricing_model', p.pricing_model,
        'billing_cycle', v_cycle, 'per_member_price', v_unit, 'amount', 0, 'currency', p.currency,
        'member_count', v_members, 'max_exceeded', false, 'contact_email', v_contact,
        'message', 'The selected billing cycle is not priced for this plan.'
      );
    end if;
    v_amount := round(v_unit * v_members, 2);
    if v_amount <= 0 then
      return jsonb_build_object(
        'required', false, 'plan_id', p.id, 'plan_name', p.name, 'pricing_model', p.pricing_model,
        'billing_cycle', v_cycle, 'per_member_price', v_unit, 'amount', 0, 'currency', p.currency,
        'member_count', v_members, 'max_exceeded', false, 'contact_email', v_contact,
        'message', 'No active members yet. Billing amount is calculated once active members are added.'
      );
    end if;
    return jsonb_build_object(
      'required', true, 'plan_id', p.id, 'plan_name', p.name, 'pricing_model', p.pricing_model,
      'billing_cycle', v_cycle, 'per_member_price', v_unit, 'amount', v_amount, 'currency', p.currency,
      'member_count', v_members, 'max_exceeded', false, 'contact_email', v_contact, 'message', null
    );
  end if;

  select * into r
  from public.subscription_plan_ranges x
  where x.plan_id = p.id and x.min_members <= v_members and x.max_members >= v_members
  order by x.min_members desc
  limit 1;
  if not found then
    return jsonb_build_object(
      'required', false, 'plan_id', p.id, 'plan_name', p.name, 'pricing_model', p.pricing_model,
      'billing_cycle', v_cycle, 'amount', null, 'currency', p.currency, 'member_count', v_members,
      'max_exceeded', not exists(select 1 from public.subscription_plan_ranges x where x.plan_id = p.id and x.max_members >= v_members),
      'contact_email', v_contact,
      'message', 'Your current member count exceeds the configured pricing range. Please contact the administrator.'
    );
  end if;
  v_amount := case when v_cycle = 'annual' then r.annual_price else r.monthly_price end;
  if v_amount <= 0 then
    return jsonb_build_object(
      'required', false, 'plan_id', p.id, 'plan_name', p.name, 'pricing_model', p.pricing_model,
      'billing_cycle', v_cycle, 'amount', v_amount, 'currency', p.currency, 'member_count', v_members,
      'min_members', r.min_members, 'max_members', r.max_members, 'max_exceeded', false,
      'contact_email', v_contact, 'message', 'The selected billing cycle is not priced for this plan.'
    );
  end if;
  return jsonb_build_object(
    'required', true, 'plan_id', p.id, 'plan_name', p.name, 'pricing_model', p.pricing_model,
    'billing_cycle', v_cycle, 'amount', v_amount, 'currency', p.currency, 'member_count', v_members,
    'min_members', r.min_members, 'max_members', r.max_members, 'max_exceeded', false,
    'contact_email', v_contact, 'message', null
  );
end;
$function$;

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
set search_path = ''
as $function$
declare
  v_sub public.canteen_subscriptions;
  v_plan public.subscription_plans;
  v_plan_id uuid;
  v_range public.subscription_plan_ranges;
  v_members integer;
  v_now timestamptz := now();
  v_trial_days integer;
  v_cycle text;
  v_mode text;
  v_unit numeric(12,2);
  v_amount numeric(12,2);
  v_start timestamptz;
  v_end timestamptz;
begin
  if not public.is_super_admin() then
    raise exception 'Super Admin authorization required';
  end if;
  if exists(
    select 1 from public.canteens c
    where c.id = p_canteen_id
      and (c.name = 'GoCanteen' or c.owner_id = (select id from public.profiles where id = (select auth.uid()) and admin_role = 'super_admin'))
  ) then
    raise exception 'Super Admin platform canteen is not a customer subscription';
  end if;
  if not exists(select 1 from public.canteens c where c.id = p_canteen_id) then
    raise exception 'Canteen not found';
  end if;

  select * into v_sub from public.canteen_subscriptions where canteen_id = p_canteen_id for update;
  select count(*)::integer into v_members
  from public.profiles e
  where e.canteen_id = p_canteen_id and e.role = 'employee' and e.status = 'active';

  if p_action in ('activate_trial', 'activate') then
    if v_sub.id is not null then
      if v_sub.trial_used_at is not null and p_action = 'activate_trial' then
        raise exception 'This canteen has already used its initial trial';
      end if;
      if v_sub.trial_used_at is not null and p_action = 'activate' and v_sub.status not in ('payment_pending', 'trial') then
        raise exception 'This canteen is already activated. Use Change Plan or Renewal instead.';
      end if;
    end if;
    if p_plan_id is null then
      v_plan_id := public.resolve_member_range_plan(p_canteen_id);
      if v_plan_id is null then
        raise exception 'A configured MEMBER_RANGE plan does not match the current member count';
      end if;
    else
      v_plan_id := p_plan_id;
    end if;
    select * into v_plan from public.subscription_plans where id = v_plan_id and active = true;
    if not found then
      raise exception 'Selected plan not found or inactive';
    end if;
    v_cycle := coalesce(nullif(trim(p_billing_cycle), ''), 'monthly');
    if not public.subscription_cycle_supported(v_plan.billing_availability, v_cycle) then
      raise exception 'Selected billing cycle is not available for the selected plan';
    end if;
    v_mode := case when v_plan.pricing_model = 'MEMBER_RANGE' and p_plan_selection_mode = 'auto_range' then 'auto_range' else 'manual' end;

    if v_plan.pricing_model = 'FIXED_AMOUNT' then
      v_amount := case when v_cycle = 'annual' then v_plan.annual_price else v_plan.monthly_price end;
      if v_amount <= 0 then
        raise exception 'The selected billing cycle is not priced for this plan';
      end if;
    elsif v_plan.pricing_model = 'PER_MEMBER' then
      v_unit := case when v_cycle = 'annual' then v_plan.annual_price else v_plan.monthly_price end;
      if v_unit <= 0 then
        raise exception 'The selected billing cycle is not priced for this plan';
      end if;
      v_amount := round(v_unit * v_members, 2);
    else
      select * into v_range
      from public.subscription_plan_ranges
      where plan_id = v_plan.id and min_members <= v_members and max_members >= v_members
      order by min_members desc
      limit 1;
      if not found then
        raise exception 'Your current member count exceeds the configured pricing range. Please contact the administrator.';
      end if;
      v_amount := case when v_cycle = 'annual' then v_range.annual_price else v_range.monthly_price end;
      if v_amount <= 0 then
        raise exception 'The selected billing cycle is not priced for this plan';
      end if;
    end if;

    if p_action = 'activate_trial' then
      v_trial_days := coalesce(p_trial_days, 30);
      if v_trial_days <= 0 then
        raise exception 'Trial duration must be greater than zero when trial is enabled';
      end if;
      insert into public.canteen_subscriptions(
        canteen_id, plan_id, status, trial_start, trial_end, subscription_start, subscription_end,
        amount, currency, payment_status, billing_cycle, plan_selection_mode, trial_used_at, effective_amount_override
      )
      values(
        p_canteen_id, v_plan.id, 'trial', v_now, v_now + make_interval(days => v_trial_days), null, null,
        v_amount, v_plan.currency, 'pending', v_cycle, v_mode, coalesce(v_sub.trial_used_at, v_now), null
      )
      on conflict(canteen_id) do update set
        plan_id = excluded.plan_id,
        status = 'trial',
        trial_start = excluded.trial_start,
        trial_end = excluded.trial_end,
        subscription_start = null,
        subscription_end = null,
        amount = excluded.amount,
        currency = excluded.currency,
        payment_status = 'pending',
        billing_cycle = excluded.billing_cycle,
        plan_selection_mode = excluded.plan_selection_mode,
        trial_used_at = coalesce(public.canteen_subscriptions.trial_used_at, excluded.trial_used_at),
        effective_amount_override = null,
        updated_at = now()
      returning * into v_sub;
      return v_sub;
    end if;

    v_start := coalesce(v_sub.subscription_start, v_now);
    v_end := case when v_cycle = 'annual' then v_start + interval '1 year' else v_start + interval '1 month' end;
    insert into public.canteen_subscriptions(
      canteen_id, plan_id, status, trial_start, trial_end, subscription_start, subscription_end,
      amount, currency, payment_status, billing_cycle, plan_selection_mode, trial_used_at, effective_amount_override
    )
    values(
      p_canteen_id, v_plan.id, 'active', v_sub.trial_start, v_sub.trial_end, v_start, v_end,
      v_amount, v_plan.currency, 'paid', v_cycle, v_mode, coalesce(v_sub.trial_used_at, v_now), null
    )
    on conflict(canteen_id) do update set
      plan_id = excluded.plan_id,
      status = 'active',
      subscription_start = excluded.subscription_start,
      subscription_end = excluded.subscription_end,
      amount = excluded.amount,
      currency = excluded.currency,
      payment_status = 'paid',
      billing_cycle = excluded.billing_cycle,
      plan_selection_mode = excluded.plan_selection_mode,
      trial_used_at = coalesce(public.canteen_subscriptions.trial_used_at, excluded.trial_used_at),
      effective_amount_override = null,
      updated_at = now()
    returning * into v_sub;
    return v_sub;
  end if;

  if p_action = 'extend_trial' then
    raise exception 'Trial extension is not supported. The initial trial is a one-time activation property.';
  end if;

  if p_action = 'change_plan' then
    if v_sub.id is null then
      raise exception 'Subscription not found';
    end if;
    if p_plan_id is null then
      raise exception 'Plan is required';
    end if;
    select * into v_plan from public.subscription_plans where id = p_plan_id and active = true;
    if not found then
      raise exception 'Selected plan not found or inactive';
    end if;
    v_cycle := coalesce(nullif(trim(p_billing_cycle), ''), v_sub.billing_cycle, 'monthly');
    if not public.subscription_cycle_supported(v_plan.billing_availability, v_cycle) then
      raise exception 'Selected billing cycle is not available for the selected plan';
    end if;
    if v_plan.pricing_model = 'FIXED_AMOUNT' then
      v_amount := case when v_cycle = 'annual' then v_plan.annual_price else v_plan.monthly_price end;
      if v_amount <= 0 then
        raise exception 'The selected billing cycle is not priced for this plan';
      end if;
    elsif v_plan.pricing_model = 'PER_MEMBER' then
      v_unit := case when v_cycle = 'annual' then v_plan.annual_price else v_plan.monthly_price end;
      if v_unit <= 0 then
        raise exception 'The selected billing cycle is not priced for this plan';
      end if;
      v_amount := round(v_unit * v_members, 2);
    else
      select * into v_range
      from public.subscription_plan_ranges
      where plan_id = v_plan.id and min_members <= v_members and max_members >= v_members
      order by min_members desc
      limit 1;
      if not found then
        raise exception 'Your current member count exceeds the configured pricing range. Please contact the administrator.';
      end if;
      v_amount := case when v_cycle = 'annual' then v_range.annual_price else v_range.monthly_price end;
      if v_amount <= 0 then
        raise exception 'The selected billing cycle is not priced for this plan';
      end if;
    end if;

    update public.canteen_subscriptions
    set plan_id = v_plan.id,
        amount = v_amount,
        currency = v_plan.currency,
        billing_cycle = v_cycle,
        plan_selection_mode = 'manual',
        effective_amount_override = null,
        updated_at = now()
    where id = v_sub.id
    returning * into v_sub;
    return v_sub;
  end if;

  if p_action = 'suspend' then
    if v_sub.id is null then raise exception 'Subscription not found'; end if;
    update public.canteen_subscriptions set status = 'suspended', updated_at = now() where id = v_sub.id returning * into v_sub;
    return v_sub;
  end if;
  if p_action = 'payment_pending' then
    if v_sub.id is null then raise exception 'Subscription not found'; end if;
    update public.canteen_subscriptions set payment_status = 'pending', updated_at = now() where id = v_sub.id returning * into v_sub;
    return v_sub;
  end if;
  raise exception 'Unsupported subscription action';
end;
$function$;

create or replace function public.get_subscription_upgrade_quote(
  p_canteen_id uuid,
  p_new_plan_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_sub public.canteen_subscriptions;
  v_old public.subscription_plans;
  v_new public.subscription_plans;
  v_new_id uuid;
  v_members integer;
  v_remaining integer;
  v_current_annual numeric(12,2);
  v_new_annual numeric(12,2);
  v_old_monthly numeric(12,2);
  v_new_monthly numeric(12,2);
  v_diff numeric(12,2);
  v_amount numeric(12,2);
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if not (public.is_super_admin() or public.current_canteen_id() = p_canteen_id) then raise exception 'Not authorized'; end if;
  select * into v_sub from public.canteen_subscriptions where canteen_id = p_canteen_id;
  if not found then raise exception 'Subscription not found'; end if;
  if v_sub.status <> 'active' or v_sub.billing_cycle <> 'annual' then
    return jsonb_build_object('required', false, 'reason', 'upgrade_only_applies_to_active_annual_subscriptions');
  end if;

  select * into v_old from public.subscription_plans where id = v_sub.plan_id;
  if not found then raise exception 'Current plan not found'; end if;

  v_members := (select count(*)::integer from public.profiles e where e.canteen_id = p_canteen_id and e.role = 'employee' and e.status = 'active');
  v_new_id := coalesce(p_new_plan_id, case when v_sub.plan_selection_mode = 'auto_range' then public.resolve_member_range_plan(p_canteen_id) else null end);
  if v_new_id is null then
    return jsonb_build_object('required', false, 'active_members', v_members, 'current_plan_id', v_old.id);
  end if;

  select * into v_new from public.subscription_plans where id = v_new_id and active = true;
  if not found then raise exception 'New plan not found'; end if;

  if v_new.pricing_model = 'MEMBER_RANGE' then
    select r.annual_price into v_new_annual
    from public.subscription_plan_ranges r
    where r.plan_id = v_new.id and r.min_members <= v_members and r.max_members >= v_members
    order by r.min_members desc limit 1;
    if v_new_annual is null then
      return jsonb_build_object('required', false, 'active_members', v_members, 'current_plan_id', v_old.id, 'reason', 'new_plan_member_count_exceeds_configured_range');
    end if;
  elsif v_new.pricing_model = 'PER_MEMBER' then
    v_new_annual := round(v_new.annual_price * v_members, 2);
  else
    v_new_annual := v_new.monthly_price;
  end if;

  -- The already-paid annual amount is the authoritative old price; never recompute it from today's member count.
  v_current_annual := v_sub.amount;
  v_old_monthly := round(v_current_annual / 12, 2);
  v_new_monthly := round(v_new_annual / 12, 2);
  v_diff := round(v_new_monthly - v_old_monthly, 2);

  select greatest(0, count(*)::integer) into v_remaining
  from generate_series(1, 120) g(n)
  where now() + (g.n * interval '1 month') < v_sub.subscription_end;

  v_amount := greatest(0, round(v_diff * v_remaining, 2));

  return jsonb_build_object(
    'required', v_amount > 0, 'active_members', v_members,
    'current_plan_id', v_old.id, 'current_plan_name', v_old.name,
    'current_monthly_equivalent', v_old_monthly,
    'new_plan_id', v_new.id, 'new_plan_name', v_new.name,
    'new_monthly_equivalent', v_new_monthly, 'monthly_difference', v_diff,
    'remaining_full_months', v_remaining, 'additional_amount', v_amount,
    'currency', v_new.currency, 'original_subscription_start', v_sub.subscription_start,
    'original_subscription_end', v_sub.subscription_end
  );
end;
$function$;
