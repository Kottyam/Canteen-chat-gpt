-- Make the existing day-before holiday notification resilient to a scheduler
-- invocation occurring after the exact 18:00 minute. Event-key deduplication
-- still guarantees one notification per declared holiday record/member.
create or replace function public.gocanteen_notification_scheduler()
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  v_now timestamp:=now() at time zone 'Asia/Kolkata';
  v_today date:=v_now::date;
  r record;
begin
  if v_now::time >= time '18:00' then
    for r in select hd.id,hd.canteen_id,hd.holiday_date from public.holiday_dates hd where hd.holiday_date=v_today+1 loop
      perform public.notify_canteen_employees_for_canteen(r.canteen_id,'holiday_tomorrow:'||r.id::text,'holiday_tomorrow','Holiday Tomorrow',format('Tomorrow is a holiday — %s.',to_char(r.holiday_date,'DD Mon YYYY')),jsonb_build_object('holiday_date',r.holiday_date::text,'holiday_id',r.id,'holiday_source','declared'));
    end loop;
  end if;
  for r in select canteen_id,enabled,start_time,end_time from public.order_window_settings where coalesce(enabled,false) and start_time is not null and end_time is not null loop
    if to_char(v_now,'HH24:MI')=to_char(r.start_time,'HH24:MI') then
      perform public.notify_canteen_employees_for_canteen(r.canteen_id,'order_time_open:'||r.canteen_id::text||':'||v_today::text,'order_time_open','Order Time Open','Today''s orders are now open.',jsonb_build_object('business_date',v_today::text,'order_window_state','open'));
    end if;
    if to_char(v_now,'HH24:MI')=to_char(r.end_time,'HH24:MI') then
      perform public.notify_canteen_employees_for_canteen(r.canteen_id,'order_time_closed:'||r.canteen_id::text||':'||v_today::text,'order_time_closed','Order Time Closed','Today''s orders are now closed.',jsonb_build_object('business_date',v_today::text,'order_window_state','closed'));
    end if;
  end loop;
end;
$$;
notify pgrst,'reload schema';
