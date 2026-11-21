-- Pooling special Shared cost (owner pt132u): a weekly special can be Fixed price (default,
-- existing behaviour) or Shared cost. Shared cost has no upfront price; after buying, the admin
-- enters that day's total, which is split equally among the distinct members who ordered it
-- (quantity ignored; a member and their guests are one share). Cancelled/empty orders excluded.
-- Not mess-cut, not Common bill, not the food pool. Pending totals block publish of affected lines.

-- ---------- weekly + daily + order snapshot ----------
alter table public.pooling_special_items
  add column if not exists pricing_mode text not null default 'fixed';

alter table public.pooling_special_items
  drop constraint if exists pooling_special_items_pricing_mode_check;
alter table public.pooling_special_items
  add constraint pooling_special_items_pricing_mode_check
  check (pricing_mode in ('fixed', 'shared'));

alter table public.pooling_special_items alter column price_paise drop not null;

alter table public.pooling_special_items
  drop constraint if exists pooling_special_items_price_mode_chk;
alter table public.pooling_special_items
  add constraint pooling_special_items_price_mode_chk
  check (
    (pricing_mode = 'fixed' and price_paise is not null and price_paise >= 0)
    or (pricing_mode = 'shared' and price_paise is null)
  );

alter table public.daily_menu
  add column if not exists pooling_special_pricing_mode text not null default 'fixed';
alter table public.daily_menu
  drop constraint if exists daily_menu_pooling_special_pricing_mode_check;
alter table public.daily_menu
  add constraint daily_menu_pooling_special_pricing_mode_check
  check (pooling_special_pricing_mode in ('fixed', 'shared'));

-- Shared daily specials may have a null price; fixed still require a price.
alter table public.daily_menu drop constraint if exists daily_menu_pooling_special_price_chk;
alter table public.daily_menu add constraint daily_menu_pooling_special_price_chk check (
  pooling_special is distinct from true
  or pooling_special_pricing_mode = 'shared'
  or pooling_special_price_paise is not null
);

alter table public.order_items
  add column if not exists pooling_special_pricing_mode text not null default 'fixed';
alter table public.order_items
  drop constraint if exists order_items_pooling_special_pricing_mode_check;
alter table public.order_items
  add constraint order_items_pooling_special_pricing_mode_check
  check (pooling_special_pricing_mode in ('fixed', 'shared'));

-- ---------- per-day totals entered after buying ----------
create table if not exists public.pooling_special_shared_costs(
  canteen_id uuid not null references public.canteens(id) on delete cascade,
  special_date date not null,
  item_code text not null,
  total_paise bigint not null check (total_paise >= 0),
  updated_by uuid, updated_at timestamptz not null default now(),
  primary key (canteen_id, special_date, item_code));
alter table public.pooling_special_shared_costs enable row level security;
drop policy if exists pooling_special_shared_costs_read on public.pooling_special_shared_costs;
create policy pooling_special_shared_costs_read on public.pooling_special_shared_costs for select to authenticated
  using (canteen_id = (select public.current_canteen_id()));
revoke all on table public.pooling_special_shared_costs from public, anon, authenticated;
grant select on table public.pooling_special_shared_costs to authenticated;
grant all on table public.pooling_special_shared_costs to service_role;

create or replace function public.set_pooling_special_shared_cost(p_date date, p_item_code text, p_total_paise integer)
returns void language plpgsql security definer set search_path='' as $$
declare v_canteen uuid := public.current_canteen_id();
begin
  if auth.uid() is null or v_canteen is null then raise exception 'Authentication required'; end if;
  if not public.has_admin_permission('payments') then raise exception 'Payment administration permission required to set shared costs'; end if;
  if coalesce((select billing_model from public.canteen_billing_settings where canteen_id=v_canteen),'standard') <> 'pooling' then
    raise exception 'Shared cost is only available in Pooling mode'; end if;
  if p_date is null or coalesce(trim(p_item_code),'') = '' then raise exception 'Special and date are required'; end if;
  if p_total_paise is null then
    delete from public.pooling_special_shared_costs where canteen_id=v_canteen and special_date=p_date and item_code=p_item_code;
    return;
  end if;
  if p_total_paise < 0 then raise exception 'Total must be 0 or more'; end if;
  insert into public.pooling_special_shared_costs(canteen_id,special_date,item_code,total_paise,updated_by,updated_at)
  values(v_canteen,p_date,p_item_code,p_total_paise,auth.uid(),now())
  on conflict (canteen_id,special_date,item_code) do update
    set total_paise=excluded.total_paise, updated_by=excluded.updated_by, updated_at=now();
