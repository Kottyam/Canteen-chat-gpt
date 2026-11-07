-- LOCAL TEST ONLY: synthetic fixtures (no production data). Month under test: Sept 2026.
-- C1 = pooling canteen, C2 = other tenant (isolation), C3 = standard canteen (auto-send via publish_employee_bill).
insert into auth.users(id,email) values
 ('11111111-0000-0000-0000-000000000001','o1@test'),('22222222-0000-0000-0000-000000000001','o2@test'),('33333333-0000-0000-0000-000000000001','o3@test');
insert into public.canteens(id,name,owner_id) values
 ('c1000000-0000-0000-0000-000000000000','Pool Mess','11111111-0000-0000-0000-000000000001'),
 ('c2000000-0000-0000-0000-000000000000','Other Tenant','22222222-0000-0000-0000-000000000001'),
 ('c3000000-0000-0000-0000-000000000000','Standard Canteen','33333333-0000-0000-0000-000000000001');
insert into public.profiles(id,role,status,full_name,employee_code,admin_role,canteen_id,created_at) values
 ('11111111-0000-0000-0000-000000000001','admin','active','Owner One','o1','owner','c1000000-0000-0000-0000-000000000000','2026-01-01'),
 ('11111111-0000-0000-0000-0000000000f1','admin','active','Staff NoPay','s1','staff_admin','c1000000-0000-0000-0000-000000000000','2026-01-01'),
 ('11111111-0000-0000-0000-0000000000a1','employee','active','Asha','m1',null,'c1000000-0000-0000-0000-000000000000','2026-01-01'),
 ('11111111-0000-0000-0000-0000000000a2','employee','active','Biju','m2',null,'c1000000-0000-0000-0000-000000000000','2026-01-01'),
 ('11111111-0000-0000-0000-0000000000a3','employee','active','Chitra','m3',null,'c1000000-0000-0000-0000-000000000000','2026-09-21 20:00:00+00'),
 ('22222222-0000-0000-0000-000000000001','admin','active','Owner Two','o2','owner','c2000000-0000-0000-0000-000000000000','2026-01-01'),
 ('22222222-0000-0000-0000-0000000000b1','employee','active','Other Member','n1',null,'c2000000-0000-0000-0000-000000000000','2026-01-01'),
 ('33333333-0000-0000-0000-000000000001','admin','active','Owner Three','o3','owner','c3000000-0000-0000-0000-000000000000','2026-01-01'),
 ('33333333-0000-0000-0000-0000000000d1','employee','active','Std Member','d1',null,'c3000000-0000-0000-0000-000000000000','2026-01-01');
