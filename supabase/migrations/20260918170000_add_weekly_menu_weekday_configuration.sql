drop index if exists public.daily_menu_weekly_canteen_weekday_item_uidx;
drop index if exists public.daily_menu_weekday_idx;
alter table public.daily_menu drop constraint if exists daily_menu_weekday_check;
alter table public.daily_menu drop column if exists weekday;

create table if not exists public.weekly_menu (
  canteen_id uuid not null references public.canteens(id) on delete restrict,
  weekday smallint not null check (weekday between 0 and 6),
  item_code text not null,
  item_name text not null,
  unit_price numeric not null default 0 check (unit_price >= 0),
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (canteen_id,weekday,item_code)
);

alter table public.weekly_menu enable row level security;
drop policy if exists weekly_menu_admin on public.weekly_menu;
drop policy if exists weekly_menu_read on public.weekly_menu;
create policy weekly_menu_admin on public.weekly_menu for all
  using ((public.current_canteen_id() = canteen_id) and public.has_admin_permission('menu'))
  with check ((public.current_canteen_id() = canteen_id) and public.has_admin_permission('menu'));
create policy weekly_menu_read on public.weekly_menu for select
  using (public.current_canteen_id() = canteen_id);
create index if not exists weekly_menu_weekday_idx on public.weekly_menu(canteen_id,weekday) where active=true;