end $$;
revoke all on function public.set_pooling_special_shared_cost(date,text,integer) from public, anon;
grant execute on function public.set_pooling_special_shared_cost(date,text,integer) to authenticated;

-- ---------- set_pooling_special_item: keep 3-arg wrapper; add 4-arg mode ----------
create or replace function public.set_pooling_special_item(p_weekday integer, p_item_code text, p_price_paise integer, p_pricing_mode text)
returns void language plpgsql security definer set search_path='' as $$
declare v_canteen uuid := public.current_canteen_id();
  v_mode text := coalesce(nullif(trim(p_pricing_mode),''), 'fixed');
begin
  if auth.uid() is null or v_canteen is null then raise exception 'Authentication required'; end if;
  if not public.has_admin_permission('payments') then raise exception 'Payment administration permission required to set item prices'; end if;
  if p_weekday is null or p_weekday < 0 or p_weekday > 6 or coalesce(trim(p_item_code),'') = '' then raise exception 'Menu item is required'; end if;
  if v_mode not in ('fixed', 'shared') then raise exception 'Pricing mode must be Fixed price or Shared cost'; end if;
  if v_mode = 'shared' then
    insert into public.pooling_special_items(canteen_id,weekday,item_code,price_paise,pricing_mode,updated_by,updated_at)
    values(v_canteen,p_weekday,p_item_code,null,'shared',auth.uid(),now())
    on conflict (canteen_id,weekday,item_code) do update
      set price_paise=null, pricing_mode='shared', updated_by=excluded.updated_by, updated_at=now();
    return;
  end if;
  if p_price_paise is null then
    delete from public.pooling_special_items where canteen_id=v_canteen and weekday=p_weekday and item_code=p_item_code; return; end if;
  if p_price_paise < 0 then raise exception 'Price must be 0 or more'; end if;
  insert into public.pooling_special_items(canteen_id,weekday,item_code,price_paise,pricing_mode,updated_by,updated_at)
  values(v_canteen,p_weekday,p_item_code,p_price_paise,'fixed',auth.uid(),now())
  on conflict (canteen_id,weekday,item_code) do update
    set price_paise=excluded.price_paise, pricing_mode='fixed', updated_by=excluded.updated_by, updated_at=now();
end $$;
revoke all on function public.set_pooling_special_item(integer,text,integer,text) from public, anon;
grant execute on function public.set_pooling_special_item(integer,text,integer,text) to authenticated;

create or replace function public.set_pooling_special_item(p_weekday integer, p_item_code text, p_price_paise integer)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform public.set_pooling_special_item(p_weekday, p_item_code, p_price_paise, 'fixed');
end $$;
revoke all on function public.set_pooling_special_item(integer,text,integer) from public, anon;
grant execute on function public.set_pooling_special_item(integer,text,integer) to authenticated;

