alter table public.profiles drop constraint if exists profiles_admin_role_check;

alter table public.profiles add constraint profiles_admin_role_check
  check (
    admin_role = any (array['owner'::text,'master_admin'::text,'staff_admin'::text])
    or (admin_role = 'super_admin' and id = 'ad0ff407-273b-4d83-b765-cb4b944e7600'::uuid)
  );

update public.profiles
set admin_role='super_admin'
where id='ad0ff407-273b-4d83-b765-cb4b944e7600'::uuid
  and employee_code='admin'
  and role='admin'
  and status='active';

notify pgrst,'reload schema';
