begin;

alter table public.subscription_plans
  add column if not exists pricing_model text not null default 'MEMBER_RANGE';

alter table public.subscription_plans
  alter column min_members drop not null,
  alter column max_members drop not null;

update public.subscription_plans set pricing_model='MEMBER_RANGE' where pricing_model is null;

alter table public.subscription_plans drop constraint if exists subscription_plans_pricing_model_check;
alter table public.subscription_plans add constraint subscription_plans_pricing_model_check check (pricing_model in ('MEMBER_RANGE','FIXED_AMOUNT'));

alter table public.subscription_plans drop constraint if exists subscription_plans_member_range_check;
alter table public.subscription_plans add constraint subscription_plans_member_range_check
check (pricing_model='FIXED_AMOUNT' or (min_members is not null and max_members is not null and min_members >= 0 and max_members >= min_members));

create or replace function public.validate_subscription_plan_member_range()
returns trigger language plpgsql security definer set search_path=''
as $function$
begin
  if not public.is_super_admin() then raise exception 'Super Admin authorization required'; end if;
  if new.pricing_model not in ('MEMBER_RANGE','FIXED_AMOUNT') then raise exception 'Invalid pricing model'; end if;
  if new.pricing_model='MEMBER_RANGE' then
    if new.min_members is null or new.max_members is null or new.min_members < 0 or new.max_members < new.min_members then
      raise exception 'Invalid member range: Minimum Members must be >= 0 and Maximum Members must be >= Minimum Members';
    end if;
    if new.active and exists (
      select 1 from public.subscription_plans p
      where p.id <> new.id and p.active and p.pricing_model='MEMBER_RANGE'
        and new.min_members <= p.max_members and p.min_members <= new.max_members
    ) then raise exception 'Active plan member range overlaps another active plan'; end if;
  else
    new.min_members := null;
    new.max_members := null;
  end if;
  return new;
end;
$function$;

drop trigger if exists validate_subscription_plan_member_range on public.subscription_plans;
create trigger validate_subscription_plan_member_range
before insert or update of pricing_model,min_members,max_members,active
on public.subscription_plans for each row execute function public.validate_subscription_plan_member_range();

create or replace function public.auto_assign_canteen_trial()
returns trigger language plpgsql security definer set search_path=''
as $function$
begin
  return new;
end;
$function$;

revoke execute on function public.validate_subscription_plan_member_range() from public, anon, authenticated;
revoke execute on function public.auto_assign_canteen_trial() from public, anon, authenticated;

commit;