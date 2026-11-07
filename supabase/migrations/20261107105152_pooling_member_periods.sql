-- Membership periods per canteen (join / leave business dates, IST), used by Pooling billing so a
-- member removed mid-month keeps owing that month and a mid-month joiner is known by real dates.
-- Additive: profiles, delete_employee_profile and every Standard rule are unchanged; triggers only
-- RECORD dates. No FK to profiles so history survives; rows go away only with the canteen.
create table if not exists public.pooling_member_periods(
  canteen_id uuid not null references public.canteens(id) on delete cascade,
  employee_id uuid not null,
  joined_on date not null,
  left_on date,
  source text not null default 'trigger' check (source in ('trigger','backfill')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (canteen_id, employee_id, joined_on),
  check (left_on is null or left_on >= joined_on)
);
create unique index if not exists pooling_member_periods_one_open
  on public.pooling_member_periods(canteen_id, employee_id) where left_on is null;
alter table public.pooling_member_periods enable row level security;
drop policy if exists pooling_member_periods_admin_select on public.pooling_member_periods;
create policy pooling_member_periods_admin_select on public.pooling_member_periods for select to authenticated
  using (canteen_id = (select public.current_canteen_id()) and (select public.has_admin_permission('payments')));
revoke all on table public.pooling_member_periods from public, anon, authenticated;
grant select on table public.pooling_member_periods to authenticated;
grant all on table public.pooling_member_periods to service_role;

create or replace function gocanteen_private.ist_date(p timestamptz) returns date
  language sql immutable set search_path='' as $$ select (p at time zone 'Asia/Kolkata')::date $$;

create or replace function gocanteen_private.track_member_period() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_today date := gocanteen_private.ist_date(now());
begin
  if new.role is distinct from 'employee' then return new; end if;
  if tg_op = 'INSERT' then
    if new.canteen_id is not null and new.status <> 'deleted' then
      insert into public.pooling_member_periods(canteen_id,employee_id,joined_on)
      values(new.canteen_id,new.id,gocanteen_private.ist_date(coalesce(new.created_at,now()))) on conflict do nothing;
    end if;
    return new;
  end if;
  -- leaving: removed, or moved to another canteen -> close the open period (inclusive of today)
  if old.canteen_id is not null and old.status <> 'deleted'
     and (new.status = 'deleted' or new.canteen_id is distinct from old.canteen_id) then
    update public.pooling_member_periods set left_on = greatest(joined_on, v_today), updated_at = now()
     where canteen_id = old.canteen_id and employee_id = old.id and left_on is null;
  end if;
  -- (re)joining: restored, or moved into a canteen -> open a new period from today
  if new.canteen_id is not null and new.status <> 'deleted'
     and (old.status = 'deleted' or new.canteen_id is distinct from old.canteen_id) then
    insert into public.pooling_member_periods(canteen_id,employee_id,joined_on)
    values(new.canteen_id,new.id,v_today)
    on conflict (canteen_id,employee_id,joined_on) do update set left_on = null, updated_at = now();
  end if;
  return new;
end $$;
revoke all on function gocanteen_private.track_member_period() from public, anon, authenticated;
revoke all on function gocanteen_private.ist_date(timestamptz) from public, anon, authenticated;

drop trigger if exists zz_track_member_period on public.profiles;
create trigger zz_track_member_period after insert or update of status, canteen_id on public.profiles
  for each row execute function gocanteen_private.track_member_period();

-- Backfill CURRENT members only, from the canteen-scoped profile creation date (the date the admin added
-- them). Members removed before this migration have no recorded leave date and are NOT guessed.
insert into public.pooling_member_periods(canteen_id,employee_id,joined_on,source)
select p.canteen_id, p.id, gocanteen_private.ist_date(p.created_at), 'backfill'
from public.profiles p
where p.role = 'employee' and p.status <> 'deleted' and p.canteen_id is not null
on conflict do nothing;