-- ---------- effective special + snapshot ----------
create or replace function gocanteen_private.effective_pooling_special_info(p_canteen uuid, p_date date, p_item_code text, out pricing_mode text, out price_paise integer)
language plpgsql stable security definer set search_path='' as $$
declare v_flag boolean; v_price integer; v_mode text; v_found boolean := false;
begin
  pricing_mode := null; price_paise := null;
  select d.pooling_special, d.pooling_special_price_paise, d.pooling_special_pricing_mode, true
    into v_flag, v_price, v_mode, v_found
    from public.daily_menu d
   where d.canteen_id=p_canteen and d.menu_date=p_date and d.item_code=p_item_code and d.pooling_special is not null limit 1;
  if v_found then
    if v_flag then
      pricing_mode := case when v_mode = 'shared' then 'shared' else 'fixed' end;
      price_paise := case when pricing_mode = 'shared' then null else v_price end;
    end if;
    return;
  end if;
  select s.pricing_mode, s.price_paise into v_mode, v_price from public.pooling_special_items s
   where s.canteen_id=p_canteen and s.weekday=extract(dow from p_date)::int and s.item_code=p_item_code
     and exists(select 1 from public.weekly_menu w where w.canteen_id=p_canteen and w.weekday=s.weekday and w.item_code=s.item_code and w.active);
  if found then
    pricing_mode := case when v_mode = 'shared' then 'shared' else 'fixed' end;
    price_paise := case when pricing_mode = 'shared' then null else v_price end;
  end if;
end $$;

-- Keep the integer helper as "fixed price or null" for any leftover callers.
create or replace function gocanteen_private.effective_pooling_special(p_canteen uuid, p_date date, p_item_code text)
returns integer language sql stable security definer set search_path='' as $$
  select case when i.pricing_mode = 'fixed' then i.price_paise end
  from gocanteen_private.effective_pooling_special_info(p_canteen, p_date, p_item_code) i $$;

create or replace function gocanteen_private.snapshot_pooling_special() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_order public.orders%rowtype; v_mode text; v_price integer;
begin
  if current_setting('gocanteen.pooling_resnapshot', true) = 'on' and pg_trigger_depth() > 1 then return new; end if;
  select * into v_order from public.orders where id = new.order_id;
  if found and new.canteen_id is not null and new.canteen_id is distinct from v_order.canteen_id then
    raise exception 'Order item canteen does not match its order'; end if;
  if tg_op = 'UPDATE' and new.order_id = old.order_id and new.item_code = old.item_code then
    new.pooling_special := old.pooling_special;
    new.pooling_special_unit_paise := old.pooling_special_unit_paise;
    new.pooling_special_pricing_mode := old.pooling_special_pricing_mode;
    return new;
  end if;
  new.pooling_special := false; new.pooling_special_unit_paise := null; new.pooling_special_pricing_mode := 'fixed';
  if v_order.id is null then return new; end if;
  if coalesce((select billing_model from public.canteen_billing_settings where canteen_id=v_order.canteen_id),'standard') <> 'pooling' then
    return new; end if;
  select i.pricing_mode, i.price_paise into v_mode, v_price
    from gocanteen_private.effective_pooling_special_info(v_order.canteen_id, v_order.ordered_for, new.item_code) i;
  if v_mode is not null then
    new.pooling_special := true;
    new.pooling_special_pricing_mode := v_mode;
    new.pooling_special_unit_paise := v_price;
  end if;
  return new;
end $$;
drop trigger if exists zz_snapshot_pooling_special on public.order_items;
create trigger zz_snapshot_pooling_special before insert or update on public.order_items
  for each row execute function gocanteen_private.snapshot_pooling_special();

create or replace function gocanteen_private.resnapshot_order_items() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_pool boolean;
begin
  if new.ordered_for is not distinct from old.ordered_for and new.canteen_id is not distinct from old.canteen_id then return new; end if;
  v_pool := coalesce((select billing_model from public.canteen_billing_settings where canteen_id=new.canteen_id),'standard') = 'pooling';
  perform set_config('gocanteen.pooling_resnapshot','on',true);
  update public.order_items oi set
    pooling_special = v_pool and i.pricing_mode is not null,
    pooling_special_pricing_mode = case when v_pool and i.pricing_mode is not null then i.pricing_mode else 'fixed' end,
    pooling_special_unit_paise = case when v_pool then i.price_paise end
  from gocanteen_private.effective_pooling_special_info(new.canteen_id,new.ordered_for,oi.item_code) i
  where oi.order_id = new.id;
  perform set_config('gocanteen.pooling_resnapshot','',true);
  return new;
