-- Monthly bill publishing rules:
-- * Previous months are always publishable; employee order time is irrelevant.
-- * Current month is publishable only after the configured employee order window closes.
-- * Holidays never block bill publishing. Holiday rules apply to ordering, not billing.
-- * Existing pending payment batches do not block publishing a genuinely new amount.
--   The existing incremental publication logic remains responsible for preventing
--   duplicate publication of already-covered activity.

create or replace function public.bill_publish_window_open(p_month integer,p_year integer)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
with local_now as (
  select now() at time zone current_setting('TIMEZONE') as ts
),
current_period as (
  select date_trunc('month',(select ts from local_now))::date as month_start
),
settings as (
  select enabled,start_time,end_time
  from public.order_window_settings
  where canteen_id=public.current_canteen_id()
  limit 1
)
select case
  -- Any completed month can be published at any time.
  when make_date(p_year,p_month,1) < (select month_start from current_period) then true

  -- Future months are never publishable.
  when make_date(p_year,p_month,1) > (select month_start from current_period) then false

  -- Current month: if order-time control is disabled, publishing is open.
  when not coalesce((select enabled from settings),false) then true

  -- Current month: publishing opens after the employee order window closes.
  -- Deliberately do not check holiday status here. Holidays restrict ordering,
  -- not bill publishing.
  else (select ts::time >= end_time from local_now,settings)
end;
$$;

revoke all on function public.bill_publish_window_open(integer,integer) from public;
grant execute on function public.bill_publish_window_open(integer,integer) to authenticated;

notify pgrst,'reload schema';
