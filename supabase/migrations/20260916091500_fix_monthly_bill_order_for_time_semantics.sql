create or replace function public.bill_publish_order_time_closed(p_bill_date date)
returns boolean
language plpgsql
stable
security definer
set search_path='public'
as $function$
declare
  v_now timestamp := public.gocanteen_business_timestamp();
  v_enabled boolean;
  v_end time;
  v_order_for text := 'today';
  v_order_window_date date;
begin
  if p_bill_date < v_now::date then return true; end if;
  if p_bill_date > v_now::date then return false; end if;
  if public.is_holiday_for_date(p_bill_date) then return true; end if;

  select enabled,end_time,coalesce(order_for,'today')
    into v_enabled,v_end,v_order_for
  from public.order_window_settings
  where canteen_id=public.current_canteen_id()
  limit 1;

  if not found or not coalesce(v_enabled,false) or v_end is null then return false; end if;

  -- The configured window applies either to the same calendar date (today)
  -- or to the following calendar date (tomorrow). For a bill dated today,
  -- a 'tomorrow' window belongs to yesterday's ordering cycle and is therefore
  -- already closed for today's bill. For a 'today' window, today's end_time
  -- remains the closing boundary.
  v_order_window_date := case when v_order_for='tomorrow' then p_bill_date - 1 else p_bill_date end;

  if v_order_window_date < v_now::date then return true; end if;
  if v_order_window_date > v_now::date then return false; end if;

  return v_now::time >= v_end;
end;
$function$;
notify pgrst,'reload schema';