end $$;
drop trigger if exists zz_resnapshot_order_items on public.orders;
create trigger zz_resnapshot_order_items after update of ordered_for, canteen_id on public.orders
  for each row execute function gocanteen_private.resnapshot_order_items();

-- Fixed-price totals only (shared cost is allocated separately).
create or replace function gocanteen_private.pooling_special_totals(p_canteen uuid, p_year integer, p_month integer)
returns table(employee_id uuid, member_paise bigint, guest_paise bigint)
language sql stable security definer set search_path='' as $$
  select o.employee_id,
         coalesce(sum(case when oi.item_source <> 'guest' then oi.quantity::bigint * oi.pooling_special_unit_paise end),0)::bigint,
         coalesce(sum(case when oi.item_source = 'guest' then oi.quantity::bigint * oi.pooling_special_unit_paise end),0)::bigint
  from public.orders o join public.order_items oi on oi.order_id = o.id
  where o.canteen_id = p_canteen and o.status = 'active' and oi.pooling_special and oi.quantity > 0
    and oi.pooling_special_unit_paise is not null
    and coalesce(oi.pooling_special_pricing_mode, 'fixed') = 'fixed'
    and o.ordered_for between make_date(p_year,p_month,1) and (make_date(p_year,p_month,1) + interval '1 month - 1 day')::date
  group by o.employee_id $$;

-- Equal-share allocations for Shared cost specials (largest-remainder, member id ascending).
create or replace function gocanteen_private.pooling_shared_special_shares(p_canteen uuid, p_year integer, p_month integer, p_members uuid[])
returns table(employee_id uuid, special_date date, item_code text, share_paise bigint, pending boolean)
language sql stable security definer set search_path='' as $$
  with participants as (
    select o.employee_id, o.ordered_for as special_date, oi.item_code
    from public.orders o
    join public.order_items oi on oi.order_id = o.id
    where o.canteen_id = p_canteen and o.status = 'active' and oi.pooling_special and oi.quantity > 0
      and coalesce(oi.pooling_special_pricing_mode, 'fixed') = 'shared'
      and o.employee_id = any(p_members)
      and o.ordered_for between make_date(p_year,p_month,1) and (make_date(p_year,p_month,1) + interval '1 month - 1 day')::date
    group by o.employee_id, o.ordered_for, oi.item_code
  ),
  groups as (
    select p.special_date, p.item_code, count(*)::int as n,
           array_agg(p.employee_id order by p.employee_id) as members
    from participants p
    group by p.special_date, p.item_code
  ),
  priced as (
    select g.special_date, g.item_code, g.n, g.members, c.total_paise,
           (c.total_paise is null) as pending
    from groups g
    left join public.pooling_special_shared_costs c
      on c.canteen_id = p_canteen and c.special_date = g.special_date and c.item_code = g.item_code
  )
  select m.employee_id, p.special_date, p.item_code,
         case when p.pending then 0
              else (p.total_paise / p.n) + case when m.ord <= (p.total_paise % p.n) then 1 else 0 end
         end::bigint as share_paise,
         p.pending
  from priced p
  cross join lateral unnest(p.members) with ordinality as m(employee_id, ord)
$$;

alter table public.pooling_bill_lines
  add column if not exists shared_special_paise bigint not null default 0,
  add column if not exists special_pending boolean not null default false,
  add column if not exists special_lines jsonb not null default '[]'::jsonb;

alter table public.monthly_bills
  add column if not exists special_lines jsonb not null default '[]'::jsonb;

create or replace function gocanteen_private.save_pooling_run(p_canteen uuid, p_year integer, p_month integer, p_payload jsonb, p_actor uuid, p_via text)
returns public.pooling_bill_runs language plpgsql security definer set search_path='' as $$
declare v_run public.pooling_bill_runs%rowtype; v_start date := make_date(p_year,p_month,1);
  v_end date := (make_date(p_year,p_month,1) + interval '1 month - 1 day')::date;
  v_expense bigint; v_common bigint; v_lines_sum bigint; v_common_sum bigint; v_bad integer;
  v_mode text := coalesce(nullif(p_payload->>'messCutMode',''), 'any');
  v_setting_mode text;
  v_common_payload bigint := coalesce((p_payload->>'allMembersExpensePaise')::bigint, 0);
  v_common_unalloc bigint := coalesce((p_payload->>'allMembersUnallocatedPaise')::bigint, 0);
