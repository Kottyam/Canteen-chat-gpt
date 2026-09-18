alter table public.daily_menu add column if not exists weekday smallint;
alter table public.daily_menu drop constraint if exists daily_menu_weekday_check;
alter table public.daily_menu add constraint daily_menu_weekday_check check (weekday is null or weekday between 0 and 6);
create unique index if not exists daily_menu_weekly_canteen_weekday_item_uidx
  on public.daily_menu (canteen_id, weekday, item_code)
  where weekday is not null;
create index if not exists daily_menu_weekday_idx
  on public.daily_menu (canteen_id, weekday)
  where weekday is not null;