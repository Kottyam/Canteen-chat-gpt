-- Additive Canteen ID admin login: nullable login columns only.
-- Passwords are never stored in public tables; Auth users are created/reset
-- via the manage-canteen-login Edge Function (service role, Super Admin only).

alter table public.canteens
  add column if not exists login_id text,
  add column if not exists login_user_id uuid references auth.users(id) on delete set null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'canteens_login_id_format'
      and conrelid = 'public.canteens'::regclass
  ) then
    alter table public.canteens
      add constraint canteens_login_id_format
      check (
        login_id is null
        or (
          login_id = upper(login_id)
          and login_id ~ '^[A-Z0-9]{3,16}$'
          and login_id ~ '[A-Z]'
        )
      );
  end if;
end
$$;

create unique index if not exists canteens_login_id_lower_uidx
  on public.canteens (lower(login_id))
  where login_id is not null;

create unique index if not exists canteens_login_user_id_uidx
  on public.canteens (login_user_id)
  where login_user_id is not null;

comment on column public.canteens.login_id is
  'Optional unique Canteen ID used for shared canteen-admin password login (e.g. KOCHI01).';
comment on column public.canteens.login_user_id is
  'Auth user id of the synthetic Canteen ID admin profile for this canteen.';
