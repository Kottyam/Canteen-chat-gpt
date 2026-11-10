-- Server-side poll_open notifications, once per poll, when the poll actually opens.
-- Does not backfill existing polls (including the ended Nov 8 poll). No billing-mode check.

alter table public.polls
  add column if not exists open_notified_at timestamptz;

update public.polls
  set open_notified_at = coalesce(open_notified_at, now())
  where open_notified_at is null;

create or replace function public.notify_poll_open_if_needed(p_poll_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  r record;
  v_count integer := 0;
  v_sent integer;
begin
  for r in
    select p.id, p.canteen_id, p.title
    from public.polls p
    where (p_poll_id is null or p.id = p_poll_id)
      and p.enabled
      and p.starts_at <= now()
      and p.ends_at > now()
      and p.open_notified_at is null
    for update skip locked
  loop
    update public.polls
      set open_notified_at = now()
      where id = r.id
        and open_notified_at is null;
    if not found then
      continue;
    end if;

    v_sent := public.notify_canteen_employees_for_canteen(
      r.canteen_id,
      'poll_open:' || r.id::text,
      'poll_open',
      'New Poll',
      format('"%s" is open. Please submit your response.', r.title),
      jsonb_build_object('poll_id', r.id, 'screen', 'poll')
    );
    v_count := v_count + coalesce(v_sent, 0);
  end loop;
  return v_count;
end;
$fn$;

revoke all on function public.notify_poll_open_if_needed(uuid) from public, anon, authenticated;

create or replace function public.polls_notify_open_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  perform public.notify_poll_open_if_needed(new.id);
  return new;
end;
$fn$;

drop trigger if exists polls_notify_open on public.polls;
create trigger polls_notify_open
  after insert or update of enabled, starts_at, ends_at
  on public.polls
  for each row
  execute function public.polls_notify_open_trigger();

create or replace function public.gocanteen_notification_scheduler()
returns void
language plpgsql
security definer
set search_path=public
as $fn$
declare
  v_now timestamp:=now() at time zone 'Asia/Kolkata';
  v_today date:=v_now::date;
  r record;
  v_target_date date;
  v_order_label text;
  v_weekday smallint;
  v_holiday boolean;
  v_member record;
begin
  if v_now::time>=time '18:00' then
    for r in
      select hd.id,hd.canteen_id,hd.holiday_date
      from public.holiday_dates hd
      where hd.holiday_date=v_today+1
    loop
      perform public.notify_canteen_employees_for_canteen(
        r.canteen_id,
        'holiday_tomorrow:'||r.id::text,
        'holiday_tomorrow',
        'Holiday Tomorrow',
        format('Tomorrow is a holiday — %s.',to_char(r.holiday_date,'DD Mon YYYY')),
        jsonb_build_object('holiday_date',r.holiday_date::text,'holiday_id',r.id,'holiday_source','declared')
      );
    end loop;
  end if;

  for r in
    select canteen_id,enabled,start_time,end_time,coalesce(order_for,'today') as order_for
    from public.order_window_settings
    where coalesce(enabled,false)
      and start_time is not null
      and end_time is not null
  loop
    v_target_date:=case when r.order_for='tomorrow' then v_today+1 else v_today end;
    v_order_label:=case when r.order_for='tomorrow' then 'Tomorrow''s' else 'Today''s' end;

    if to_char(v_now,'HH24:MI')=to_char(r.start_time,'HH24:MI') then
      perform public.notify_canteen_employees_for_canteen(
        r.canteen_id,
        'order_time_open:'||r.canteen_id::text||':'||v_target_date::text||':'||r.order_for,
        'order_time_open','Order Time Open',
        v_order_label||' orders are now open.',
        jsonb_build_object('business_date',v_target_date::text,'order_for',r.order_for,'order_window_state','open')
      );
    end if;

    if to_char(v_now,'HH24:MI')=to_char(r.end_time-interval '10 minutes','HH24:MI') then
      -- Closing reminder remains exactly 10 minutes before the configured
      -- end_time. Only the per-Member recipient eligibility is changed.
      for v_member in
        select p.id
        from public.profiles p
        where p.canteen_id=r.canteen_id
          and p.role='employee'
          and p.status='active'
          and not exists (
            select 1
            from public.orders o
            join public.order_items oi on oi.order_id=o.id
            where o.canteen_id=r.canteen_id
              and o.employee_id=p.id
              and o.ordered_for=v_target_date
              and o.status='active'
              and oi.item_source in ('employee','admin')
              and coalesce(oi.quantity,0)>0
          )
      loop
        perform public.create_member_notification(
          v_member.id,
          'order_time_closing_soon',
          'Order Time Closing Soon',
          v_order_label||' orders close in 10 minutes.',
          jsonb_build_object(
            'business_date',v_target_date::text,
            'order_for',r.order_for,
            'order_window_state','closing_soon'
          ),
          'order_time_closing_soon:'||r.canteen_id::text||':'||v_target_date::text||':'||r.order_for
        );
      end loop;
    end if;

    if to_char(v_now,'HH24:MI')=to_char(r.end_time,'HH24:MI') then
      perform public.notify_canteen_employees_for_canteen(
        r.canteen_id,
        'order_time_closed:'||r.canteen_id::text||':'||v_target_date::text||':'||r.order_for,
        'order_time_closed','Order Time Closed',
        v_order_label||' orders are now closed.',
        jsonb_build_object('business_date',v_target_date::text,'order_for',r.order_for,'order_window_state','closed')
      );
    end if;

    if to_char(v_now,'HH24:MI')=to_char(r.start_time-interval '30 minutes','HH24:MI') then
      v_weekday:=extract(dow from v_target_date)::smallint;
      select exists(
        select 1 from public.holiday_dates h
        where h.canteen_id=r.canteen_id and h.holiday_date=v_target_date
      ) into v_holiday;

      if not coalesce(v_holiday,false) and not exists(
        select 1 from public.weekly_menu wm
        where wm.canteen_id=r.canteen_id
          and wm.weekday=v_weekday
          and wm.active=true
      ) then
        perform private.create_admin_notification(
          r.canteen_id,
          'menu',
          'menu_not_configured',
          'Menu Not Configured',
          format('%s''s menu has not been configured yet.',to_char(v_target_date,'FMDay')),
          jsonb_build_object(
            'screen','menu',
            'weekday',v_weekday,
            'business_date',v_target_date::text,
            'order_for',r.order_for
          ),
          format('menu_not_configured:%s:%s',r.canteen_id::text,v_target_date::text)
        );
      end if;
    end if;
  end loop;

  perform public.notify_poll_open_if_needed(null);
end;
$fn$;
