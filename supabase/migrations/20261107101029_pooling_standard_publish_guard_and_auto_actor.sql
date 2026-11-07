-- Follow-up to 20261107100000 (requires it; additive, no data changes, no grant widening).
-- 1) Server-side guard: in a canteen whose billing_model is 'pooling', a Standard bill
--    (public.publish_employee_bill, or a direct owner insert) cannot create a monthly bill.
--    publish_employee_bill itself is NOT modified; its signature, grants and results for
--    Standard canteens are unchanged. Canteens without a settings row (= every canteen today)
--    are unaffected. Updates to existing bills (e.g. admin_delete_order_history_for_date) are
--    not touched: the trigger is BEFORE INSERT only (it also fires for INSERT .. ON CONFLICT).
-- 2) Automatic Standard sending picks an EXISTING active owner/master admin of the canteen who
--    actually passes has_admin_permission('payments'). No permissions are granted.

create or replace function gocanteen_private.guard_pooling_monthly_bill_insert()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.canteen_id is not null
     and exists(select 1 from public.canteen_billing_settings s where s.canteen_id=new.canteen_id and s.billing_model='pooling')
     and coalesce(current_setting('gocanteen.pooling_publish',true),'')<>'on' then
    raise exception 'This canteen uses Pooling billing; Standard bills cannot be published. Use Pooling monthly bills.'
      using errcode='P0001';
  end if;
  return new;
end $$;
revoke all on function gocanteen_private.guard_pooling_monthly_bill_insert() from public, anon, authenticated;

-- name sorts after set_canteen_id_trigger / snapshot_* so canteen_id is already resolved
drop trigger if exists zz_guard_pooling_standard_bill on public.monthly_bills;
create trigger zz_guard_pooling_standard_bill before insert on public.monthly_bills
  for each row execute function gocanteen_private.guard_pooling_monthly_bill_insert();

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
  insert into public.monthly_bills(employee_id,bill_month,bill_year,billing_start_date,billing_end_date,days_ordered,food_total,guest_food_total,admin_added_total,total,published,published_at,updated_at,canteen_id,upi_name,upi_id,upi_number,gross_food_total,employee_food_total,company_food_total,employee_contribution_percentage,company_contribution_percentage)
  values(p_employee,v_run.bill_month,v_run.bill_year,v_start,v_end,v_line.chargeable_days,v_line.share_paise/100.0,0,v_line.admin_added_paise/100.0,v_line.total_paise/100.0,true,v_now,v_now,v_run.canteen_id,
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

create or replace function gocanteen_private.system_publish_standard_bill(p_canteen uuid, p_employee uuid, p_month integer, p_year integer)
returns public.monthly_bills language plpgsql security definer set search_path='' as $$
declare v_actor uuid; v_cand record; v_days integer;
  v_prev_claims text := current_setting('request.jwt.claims',true);
  v_prev_sub text := current_setting('request.jwt.claim.sub',true);
begin
  if not exists(select 1 from public.profiles where id=p_employee and canteen_id=p_canteen and role='employee') then raise exception 'Member not in canteen'; end if;
  -- Try existing active owner / master admins (owner first); keep the first one that the
  -- canteen's own rules authorize for payments in THIS canteen. Nothing is granted.
  for v_cand in select id from public.profiles where canteen_id=p_canteen and role='admin' and status='active' and admin_role in ('owner','master_admin')
      order by case admin_role when 'owner' then 0 else 1 end, created_at, id loop
    perform set_config('request.jwt.claims', json_build_object('sub',v_cand.id,'role','authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', v_cand.id::text, true);
    if public.current_canteen_id() is not distinct from p_canteen and public.has_admin_permission('payments') then v_actor := v_cand.id; exit; end if;
  end loop;
  if v_actor is null then
    perform set_config('request.jwt.claims', coalesce(v_prev_claims,''), true);
    perform set_config('request.jwt.claim.sub', coalesce(v_prev_sub,''), true);
    raise exception 'No active owner/master admin with payments permission for canteen';
  end if;
  select count(distinct o.ordered_for) into v_days from public.orders o where o.employee_id=p_employee and o.canteen_id=p_canteen and o.status='active'
    and o.ordered_for between make_date(p_year,p_month,1) and (make_date(p_year,p_month,1) + interval '1 month - 1 day')::date;
  return public.publish_employee_bill(p_employee,p_month,p_year,0,0,0,v_days,null,null);
end $$;
revoke all on function gocanteen_private.system_publish_standard_bill(uuid,uuid,integer,integer) from public, anon, authenticated;

-- 3) Connector-manageable runtime gate for the auto-send Edge Function (no function env secrets needed).
--    * Cron secret lives ONLY in Supabase Vault (name 'auto_bill_cron_secret'); it can be generated inside the
--      database so it is never displayed. The function asks the DB to compare the presented header.
--    * Global live switch is a private singleton row, default FALSE (dry run). Per-canteen Manual stays the default.
create table if not exists gocanteen_private.auto_bill_runtime(
  id boolean primary key default true check (id), live boolean not null default false, updated_at timestamptz not null default now());
insert into gocanteen_private.auto_bill_runtime(id,live) values(true,false) on conflict (id) do nothing;
alter table gocanteen_private.auto_bill_runtime enable row level security;
revoke all on table gocanteen_private.auto_bill_runtime from public, anon, authenticated;

create or replace function public.auto_bill_authorize(p_secret text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_expected text; v_live boolean;
begin
  begin
    select decrypted_secret into v_expected from vault.decrypted_secrets where name='auto_bill_cron_secret' limit 1;
  exception when others then v_expected := null;
  end;
  select live into v_live from gocanteen_private.auto_bill_runtime where id;
  if v_expected is null or length(v_expected) < 32 or p_secret is null or p_secret <> v_expected then
    return jsonb_build_object('ok',false,'live',false);
  end if;
  return jsonb_build_object('ok',true,'live',coalesce(v_live,false));
end $$;
revoke all on function public.auto_bill_authorize(text) from public, anon, authenticated;
grant execute on function public.auto_bill_authorize(text) to service_role;