begin
  perform pg_advisory_xact_lock(hashtext(format('gocanteen-pooling-run:%s:%s:%s',p_canteen,p_year,p_month)));
  if coalesce((select billing_model from public.canteen_billing_settings where canteen_id=p_canteen),'standard') <> 'pooling' then
    raise exception 'Pooling billing is not enabled for this canteen'; end if;
  if exists(select 1 from public.pooling_bill_runs where canteen_id=p_canteen and bill_year=p_year and bill_month=p_month and status='published') then
    raise exception 'Pooling bills for this month are already published (snapshot is locked)'; end if;
  if coalesce((p_payload->>'engineVersion')::int,0) < 2 then raise exception 'This app version uses an old pooling calculation. Update the app and recalculate.'; end if;
  if (p_payload->>'messCutMinDays')::int is distinct from (select mess_cut_min_days from public.canteen_billing_settings where canteen_id=p_canteen) then
    raise exception 'Mess cut setting changed since preview. Recalculate.'; end if;
  select coalesce(mess_cut_mode, 'any') into v_setting_mode from public.canteen_billing_settings where canteen_id=p_canteen;
  if v_mode is distinct from coalesce(v_setting_mode, 'any') then
    raise exception 'Mess cut setting changed since preview. Recalculate.'; end if;
  if v_mode not in ('any', 'consecutive') then raise exception 'Mess cut mode must be any or consecutive'; end if;
  select coalesce(sum(round(e.amount*100)),0)::bigint into v_expense from public.expenses e
    where e.canteen_id=p_canteen and e.expense_date between v_start and v_end and e.amount > 0
      and coalesce(e.split_mode, 'eaters') = 'eaters';
  select coalesce(sum(round(e.amount*100)),0)::bigint into v_common from public.expenses e
    where e.canteen_id=p_canteen and e.expense_date between v_start and v_end and e.amount > 0
      and e.split_mode = 'all_members';
  if v_expense <> (p_payload->>'expenseTotalPaise')::bigint then
    raise exception 'Expense total changed since preview (server % paise). Recalculate.', v_expense; end if;
  if v_common <> v_common_payload then
    raise exception 'Common bill total changed since preview (server % paise). Recalculate.', v_common; end if;
  select coalesce(sum((l->>'sharePaise')::bigint),0) into v_lines_sum from jsonb_array_elements(p_payload->'lines') l;
  if v_lines_sum + (p_payload->>'unallocatedPaise')::bigint <> v_expense then raise exception 'Allocation does not add up to the expense total'; end if;
  select coalesce(sum(coalesce((l->>'allMembersSharePaise')::bigint,0)),0) into v_common_sum from jsonb_array_elements(p_payload->'lines') l;
  if v_common_sum + v_common_unalloc <> v_common then raise exception 'Common bill allocation does not add up to the Common bill total'; end if;
  select count(*) into v_bad from jsonb_array_elements(p_payload->'lines') l
    where not exists(select 1 from public.profiles p where p.id=(l->>'memberId')::uuid and p.role='employee' and p.canteen_id=p_canteen);
  if v_bad > 0 then raise exception 'Payload contains members outside this canteen'; end if;
  select count(*) into v_bad from gocanteen_private.pooling_special_totals(p_canteen,p_year,p_month) s
    left join lateral (select l from jsonb_array_elements(p_payload->'lines') l where (l->>'memberId')::uuid = s.employee_id limit 1) x on true
    where x.l is null or coalesce((x.l->>'specialMemberPaise')::bigint,0) <> s.member_paise or coalesce((x.l->>'specialGuestPaise')::bigint,0) <> s.guest_paise;
  if v_bad > 0 then raise exception 'Special item charges changed since preview. Recalculate.'; end if;
  select count(*) into v_bad from jsonb_array_elements(p_payload->'lines') l
    where (coalesce((l->>'specialMemberPaise')::bigint,0) > 0 or coalesce((l->>'specialGuestPaise')::bigint,0) > 0)
      and not exists(select 1 from gocanteen_private.pooling_special_totals(p_canteen,p_year,p_month) s where s.employee_id=(l->>'memberId')::uuid);
  if v_bad > 0 then raise exception 'Special item charges changed since preview. Recalculate.'; end if;
  -- Shared cost: payload shares and pending flags must match the server allocation among payload members.
  select count(*) into v_bad from jsonb_array_elements(p_payload->'lines') l
    left join lateral (
      select coalesce(sum(s.share_paise) filter (where not s.pending), 0) as share,
             coalesce(bool_or(s.pending), false) as pending
      from gocanteen_private.pooling_shared_special_shares(
             p_canteen,p_year,p_month,
             array(select (x.l->>'memberId')::uuid from jsonb_array_elements(p_payload->'lines') x(l))
           ) s
      where s.employee_id = (l->>'memberId')::uuid
    ) x on true
    where coalesce((l->>'sharedSpecialPaise')::bigint,0) <> coalesce(x.share,0)
       or coalesce((l->>'specialPending')::boolean,false) is distinct from coalesce(x.pending,false);
  if v_bad > 0 then raise exception 'Shared cost specials changed since preview. Recalculate.'; end if;
  select count(*) into v_bad from jsonb_array_elements(p_payload->'lines') l
    where (l->>'totalPaise')::bigint <> greatest((l->>'sharePaise')::bigint + coalesce((l->>'adminAddedPaise')::bigint,0)
          + coalesce((l->>'specialMemberPaise')::bigint,0) + coalesce((l->>'specialGuestPaise')::bigint,0)
          + coalesce((l->>'allMembersSharePaise')::bigint,0) + coalesce((l->>'sharedSpecialPaise')::bigint,0), 0);
  if v_bad > 0 then raise exception 'Line totals do not add up'; end if;
  delete from public.pooling_bill_runs where canteen_id=p_canteen and bill_year=p_year and bill_month=p_month and status='draft';
  insert into public.pooling_bill_runs(canteen_id,bill_year,bill_month,mess_cut_min_days,mess_cut_mode,expense_total_paise,allocated_paise,unallocated_paise,all_members_expense_paise,all_members_unallocated_paise,calculation,computed_by,computed_via)
  values(p_canteen,p_year,p_month,(p_payload->>'messCutMinDays')::integer,v_mode,v_expense,v_lines_sum,(p_payload->>'unallocatedPaise')::bigint,v_common,v_common_unalloc,p_payload,p_actor,coalesce(p_via,'admin'))
  returning * into v_run;
  insert into public.pooling_bill_lines(run_id,canteen_id,employee_id,window_days,attended_days,absent_days,mess_cut_applied,chargeable_days,share_paise,admin_added_paise,special_member_paise,special_guest_paise,all_members_share_paise,shared_special_paise,special_pending,special_lines,total_paise)
  select v_run.id,p_canteen,(l->>'memberId')::uuid,(l->>'windowDays')::int,(l->>'attendedDays')::int,(l->>'absentDays')::int,(l->>'messCutApplied')::boolean,
         (l->>'chargeableDays')::int,(l->>'sharePaise')::bigint,coalesce((l->>'adminAddedPaise')::bigint,0),
         coalesce((l->>'specialMemberPaise')::bigint,0),coalesce((l->>'specialGuestPaise')::bigint,0),
         coalesce((l->>'allMembersSharePaise')::bigint,0),
         coalesce((l->>'sharedSpecialPaise')::bigint,0),
         coalesce((l->>'specialPending')::boolean,false),
         coalesce(l->'specialLines','[]'::jsonb),
         (l->>'totalPaise')::bigint
  from jsonb_array_elements(p_payload->'lines') l;
  return v_run;
