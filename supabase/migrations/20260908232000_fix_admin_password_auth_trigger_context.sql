-- Root-cause fix for Staff/Master Admin password updates.
-- guard_admin_auth_user_update() is SECURITY DEFINER, so current_user is the
-- function owner, not the Supabase Auth session. Use session_user to identify
-- Supabase Auth's internal auth.users update session.
create or replace function public.guard_admin_auth_user_update()
returns trigger
language plpgsql
security definer
set search_path to 'public','auth'
as $$
declare
  r text := coalesce(current_setting('request.jwt.claim.role', true), '');
  p public.profiles%rowtype;
begin
  select * into p from public.profiles where id=old.id;
  if p.role='admin'
     and p.admin_role in ('staff_admin','master_admin')
     and r <> 'service_role'
     and session_user <> 'supabase_auth_admin' then
    if new.encrypted_password is distinct from old.encrypted_password then
      raise exception 'Admin password is managed by the Owner.';
    end if;
    if new.email is distinct from old.email then
      raise exception 'Admin login identity is managed by the Owner.';
    end if;
  end if;
  return new;
end;
$$;
