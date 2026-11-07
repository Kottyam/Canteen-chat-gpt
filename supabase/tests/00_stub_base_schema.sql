-- LOCAL TEST ONLY. Synthetic stand-in for (1) the Supabase platform pieces
-- (roles, auth schema, auth.uid()/auth.role()) and (2) the original Go Canteen
-- base tables/functions that pre-date the repo's migration history
-- (profiles, orders, order_items, monthly_bills, expenses, ...,
-- has_admin_permission, is_admin_user). Columns are inferred from app code; the
-- repo migrations are then applied on top unchanged. Never run against a real DB.
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname='supabase_auth_admin') then create role supabase_auth_admin nologin; end if;
  if not exists (select 1 from pg_roles where rolname='postgres_app') then create role postgres_app nologin; end if;
end $$;
create extension if not exists pgcrypto;
create schema if not exists auth;
create schema if not exists extensions;
create schema if not exists cron;
create schema if not exists net;
create table if not exists auth.users(id uuid primary key, email text, raw_app_meta_data jsonb default '{}', raw_user_meta_data jsonb default '{}', encrypted_password text, created_at timestamptz default now(), updated_at timestamptz default now(), phone text, email_confirmed_at timestamptz, deleted_at timestamptz, banned_until timestamptz);
create table if not exists auth.identities(id uuid primary key default gen_random_uuid(), user_id uuid, provider text, identity_data jsonb, provider_id text);
create table if not exists auth.sessions(id uuid primary key default gen_random_uuid(), user_id uuid);
create table if not exists auth.refresh_tokens(id bigserial primary key, user_id text, session_id uuid, revoked boolean);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(coalesce(current_setting('request.jwt.claim.sub', true), (nullif(current_setting('request.jwt.claims', true),'')::jsonb ->> 'sub')),'')::uuid $$;
create or replace function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true),''), (nullif(current_setting('request.jwt.claims', true),'')::jsonb ->> 'role')) $$;
create or replace function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true),''),'{}')::jsonb $$;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
-- Supabase platform default privileges (RLS is what restricts rows):
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
create or replace function cron.schedule(a text, b text, c text) returns bigint language sql as $$ select 1::bigint $$;
create or replace function cron.unschedule(a text) returns boolean language sql as $$ select true $$;
create table if not exists cron.job(jobid bigserial primary key, jobname text, schedule text, command text);

create table if not exists public.profiles(
  id uuid primary key, role text not null default 'employee', status text not null default 'active',
  full_name text, mobile_number text, employee_code text, sr_number text, admin_role text,
  is_first_login boolean default false, created_at timestamptz not null default now(), updated_at timestamptz default now(),
  email text, auth_provider text, member_login_mode text, deleted_at timestamptz);
create table if not exists public.admin_permissions(admin_id uuid references public.profiles(id) on delete cascade, permission text, primary key(admin_id, permission));
create table if not exists public.menu_prices(item_code text primary key, item_name text, unit_price numeric not null default 0, active boolean default true, archived boolean default false, updated_at timestamptz default now());
create table if not exists public.daily_menu(id uuid primary key default gen_random_uuid(), menu_date date, item_code text, item_name text, unit_price numeric default 0, active boolean default true);
create table if not exists public.holidays(id uuid primary key default gen_random_uuid(), holiday_date date unique, created_at timestamptz default now());
create table if not exists public.order_window_settings(id int primary key default 1, start_time time, end_time time, enabled boolean default false, updated_at timestamptz default now());
create table if not exists public.orders(id uuid primary key default gen_random_uuid(), employee_id uuid references public.profiles(id), ordered_for date not null, status text not null default 'active', created_at timestamptz not null default now(), updated_at timestamptz default now(), cancelled_at timestamptz, order_source text default 'employee', member_name_snapshot text, member_mobile_snapshot text, unique(employee_id, ordered_for));
create table if not exists public.order_items(id uuid primary key default gen_random_uuid(), order_id uuid references public.orders(id) on delete cascade, item_code text, item_name text, quantity integer not null default 1, unit_price numeric not null default 0, line_total numeric, item_source text not null default 'employee', created_at timestamptz default now());
create table if not exists public.monthly_bills(id uuid primary key default gen_random_uuid(), employee_id uuid, bill_month integer, bill_year integer, days_ordered integer default 0, food_total numeric default 0, admin_added_total numeric default 0, total numeric default 0, published boolean default false, member_name_snapshot text, member_mobile_snapshot text, published_at timestamptz, created_at timestamptz default now(), updated_at timestamptz default now(), constraint monthly_bills_employee_id_fkey foreign key (employee_id) references public.profiles(id), unique(employee_id,bill_month,bill_year));
create table if not exists public.expenses(id uuid primary key default gen_random_uuid(), expense_date date not null, amount numeric not null, description text default '', created_at timestamptz default now());
create table if not exists public.notifications(id uuid primary key default gen_random_uuid(), recipient_id uuid, employee_id uuid, title text, message text, body text, type text, notification_type text, dedupe_key text, payload jsonb default '{}', read boolean default false, read_at timestamptz, created_at timestamptz default now());
create table if not exists public.payments(id uuid primary key default gen_random_uuid(), employee_id uuid, amount numeric, status text, created_at timestamptz default now());
create or replace function public.is_admin_user() returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.profiles where id=auth.uid() and role='admin' and status='active') $$;
create or replace function public.has_admin_permission(p text) returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='admin' and p.status='active'
    and (p.admin_role in ('owner','master_admin','super_admin') or p.admin_role is null or exists(select 1 from public.admin_permissions a where a.admin_id=p.id and a.permission=$1))) $$;
do $$ begin if not exists(select 1 from pg_publication where pubname='supabase_realtime') then create publication supabase_realtime; end if; end $$;
