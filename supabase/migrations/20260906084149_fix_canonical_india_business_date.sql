do $$
declare r record; v_def text;
begin
  for r in
    select p.oid
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.prokind='f'
      and (
        pg_get_functiondef(p.oid) ilike '%current_setting(''TIMEZONE'')%'
        or pg_get_functiondef(p.oid) ilike '%current_date%'
      )
      and p.proname in (
        'admin_add_declared_holiday',
        'assert_member_delete_safe',
        'bill_publish_window_open',
        'cleanup_go_canteen_old_data',
        'employee_order_window_open',
        'get_admin_bill_publish_states',
        'publish_employee_bill',
        'purge_old_order_history',
        'validate_daily_menu_window'
      )
  loop
    v_def:=pg_get_functiondef(r.oid);
    v_def:=replace(v_def, 'current_setting(''TIMEZONE'')', '''Asia/Kolkata''');
    v_def:=replace(v_def, 'current_date', '(now() at time zone ''Asia/Kolkata'')::date');
    execute v_def;
  end loop;
end $$;

create or replace function public.gocanteen_business_date()
returns date
language sql
stable
security invoker
as $$
  select (now() at time zone 'Asia/Kolkata')::date;
$$;

create or replace function public.gocanteen_business_timestamp()
returns timestamp
language sql
stable
security invoker
as $$
  select now() at time zone 'Asia/Kolkata';
$$;
