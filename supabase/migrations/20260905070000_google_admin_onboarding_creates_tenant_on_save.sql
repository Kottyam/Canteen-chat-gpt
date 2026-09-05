-- Google Admin onboarding must not create a tenant before the admin
-- enters and saves the canteen name. A new Google identity gets an admin
-- profile with a NULL canteen_id and is routed to the existing onboarding UI.
-- The tenant is created exactly once by complete_google_admin_onboarding.

create or replace function public.ensure_google_admin()
returns jsonb
language plpgsql
security definer
set search_path to public, auth
as $function$
declare
  v_uid uuid := auth.uid();
  v_name text;
  v_profile public.profiles;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;

  select coalesce(raw_user_meta_data->>'full_name', raw_user_meta_data->>'name', split_part(email,'@',1))
    into v_name
  from auth.users where id=v_uid;

  if not exists (
    select 1 from auth.users
    where id=v_uid and coalesce(raw_app_meta_data->>'provider','')='google'
  ) then
    raise exception 'Google authentication required';
  end if;

  select * into v_profile from public.profiles where id=v_uid;

  -- Returning Google admins reuse their existing tenant. An admin profile
  -- without a tenant is an in-progress onboarding record and must not create
  -- a placeholder tenant here.
  if v_profile.id is not null and v_profile.role='admin' and v_profile.status='active' then
    return jsonb_build_object(
      'canteen_id', v_profile.canteen_id,
      'profile_id', v_uid,
      'existing', v_profile.canteen_id is not null,
      'needs_setup', v_profile.canteen_id is null or not coalesce(v_profile.onboarding_completed,true),
      'canteen_name', (select name from public.canteens where id=v_profile.canteen_id)
    );
  end if;

  if v_profile.id is not null and v_profile.role='employee' then
    raise exception 'This Google account is already linked to a Member account';
  end if;

  insert into public.profiles(
    id, employee_code, sr_number, full_name, mobile_number,
    role, status, is_first_login, canteen_id, onboarding_completed
  ) values (
    v_uid, null, null, v_name, null,
    'admin', 'active', false, null, false
  )
  on conflict(id) do update set
    full_name=excluded.full_name,
    role='admin',
    status='active',
    onboarding_completed=false;

  return jsonb_build_object(
    'canteen_id', null,
    'profile_id', v_uid,
    'existing', false,
    'needs_setup', true,
    'canteen_name', null
  );
end;
$function$;

create or replace function public.complete_google_admin_onboarding(p_canteen_name text)
returns jsonb
language plpgsql
security definer
set search_path to public
as $function$
declare
  v_uid uuid := auth.uid();
  v_canteen_id uuid;
  v_name text := trim(coalesce(p_canteen_name,''));
begin
  if v_uid is null or not public.is_admin_user() then
    raise exception 'Admin authentication required';
  end if;
  if length(v_name)<1 or length(v_name)>120 then
    raise exception 'Canteen name must be between 1 and 120 characters';
  end if;

  -- Prevent two simultaneous onboarding submissions from creating two tenants.
  perform pg_advisory_xact_lock(hashtext('google-canteen-onboarding:'||v_uid::text));

  select canteen_id into v_canteen_id
  from public.profiles
  where id=v_uid and role='admin' and status='active'
  for update;

  if v_canteen_id is null then
    insert into public.canteens(name,owner_id)
    values(v_name,v_uid)
    returning id into v_canteen_id;

    update public.profiles
    set canteen_id=v_canteen_id,
        onboarding_completed=true,
        updated_at=now()
    where id=v_uid;
  else
    update public.canteens
    set name=v_name, updated_at=now()
    where id=v_canteen_id and owner_id=v_uid;
    if not found then raise exception 'Canteen ownership could not be verified'; end if;
    update public.profiles set onboarding_completed=true, updated_at=now() where id=v_uid;
  end if;

  return jsonb_build_object('canteen_id',v_canteen_id,'canteen_name',v_name);
end;
$function$;

revoke all on function public.ensure_google_admin() from public;
grant execute on function public.ensure_google_admin() to authenticated;
revoke all on function public.complete_google_admin_onboarding(text) from public;
grant execute on function public.complete_google_admin_onboarding(text) to authenticated;

notify pgrst,'reload schema';
