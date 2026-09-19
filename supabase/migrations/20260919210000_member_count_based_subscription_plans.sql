begin;

alter table public.subscription_plans
  add column if not exists min_members integer not null default 0,
  add column if not exists max_members integer not null default 2147483647;

alter table public.subscription_plans
  drop constraint if exists subscription_plans_member_range_check;

alter table public.subscription_plans
  add constraint subscription_plans_member_range_check
  check (min_members >= 0 and max_members >= min_members);

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

  if new.min_members < 0 or new.max_members < new.min_members then
    raise exception 'Invalid member range: Minimum Members must be >= 0 and Maximum Members must be >= Minimum Members';
  end if;

  if new.active and exists (
    select 1
    from public.subscription_plans p
    where p.id <> new.id
      and p.active
      and new.min_members <= p.max_members
      and p.min_members <= new.max_members
  ) then
    raise exception 'Active plan member range overlaps another active plan';
  end if;

  return new;
end;
$function$;

drop trigger if exists validate_subscription_plan_member_range on public.subscription_plans;
create trigger validate_subscription_plan_member_range
before insert or update of min_members,max_members,active
on public.subscription_plans
for each row
execute function public.validate_subscription_plan_member_range();

create or replace function public.auto_assign_canteen_trial()
returns trigger
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_plan public.subscription_plans;
  v_is_super_admin boolean := false;
  v_member_count integer := 0;
begin
  select exists(
    select 1 from public.profiles p
    where p.id = new.owner_id
      and p.role = 'admin'
      and p.admin_role = 'super_admin'
      and p.status = 'active'
  ) into v_is_super_admin;

  if v_is_super_admin or new.id = 'f8ba1653-e7a2-4687-a819-74b2938af2f4' then
    return new;
  end if;

  if exists(select 1 from public.canteen_subscriptions s where s.canteen_id = new.id) then
    return new;
  end if;

  select count(*) into v_member_count
  from public.profiles p
  where p.canteen_id = new.id
    and p.role = 'employee'
    and p.status = 'active';

  select * into v_plan
  from public.subscription_plans
  where active = true and trial_days > 0
    and v_member_count between min_members and max_members
  order by min_members desc, created_at asc
  limit 1;

  if not found then
    select * into v_plan
    from public.subscription_plans
    where active = true and trial_days > 0 and is_default = true
    order by created_at asc limit 1;
  end if;

  if not found then
    raise exception 'No active trial plan matches % members and no active default trial plan is configured', v_member_count;
  end if;

  insert into public.canteen_subscriptions(
    canteen_id,plan_id,status,trial_start,trial_end,amount,currency,payment_status
  )
  values(
    new.id,v_plan.id,'trial',now(),
    now()+make_interval(days=>v_plan.trial_days),
    v_plan.price,v_plan.currency,'pending'
  )
  on conflict(canteen_id) do nothing;

  return new;
end;
$function$;

revoke execute on function public.validate_subscription_plan_member_range() from public, anon;
revoke execute on function public.auto_assign_canteen_trial() from public, anon;

commit;