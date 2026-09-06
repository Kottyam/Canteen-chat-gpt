create or replace function public.assert_member_delete_safe(p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_canteen uuid:=public.current_canteen_id();
  v_profile public.profiles%rowtype;
  v_today date:=(now() at time zone current_setting('TIMEZONE'))::date;
  r record;
  v_new numeric;
begin
  if not public.is_admin_user() then raise exception 'Admin access required'; end if;
  if not public.has_admin_permission('members') then raise exception 'Members permission required'; end if;
  select * into v_profile from public.profiles where id=p_profile_id and role='employee' and canteen_id=v_canteen and status<>'deleted';
  if not found then raise exception 'Member not found'; end if;

  for r in
    select distinct extract(year from d)::integer bill_year,extract(month from d)::integer bill_month
    from (
      select ordered_for d from public.orders where employee_id=p_profile_id and canteen_id=v_canteen
      union all select adjustment_date d from public.employee_adjustments where employee_id=p_profile_id and canteen_id=v_canteen
      union all select make_date(bill_year,bill_month,1) d from public.monthly_bills where employee_id=p_profile_id and canteen_id=v_canteen
    ) x
    where d is not null and d<=v_today
  loop
    select s.new_amount into v_new
    from public.get_admin_bill_publish_states(r.bill_month,r.bill_year) s
    where s.employee_id=p_profile_id
    limit 1;
    if coalesce(v_new,0)>0 then
      raise exception 'Please publish the pending amount before deleting this Member.';
    end if;
  end loop;
end;
$function$;

create or replace function public.delete_employee_profile(p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_canteen uuid:=public.current_canteen_id();
begin
  perform public.assert_member_delete_safe(p_profile_id);
  update public.profiles set status='deleted',updated_at=now()
  where id=p_profile_id and role='employee' and canteen_id=v_canteen;
end;
$function$;

create or replace function public.trg_guard_member_delete()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if old.role='employee' and old.status<>'deleted' and new.status='deleted' then
    perform public.assert_member_delete_safe(old.id);
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_guard_member_delete on public.profiles;
create trigger trg_guard_member_delete
before update of status on public.profiles
for each row execute function public.trg_guard_member_delete();
