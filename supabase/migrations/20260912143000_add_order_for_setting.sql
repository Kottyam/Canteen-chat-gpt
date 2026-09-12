alter table public.order_window_settings
  add column if not exists order_for text not null default 'today';

alter table public.order_window_settings
  drop constraint if exists order_window_settings_order_for_check;

alter table public.order_window_settings
  add constraint order_window_settings_order_for_check
  check (order_for in ('today','tomorrow'));

create or replace function public.employee_order_window_open()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamp := now() at time zone 'Asia/Kolkata';
  v_start time;
  v_end time;
  v_enabled boolean;
  v_order_for text := 'today';
  v_target_date date;
begin
  select enabled,start_time,end_time,coalesce(order_for,'today')
    into v_enabled,v_start,v_end,v_order_for
  from public.order_window_settings
  where canteen_id=public.current_canteen_id();

  v_target_date := case when v_order_for='tomorrow' then v_now::date + 1 else v_now::date end;

  if public.is_holiday_for_date(v_target_date) then return false; end if;
  if not found or not coalesce(v_enabled,false) then return true; end if;
  return v_now::time >= v_start and v_now::time < v_end;
end;
$$;
