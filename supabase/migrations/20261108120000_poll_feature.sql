-- Poll feature (admin-created, time-windowed, single/multi select)
-- Additive. Does not change existing billing, orders, or guest-order logic.

create table if not exists public.polls (
  id uuid primary key default gen_random_uuid(),
  canteen_id uuid not null references public.canteens(id) on delete cascade,
  title text not null,
  options jsonb not null default '[]'::jsonb,
  allow_multiple boolean not null default false,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  enabled boolean not null default false,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists polls_canteen_enabled_idx on public.polls (canteen_id, enabled, starts_at, ends_at);

create table if not exists public.poll_responses (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.polls(id) on delete cascade,
  canteen_id uuid not null references public.canteens(id) on delete cascade,
  member_id text not null,
  member_name text,
  selected_options jsonb not null default '[]'::jsonb,
  submitted_at timestamptz not null default now(),
  unique (poll_id, member_id)
);

create index if not exists poll_responses_poll_idx on public.poll_responses (poll_id);

alter table public.polls enable row level security;
alter table public.poll_responses enable row level security;

-- Basic policies: authenticated users of the same canteen can read active polls;
-- members can insert/update their own response; admins can manage polls.
-- (Adjust if stricter RLS is needed.)

drop policy if exists polls_select on public.polls;
create policy polls_select on public.polls for select to authenticated
  using (canteen_id in (select canteen_id from public.profiles where id = auth.uid()));

drop policy if exists polls_admin_all on public.polls;
create policy polls_admin_all on public.polls for all to authenticated
  using (canteen_id in (select canteen_id from public.profiles where id = auth.uid() and role = 'admin'))
  with check (canteen_id in (select canteen_id from public.profiles where id = auth.uid() and role = 'admin'));

drop policy if exists poll_responses_select on public.poll_responses;
create policy poll_responses_select on public.poll_responses for select to authenticated
  using (canteen_id in (select canteen_id from public.profiles where id = auth.uid()));

drop policy if exists poll_responses_member_upsert on public.poll_responses;
create policy poll_responses_member_upsert on public.poll_responses for insert to authenticated
  with check (canteen_id in (select canteen_id from public.profiles where id = auth.uid()));

drop policy if exists poll_responses_member_update on public.poll_responses;
create policy poll_responses_member_update on public.poll_responses for update to authenticated
  using (canteen_id in (select canteen_id from public.profiles where id = auth.uid()) and member_id = (select coalesce(employee_code, id::text) from public.profiles where id = auth.uid()))
  with check (canteen_id in (select canteen_id from public.profiles where id = auth.uid()));

grant select, insert, update, delete on public.polls to authenticated;
grant select, insert, update, delete on public.poll_responses to authenticated;
