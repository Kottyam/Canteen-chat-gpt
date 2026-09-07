-- Supabase Auth performs auth.users updates as supabase_auth_admin.
-- The Owner-only Edge Function still performs all authorization and target/canteen checks.
-- Allow the Auth service to complete the password/email update while keeping direct
-- non-service-role writes to Staff/Master Admin Auth identities blocked.
create or replace function public.guard_admin_auth_user_update()
returns trigger
language plpgsql
security definer
set search_path to public, auth
as $$
declare
  r text := coalesce(current_setting('request.jwt.claim.role', true), '');
  p public.profiles%rowtype;
begin
  select * into p from public.profiles where id = old.id;

  if p.role = 'admin'
     and p.admin_role in ('staff_admin','master_admin')
     and r <> 'service_role'
     and current_user <> 'supabase_auth_admin' then
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
