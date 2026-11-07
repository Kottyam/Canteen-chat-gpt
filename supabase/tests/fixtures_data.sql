-- LOCAL TEST ONLY: synthetic orders/expenses for Sept + Oct 2026.
select set_config('request.jwt.claims','{"role":"authenticated","sub":"11111111-0000-0000-0000-000000000001"}',false);
insert into public.holiday_dates(canteen_id,holiday_date) values('c1000000-0000-0000-0000-000000000000','2026-09-13');
-- Asha: every non-holiday Sept day; 10th is guest-only
insert into public.orders(id,employee_id,ordered_for,status,order_source,canteen_id)
select gen_random_uuid(),'11111111-0000-0000-0000-0000000000a1',d::date,'active','admin','c1000000-0000-0000-0000-000000000000'
from generate_series('2026-09-01'::date,'2026-09-30','1 day') d where d::date<>'2026-09-13';
-- Biju: skips 2,9,15,21,28 (5 days) and the 4th is cancelled -> 6 no-order days
insert into public.orders(id,employee_id,ordered_for,status,order_source,canteen_id)
select gen_random_uuid(),'11111111-0000-0000-0000-0000000000a2',d::date,case when d::date='2026-09-04' then 'cancelled' else 'active' end,'admin','c1000000-0000-0000-0000-000000000000'
from generate_series('2026-09-01'::date,'2026-09-30','1 day') d where d::date<>'2026-09-13' and extract(day from d)::int not in (2,9,15,21,28);
-- Chitra: joined 22nd IST, eats 22..30
insert into public.orders(id,employee_id,ordered_for,status,order_source,canteen_id)
select gen_random_uuid(),'11111111-0000-0000-0000-0000000000a3',d::date,'active','admin','c1000000-0000-0000-0000-000000000000'
from generate_series('2026-09-22'::date,'2026-09-30','1 day') d;
-- October: everyone eats every day
insert into public.orders(id,employee_id,ordered_for,status,order_source,canteen_id)
select gen_random_uuid(),m,d::date,'active','admin','c1000000-0000-0000-0000-000000000000'
from generate_series('2026-10-01'::date,'2026-10-31','1 day') d, unnest(array['11111111-0000-0000-0000-0000000000a1','11111111-0000-0000-0000-0000000000a2','11111111-0000-0000-0000-0000000000a3']::uuid[]) m;
insert into public.order_items(order_id,item_code,item_name,quantity,unit_price,item_source,canteen_id)
select o.id,'meal','Meals',1,0,case when o.employee_id='11111111-0000-0000-0000-0000000000a1' and o.ordered_for='2026-09-10' then 'guest' else 'employee' end,o.canteen_id
from public.orders o where o.canteen_id='c1000000-0000-0000-0000-000000000000';
insert into public.expenses(expense_date,amount,description,canteen_id) values
 ('2026-08-31',77,'Aug (excluded)','c1000000-0000-0000-0000-000000000000'),
 ('2026-09-01',100,'Rice','c1000000-0000-0000-0000-000000000000'),
 ('2026-09-13',260,'Gas (holiday purchase)','c1000000-0000-0000-0000-000000000000'),
 ('2026-09-15',50.25,'Veg','c1000000-0000-0000-0000-000000000000'),
 ('2026-10-05',300,'Oct groceries','c1000000-0000-0000-0000-000000000000'),
 ('2026-09-01',999,'Other tenant','c2000000-0000-0000-0000-000000000000');

insert into public.employee_adjustments(employee_id,adjustment_date,amount,description,canteen_id) values('11111111-0000-0000-0000-0000000000a1','2026-09-05',20,'Extra','c1000000-0000-0000-0000-000000000000');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"33333333-0000-0000-0000-000000000001"}',false);
-- Standard canteen C3: priced order lines (existing standard flow)
insert into public.orders(id,employee_id,ordered_for,status,order_source,canteen_id) values
 ('d0000000-0000-0000-0000-000000000001','33333333-0000-0000-0000-0000000000d1','2026-09-03','active','admin','c3000000-0000-0000-0000-000000000000'),
 ('d0000000-0000-0000-0000-000000000002','33333333-0000-0000-0000-0000000000d1','2026-09-04','active','admin','c3000000-0000-0000-0000-000000000000'),
 ('d0000000-0000-0000-0000-000000000003','33333333-0000-0000-0000-0000000000d1','2026-09-05','cancelled','admin','c3000000-0000-0000-0000-000000000000');
insert into public.order_items(order_id,item_code,item_name,quantity,unit_price,item_source,canteen_id) values
 ('d0000000-0000-0000-0000-000000000001','meal','Meals',1,50,'employee','c3000000-0000-0000-0000-000000000000'),
 ('d0000000-0000-0000-0000-000000000002','meal','Meals',1,50,'employee','c3000000-0000-0000-0000-000000000000'),
 ('d0000000-0000-0000-0000-000000000002','curry','Curry',1,30,'employee','c3000000-0000-0000-0000-000000000000'),
 ('d0000000-0000-0000-0000-000000000003','meal','Meals',1,50,'employee','c3000000-0000-0000-0000-000000000000');

select set_config('request.jwt.claims','',false);
