-- LOCAL TEST ONLY: the legacy-tenant backfill migration requires the original admin row.
insert into auth.users(id,email) values('00000000-0000-0000-0000-0000000000ad','admin@gocanteen.local') on conflict do nothing;
insert into public.canteens(id,name,owner_id) values('00000000-0000-0000-0000-00000000c0de','Legacy Test Canteen','00000000-0000-0000-0000-0000000000ad') on conflict do nothing;
insert into public.profiles(id,role,status,full_name,employee_code,admin_role,canteen_id) values('00000000-0000-0000-0000-0000000000ad','admin','active','Legacy Admin','admin','owner','00000000-0000-0000-0000-00000000c0de') on conflict do nothing;
