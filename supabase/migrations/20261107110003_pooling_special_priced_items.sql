-- Pooling special priced menu items (owner t56u/t57u/t57s265) + per-canteen Guest orders On/Off (t58u/t59u).
-- Additive. Standard publish_employee_bill and Standard calculations are NOT modified.
--  * Admin opts in per weekly menu item ("Add price?", payments permission): public.pooling_special_items keyed by
--    (canteen, weekday, item_code) — the same key as weekly_menu, which is the menu the order screens use. It is a separate
--    table so the existing weekly-menu delete+insert save never drops or re-checks prices. Standard unit_price untouched.
--  * Optional server-side daily override on daily_menu (no UI): pooling_special NULL = inherit weekly, TRUE = special at
--    the daily price, FALSE = explicitly NOT special (never falls back to the weekly flag).
--  * order_items snapshot (server trigger, client values ignored): in a canteen that is in Pooling mode at
--    ORDER TIME, a flagged item records pooling_special=true and its price in paise. Quantity edits keep the
--    snapshot; changing the item/order re-validates. Historical rows default to false (never charged extra).
--  * Pooling bill = pool share (unchanged) + admin added + special items (member's own + guest items the member
--    ordered, via the existing order.employee_id / item_source='guest' association). Never deducted from Expenses.
--  * Guest orders On/Off per canteen (default ON = current behaviour) applies to ALL modes: when OFF the server
--    rejects new guest orders/items and guest quantity increases; cancellations, decreases and history are kept.

alter table public.daily_menu add column if not exists pooling_special boolean,
  add column if not exists pooling_special_price_paise integer check (pooling_special_price_paise is null or pooling_special_price_paise >= 0);
alter table public.daily_menu drop constraint if exists daily_menu_pooling_special_price_chk;
alter table public.daily_menu add constraint daily_menu_pooling_special_price_chk check (pooling_special is distinct from true or pooling_special_price_paise is not null);