end $$;
revoke all on function gocanteen_private.save_pooling_run(uuid,integer,integer,jsonb,uuid,text) from public, anon, authenticated;
grant execute on function gocanteen_private.save_pooling_run(uuid,integer,integer,jsonb,uuid,text) to service_role;

create or replace function gocanteen_private.publish_pooling_line(p_run uuid, p_employee uuid)
returns public.monthly_bills language plpgsql security definer set search_path='' as $$
declare v_run public.pooling_bill_runs%rowtype; v_line public.pooling_bill_lines%rowtype; v_settings public.payment_settings%rowtype;
  v_bill public.monthly_bills%rowtype; v_now timestamptz := clock_timestamp(); v_id uuid := gen_random_uuid(); v_start date; v_end date;
  v_share bigint; v_pending boolean;
begin
  select * into v_run from public.pooling_bill_runs where id=p_run; if not found then raise exception 'Run not found'; end if;
  if v_run.status <> 'published' and coalesce((v_run.calculation->>'engineVersion')::int,0) < 2 then
    raise exception 'This saved calculation uses the old pooling method. Recalculate and save again.'; end if;
  perform pg_advisory_xact_lock(hashtext(format('gocanteen-bill-publish:%s:%s:%s:%s',v_run.canteen_id,p_employee,v_run.bill_month,v_run.bill_year)));
  select * into v_line from public.pooling_bill_lines where run_id=p_run and employee_id=p_employee for update; if not found then raise exception 'Line not found'; end if;
  if v_line.monthly_bill_id is not null then select * into v_bill from public.monthly_bills where id=v_line.monthly_bill_id; return v_bill; end if;
  if exists(select 1 from public.monthly_bills where employee_id=p_employee and bill_month=v_run.bill_month and bill_year=v_run.bill_year) then
    raise exception 'A bill already exists for this member and month; not overwriting'; end if;
  if v_line.special_pending then
    raise exception 'Shared cost amount pending. Enter the total before publishing this bill.'; end if;
  select coalesce(sum(s.share_paise) filter (where not s.pending), 0), coalesce(bool_or(s.pending), false)
    into v_share, v_pending
    from gocanteen_private.pooling_shared_special_shares(
           v_run.canteen_id, v_run.bill_year, v_run.bill_month,
           array(select employee_id from public.pooling_bill_lines where run_id=p_run)
         ) s
    where s.employee_id = p_employee;
  if v_pending then
    raise exception 'Shared cost amount pending. Enter the total before publishing this bill.'; end if;
  if coalesce(v_line.shared_special_paise,0) is distinct from coalesce(v_share,0) then
    raise exception 'Shared cost specials changed since this calculation was saved. Recalculate.'; end if;
  if v_line.total_paise <= 0 then raise exception 'No payable amount available'; end if;
  v_start := make_date(v_run.bill_year,v_run.bill_month,1); v_end := (v_start + interval '1 month - 1 day')::date;
  select * into v_settings from public.payment_settings where canteen_id=v_run.canteen_id limit 1;
  perform set_config('gocanteen.pooling_publish','on',true);
  insert into public.monthly_bills(employee_id,bill_month,bill_year,billing_start_date,billing_end_date,days_ordered,food_total,guest_food_total,admin_added_total,special_items_total,common_bill_total,special_lines,total,published,published_at,updated_at,canteen_id,upi_name,upi_id,upi_number,gross_food_total,employee_food_total,company_food_total,employee_contribution_percentage,company_contribution_percentage)
  values(p_employee,v_run.bill_month,v_run.bill_year,v_start,v_end,v_line.chargeable_days,v_line.share_paise/100.0,0,v_line.admin_added_paise/100.0,(v_line.special_member_paise+v_line.special_guest_paise)/100.0,coalesce(v_line.all_members_share_paise,0)/100.0,coalesce(v_line.special_lines,'[]'::jsonb),v_line.total_paise/100.0,true,v_now,v_now,v_run.canteen_id,
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
revoke all on function gocanteen_private.publish_pooling_line(uuid,uuid) from public, anon, authenticated;
grant execute on function gocanteen_private.publish_pooling_line(uuid,uuid) to service_role;

notify pgrst, 'reload schema';
