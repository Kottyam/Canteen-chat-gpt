create or replace function public.admin_add_declared_holiday(p_date date)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_canteen uuid;
  v_inserted date;
  v_count integer := 0;
begin
  v_canteen := public.current_canteen_id();
  if v_canteen is null or not public.is_admin_user() then
    raise exception 'Only an admin can manage declared holidays.';
  end if;
  if p_date is null then
    raise exception 'Holiday date is required.';
  end if;
  if p_date < current_date then
    raise exception 'Holiday date cannot be in the past.';
  end if;

  insert into public.holiday_dates(canteen_id,holiday_date,created_by)
  values(v_canteen,p_date,auth.uid())
  on conflict(canteen_id,holiday_date) do nothing
  returning holiday_date into v_inserted;

  if v_inserted is not null then
    insert into public.notifications(recipient_id,notification_type,title,message,payload,canteen_id)
    select
      p.id,
      'holiday_declared',
      'Holiday Declared',
      format('The canteen will be closed for orders on %s. Orders are not available on this date.',to_char(p_date,'DD Mon YYYY')),
      jsonb_build_object(
        'holiday_date',to_char(p_date,'YYYY-MM-DD'),
        'expires_on',to_char(p_date,'YYYY-MM-DD'),
        'holiday_source','declared'
      ),
      v_canteen
    from public.profiles p
    where p.canteen_id=v_canteen
      and p.role='employee'
      and p.status='active';
    get diagnostics v_count = row_count;
  end if;

  return jsonb_build_object(
    'holiday_date',to_char(p_date,'YYYY-MM-DD'),
    'created',v_inserted is not null,
    'notifications_created',v_count
  );
end;
$$;

revoke all on function public.admin_add_declared_holiday(date) from public;
grant execute on function public.admin_add_declared_holiday(date) to authenticated;