create table if not exists public.pooling_special_items(
  canteen_id uuid not null references public.canteens(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  item_code text not null,
  price_paise integer not null check (price_paise >= 0),
  updated_by uuid, updated_at timestamptz not null default now(),
  primary key (canteen_id, weekday, item_code));
alter table public.pooling_special_items enable row level security;
drop policy if exists pooling_special_items_read on public.pooling_special_items;
create policy pooling_special_items_read on public.pooling_special_items for select to authenticated
  using (canteen_id = (select public.current_canteen_id()));
revoke all on table public.pooling_special_items from public, anon, authenticated;
grant select on table public.pooling_special_items to authenticated;
grant all on table public.pooling_special_items to service_role;

-- set (price) or clear (null) one item's special price for the caller's canteen; payments permission only
create or replace function public.set_pooling_special_item(p_weekday integer, p_item_code text, p_price_paise integer)
returns void language plpgsql security definer set search_path='' as $$
declare v_canteen uuid := public.current_canteen_id();
begin
  if auth.uid() is null or v_canteen is null then raise exception 'Authentication required'; end if;
  if not public.has_admin_permission('payments') then raise exception 'Payment administration permission required to set item prices'; end if;
  if p_weekday is null or p_weekday < 0 or p_weekday > 6 or coalesce(trim(p_item_code),'') = '' then raise exception 'Menu item is required'; end if;
  if p_price_paise is null then
    delete from public.pooling_special_items where canteen_id=v_canteen and weekday=p_weekday and item_code=p_item_code; return; end if;
  if p_price_paise < 0 then raise exception 'Price must be 0 or more'; end if;
  insert into public.pooling_special_items(canteen_id,weekday,item_code,price_paise,updated_by,updated_at)
  values(v_canteen,p_weekday,p_item_code,p_price_paise,auth.uid(),now())
  on conflict (canteen_id,weekday,item_code) do update set price_paise=excluded.price_paise, updated_by=excluded.updated_by, updated_at=now();
end $$;
revoke all on function public.set_pooling_special_item(integer,text,integer) from public, anon;
grant execute on function public.set_pooling_special_item(integer,text,integer) to authenticated;
alter table public.order_items add column if not exists pooling_special boolean not null default false,
  add column if not exists pooling_special_unit_paise integer check (pooling_special_unit_paise is null or pooling_special_unit_paise >= 0);
alter table public.pooling_bill_lines add column if not exists special_member_paise bigint not null default 0 check (special_member_paise >= 0),
  add column if not exists special_guest_paise bigint not null default 0 check (special_guest_paise >= 0);
alter table public.monthly_bills add column if not exists special_items_total numeric not null default 0;

-- ---------- per-canteen Guest orders setting ----------
create table if not exists public.canteen_guest_order_settings(
  canteen_id uuid primary key references public.canteens(id) on delete cascade,
  guest_orders_enabled boolean not null default true,
  updated_by uuid, updated_at timestamptz not null default now());
alter table public.canteen_guest_order_settings enable row level security;
drop policy if exists canteen_guest_order_settings_read on public.canteen_guest_order_settings;
create policy canteen_guest_order_settings_read on public.canteen_guest_order_settings for select to authenticated
  using (canteen_id = (select public.current_canteen_id()));
revoke all on table public.canteen_guest_order_settings from public, anon, authenticated;
grant select on table public.canteen_guest_order_settings to authenticated;
grant all on table public.canteen_guest_order_settings to service_role;

create or replace function public.set_guest_orders_enabled(p_enabled boolean)
returns public.canteen_guest_order_settings language plpgsql security definer set search_path='' as $$
declare v_canteen uuid := public.current_canteen_id(); v_row public.canteen_guest_order_settings%rowtype;
begin
  if auth.uid() is null or v_canteen is null then raise exception 'Authentication required'; end if;
  if not public.has_admin_permission('payments') then raise exception 'Payment administration permission required'; end if;
  if p_enabled is null then raise exception 'Guest orders setting is required'; end if;
  insert into public.canteen_guest_order_settings(canteen_id,guest_orders_enabled,updated_by,updated_at)
  values(v_canteen,p_enabled,auth.uid(),now())
  on conflict (canteen_id) do update set guest_orders_enabled=excluded.guest_orders_enabled, updated_by=excluded.updated_by, updated_at=now()
  returning * into v_row;
  return v_row;
end $$;
revoke all on function public.set_guest_orders_enabled(boolean) from public, anon;
grant execute on function public.set_guest_orders_enabled(boolean) to authenticated;

create or replace function gocanteen_private.guest_orders_enabled(p_canteen uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select coalesce((select guest_orders_enabled from public.canteen_guest_order_settings where canteen_id=p_canteen), true) $$;

create or replace function gocanteen_private.guard_guest_orders() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_canteen uuid;
begin
  if tg_table_name = 'orders' then
    if new.order_source = 'guest' and (tg_op = 'INSERT' or old.order_source is distinct from 'guest'
         or (new.status = 'active' and old.status is distinct from 'active'))
       and not gocanteen_private.guest_orders_enabled(new.canteen_id) then
      raise exception 'Guest orders are turned off for this canteen' using errcode='P0001'; end if;
    return new;
  end if;
  -- order_items
  if new.item_source = 'guest' then
    v_canteen := coalesce(new.canteen_id,(select o.canteen_id from public.orders o where o.id=new.order_id));
    if not gocanteen_private.guest_orders_enabled(v_canteen) then
      if tg_op = 'INSERT' or old.item_source is distinct from 'guest' or old.order_id is distinct from new.order_id
         or old.item_code is distinct from new.item_code or coalesce(new.quantity,0) > coalesce(old.quantity,0) then
        raise exception 'Guest orders are turned off for this canteen' using errcode='P0001'; end if;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists zz_guard_guest_orders on public.orders;
create trigger zz_guard_guest_orders before insert or update of order_source, status on public.orders
  for each row execute function gocanteen_private.guard_guest_orders();
drop trigger if exists zz_guard_guest_order_items on public.order_items;
create trigger zz_guard_guest_order_items before insert or update on public.order_items
  for each row execute function gocanteen_private.guard_guest_orders();

-- ---------- daily override: only payments admins may set/change it ----------
create or replace function gocanteen_private.guard_pooling_special_daily() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if (tg_op = 'INSERT' and (new.pooling_special is not null or new.pooling_special_price_paise is not null))
     or (tg_op = 'UPDATE' and (new.pooling_special is distinct from old.pooling_special
                               or new.pooling_special_price_paise is distinct from old.pooling_special_price_paise)) then
    if auth.uid() is not null and not public.has_admin_permission('payments') then
      raise exception 'Payment administration permission required to set item prices' using errcode='42501'; end if;
  end if;
  return new;
end $$;
drop trigger if exists zz_guard_pooling_special_daily on public.daily_menu;
create trigger zz_guard_pooling_special_daily before insert or update on public.daily_menu
  for each row execute function gocanteen_private.guard_pooling_special_daily();

-- effective special price (paise) for an item on a date in a canteen; NULL = not special
create or replace function gocanteen_private.effective_pooling_special(p_canteen uuid, p_date date, p_item_code text)
returns integer language plpgsql stable security definer set search_path='' as $$
declare v_flag boolean; v_price integer; v_found boolean := false;
begin
  select d.pooling_special, d.pooling_special_price_paise, true into v_flag, v_price, v_found from public.daily_menu d
   where d.canteen_id=p_canteen and d.menu_date=p_date and d.item_code=p_item_code and d.pooling_special is not null limit 1;
  if v_found then return case when v_flag then v_price end; end if;  -- explicit daily TRUE/FALSE wins; no fallback
  select s.price_paise into v_price from public.pooling_special_items s
   where s.canteen_id=p_canteen and s.weekday=extract(dow from p_date)::int and s.item_code=p_item_code
     and exists(select 1 from public.weekly_menu w where w.canteen_id=p_canteen and w.weekday=s.weekday and w.item_code=s.item_code and w.active);
  return v_price;
end $$;

-- ---------- special price snapshot on order_items ----------
create or replace function gocanteen_private.snapshot_pooling_special() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_order public.orders%rowtype; v_price integer;
begin
  -- only the nested re-price from resnapshot_order_items (an orders trigger) may write the snapshot directly
  if current_setting('gocanteen.pooling_resnapshot', true) = 'on' and pg_trigger_depth() > 1 then return new; end if;
  select * into v_order from public.orders where id = new.order_id;
  if found and new.canteen_id is not null and new.canteen_id is distinct from v_order.canteen_id then
    raise exception 'Order item canteen does not match its order'; end if;
  if tg_op = 'UPDATE' and new.order_id = old.order_id and new.item_code = old.item_code then
    new.pooling_special := old.pooling_special; new.pooling_special_unit_paise := old.pooling_special_unit_paise;  -- immutable snapshot
    return new;
  end if;
  new.pooling_special := false; new.pooling_special_unit_paise := null;
  if v_order.id is null then return new; end if;
  if coalesce((select billing_model from public.canteen_billing_settings where canteen_id=v_order.canteen_id),'standard') <> 'pooling' then
    return new; end if;
  v_price := gocanteen_private.effective_pooling_special(v_order.canteen_id, v_order.ordered_for, new.item_code);
  if v_price is not null then new.pooling_special := true; new.pooling_special_unit_paise := v_price; end if;
  return new;
end $$;
drop trigger if exists zz_snapshot_pooling_special on public.order_items;
create trigger zz_snapshot_pooling_special before insert or update on public.order_items
  for each row execute function gocanteen_private.snapshot_pooling_special();

-- moving an order to another date/canteen re-prices its items from the server (client still cannot choose the price)
create or replace function gocanteen_private.resnapshot_order_items() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_pool boolean;
begin
  if new.ordered_for is not distinct from old.ordered_for and new.canteen_id is not distinct from old.canteen_id then return new; end if;
  v_pool := coalesce((select billing_model from public.canteen_billing_settings where canteen_id=new.canteen_id),'standard') = 'pooling';
  perform set_config('gocanteen.pooling_resnapshot','on',true);
  update public.order_items oi set
    pooling_special = v_pool and gocanteen_private.effective_pooling_special(new.canteen_id,new.ordered_for,oi.item_code) is not null,
    pooling_special_unit_paise = case when v_pool then gocanteen_private.effective_pooling_special(new.canteen_id,new.ordered_for,oi.item_code) end
  where oi.order_id = new.id;
  perform set_config('gocanteen.pooling_resnapshot','',true);
  return new;
end $$;
drop trigger if exists zz_resnapshot_order_items on public.orders;
create trigger zz_resnapshot_order_items after update of ordered_for, canteen_id on public.orders
  for each row execute function gocanteen_private.resnapshot_order_items();

-- server-side special totals for a canteen month (active orders only; integer paise)
create or replace function gocanteen_private.pooling_special_totals(p_canteen uuid, p_year integer, p_month integer)
returns table(employee_id uuid, member_paise bigint, guest_paise bigint)
language sql stable security definer set search_path='' as $$
  select o.employee_id,
         coalesce(sum(case when oi.item_source <> 'guest' then oi.quantity::bigint * oi.pooling_special_unit_paise end),0)::bigint,
         coalesce(sum(case when oi.item_source = 'guest' then oi.quantity::bigint * oi.pooling_special_unit_paise end),0)::bigint
  from public.orders o join public.order_items oi on oi.order_id = o.id
  where o.canteen_id = p_canteen and o.status = 'active' and oi.pooling_special and oi.quantity > 0
    and o.ordered_for between make_date(p_year,p_month,1) and (make_date(p_year,p_month,1) + interval '1 month - 1 day')::date
  group by o.employee_id $$;

-- save: specials are verified against the server snapshot; total must equal share + admin added + specials
create or replace function gocanteen_private.save_pooling_run(p_canteen uuid, p_year integer, p_month integer, p_payload jsonb, p_actor uuid, p_via text)
returns public.pooling_bill_runs language plpgsql security definer set search_path='' as $$
declare v_run public.pooling_bill_runs%rowtype; v_start date := make_date(p_year,p_month,1);
  v_end date := (make_date(p_year,p_month,1) + interval '1 month - 1 day')::date; v_expense bigint; v_lines_sum bigint; v_bad integer;
begin
  perform pg_advisory_xact_lock(hashtext(format('gocanteen-pooling-run:%s:%s:%s',p_canteen,p_year,p_month)));
  if coalesce((select billing_model from public.canteen_billing_settings where canteen_id=p_canteen),'standard') <> 'pooling' then
    raise exception 'Pooling billing is not enabled for this canteen'; end if;
  if exists(select 1 from public.pooling_bill_runs where canteen_id=p_canteen and bill_year=p_year and bill_month=p_month and status='published') then
    raise exception 'Pooling bills for this month are already published (snapshot is locked)'; end if;
  select coalesce(sum(round(e.amount*100)),0)::bigint into v_expense from public.expenses e
    where e.canteen_id=p_canteen and e.expense_date between v_start and v_end and e.amount > 0;
  if v_expense <> (p_payload->>'expenseTotalPaise')::bigint then
    raise exception 'Expense total changed since preview (server % paise). Recalculate.', v_expense; end if;
  select coalesce(sum((l->>'sharePaise')::bigint),0) into v_lines_sum from jsonb_array_elements(p_payload->'lines') l;
  if v_lines_sum + (p_payload->>'unallocatedPaise')::bigint <> v_expense then raise exception 'Allocation does not add up to the expense total'; end if;
  select count(*) into v_bad from jsonb_array_elements(p_payload->'lines') l
    where not exists(select 1 from public.profiles p where p.id=(l->>'memberId')::uuid and p.role='employee' and p.canteen_id=p_canteen);
  if v_bad > 0 then raise exception 'Payload contains members outside this canteen'; end if;
  -- special items: every member with special charges must be present with exactly the server amounts
  select count(*) into v_bad from gocanteen_private.pooling_special_totals(p_canteen,p_year,p_month) s
    left join lateral (select l from jsonb_array_elements(p_payload->'lines') l where (l->>'memberId')::uuid = s.employee_id limit 1) x on true
    where x.l is null or coalesce((x.l->>'specialMemberPaise')::bigint,0) <> s.member_paise or coalesce((x.l->>'specialGuestPaise')::bigint,0) <> s.guest_paise;
  if v_bad > 0 then raise exception 'Special item charges changed since preview. Recalculate.'; end if;
  select count(*) into v_bad from jsonb_array_elements(p_payload->'lines') l
    where (coalesce((l->>'specialMemberPaise')::bigint,0) > 0 or coalesce((l->>'specialGuestPaise')::bigint,0) > 0)
      and not exists(select 1 from gocanteen_private.pooling_special_totals(p_canteen,p_year,p_month) s where s.employee_id=(l->>'memberId')::uuid);
  if v_bad > 0 then raise exception 'Special item charges changed since preview. Recalculate.'; end if;
  select count(*) into v_bad from jsonb_array_elements(p_payload->'lines') l
    where (l->>'totalPaise')::bigint <> (l->>'sharePaise')::bigint + coalesce((l->>'adminAddedPaise')::bigint,0)
          + coalesce((l->>'specialMemberPaise')::bigint,0) + coalesce((l->>'specialGuestPaise')::bigint,0);
  if v_bad > 0 then raise exception 'Line totals do not add up'; end if;
  delete from public.pooling_bill_runs where canteen_id=p_canteen and bill_year=p_year and bill_month=p_month and status='draft';
  insert into public.pooling_bill_runs(canteen_id,bill_year,bill_month,mess_cut_min_days,expense_total_paise,allocated_paise,unallocated_paise,calculation,computed_by,computed_via)
  values(p_canteen,p_year,p_month,(p_payload->>'messCutMinDays')::integer,v_expense,v_lines_sum,(p_payload->>'unallocatedPaise')::bigint,p_payload,p_actor,coalesce(p_via,'admin'))
  returning * into v_run;
  insert into public.pooling_bill_lines(run_id,canteen_id,employee_id,window_days,attended_days,absent_days,mess_cut_applied,chargeable_days,share_paise,admin_added_paise,special_member_paise,special_guest_paise,total_paise)
  select v_run.id,p_canteen,(l->>'memberId')::uuid,(l->>'windowDays')::int,(l->>'attendedDays')::int,(l->>'absentDays')::int,(l->>'messCutApplied')::boolean,
         (l->>'chargeableDays')::int,(l->>'sharePaise')::bigint,coalesce((l->>'adminAddedPaise')::bigint,0),
         coalesce((l->>'specialMemberPaise')::bigint,0),coalesce((l->>'specialGuestPaise')::bigint,0),(l->>'totalPaise')::bigint
  from jsonb_array_elements(p_payload->'lines') l;
  return v_run;
end $$;

create or replace function gocanteen_private.publish_pooling_line(p_run uuid, p_employee uuid)
returns public.monthly_bills language plpgsql security definer set search_path='' as $$
declare v_run public.pooling_bill_runs%rowtype; v_line public.pooling_bill_lines%rowtype; v_settings public.payment_settings%rowtype;
  v_bill public.monthly_bills%rowtype; v_now timestamptz := clock_timestamp(); v_id uuid := gen_random_uuid(); v_start date; v_end date;
begin
  select * into v_run from public.pooling_bill_runs where id=p_run; if not found then raise exception 'Run not found'; end if;
  -- same lock key as publish_employee_bill, taken BEFORE reading the line so concurrent callers serialize
  perform pg_advisory_xact_lock(hashtext(format('gocanteen-bill-publish:%s:%s:%s:%s',v_run.canteen_id,p_employee,v_run.bill_month,v_run.bill_year)));
  select * into v_line from public.pooling_bill_lines where run_id=p_run and employee_id=p_employee for update; if not found then raise exception 'Line not found'; end if;
  if v_line.monthly_bill_id is not null then select * into v_bill from public.monthly_bills where id=v_line.monthly_bill_id; return v_bill; end if;
  if exists(select 1 from public.monthly_bills where employee_id=p_employee and bill_month=v_run.bill_month and bill_year=v_run.bill_year) then
    raise exception 'A bill already exists for this member and month; not overwriting'; end if;
  if v_line.total_paise <= 0 then raise exception 'No payable amount available'; end if;
  v_start := make_date(v_run.bill_year,v_run.bill_month,1); v_end := (v_start + interval '1 month - 1 day')::date;
  select * into v_settings from public.payment_settings where canteen_id=v_run.canteen_id limit 1;
  perform set_config('gocanteen.pooling_publish','on',true);
  insert into public.monthly_bills(employee_id,bill_month,bill_year,billing_start_date,billing_end_date,days_ordered,food_total,guest_food_total,admin_added_total,special_items_total,total,published,published_at,updated_at,canteen_id,upi_name,upi_id,upi_number,gross_food_total,employee_food_total,company_food_total,employee_contribution_percentage,company_contribution_percentage)
  values(p_employee,v_run.bill_month,v_run.bill_year,v_start,v_end,v_line.chargeable_days,v_line.share_paise/100.0,0,v_line.admin_added_paise/100.0,(v_line.special_member_paise+v_line.special_guest_paise)/100.0,v_line.total_paise/100.0,true,v_now,v_now,v_run.canteen_id,
    nullif(trim(v_settings.upi_name),''),nullif(trim(v_settings.upi_id),''),nullif(trim(v_settings.upi_number),''),v_line.share_paise/100.0,v_line.share_paise/100.0,0,null,0)
  returning * into v_bill;
  insert into public.bill_payments(id,bill_id,employee_id,amount,status,created_at,updated_at,canteen_id,payment_reference,covered_through,covered_through_at,request_sequence,upi_name,upi_id,upi_number)
  values(v_id,v_bill.id,p_employee,v_line.total_paise/100.0,'unpaid',v_now,v_now,v_run.canteen_id,
    'GoCanteen-'||v_run.bill_year||'-'||lpad(v_run.bill_month::text,2,'0')||'-'||left(p_employee::text,8)||'-P1-'||left(v_id::text,8),v_end,v_now,1,v_bill.upi_name,v_bill.upi_id,v_bill.upi_number);
  perform set_config('gocanteen.pooling_publish','',true);
  update public.pooling_bill_lines set monthly_bill_id=v_bill.id where run_id=p_run and employee_id=p_employee;
  update public.pooling_bill_runs set status='published', published_at=coalesce(published_at,v_now) where id=p_run;
  return v_bill;
end $$;

revoke all on all functions in schema gocanteen_private from public, anon, authenticated;
grant execute on all functions in schema gocanteen_private to service_role;
revoke truncate, trigger, references on table public.canteen_guest_order_settings, public.pooling_special_items from public, anon, authenticated;
