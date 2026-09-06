create or replace function public.complete_member_password_change()
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_updated integer;
begin
  if v_uid is null then
    raise exception 'Authentication required';
  end if;

  update public.profiles
  set is_first_login = false,
      updated_at = now()
  where id = v_uid
    and role = 'employee'
    and status = 'active';

  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'Active Member profile could not be updated.';
  end if;

  return true;
end;
$function$;

grant execute on function public.complete_member_password_change() to authenticated;
