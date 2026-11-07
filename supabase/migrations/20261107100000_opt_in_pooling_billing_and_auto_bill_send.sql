-- Go Canteen: OPT-IN Pooling billing model + Manual/Automatic monthly bill sending.
-- STATUS: COMMITTED BUT NOT APPLIED. Review before applying to any database.
-- Backward compatibility: a canteen with NO row in canteen_billing_settings behaves
-- exactly as before (billing_model=standard, bill_send_mode=manual). Nothing in this
-- migration changes existing tables, functions, prices, orders or bills.

create table if not exists public.canteen_billing_settings(
  canteen_id uuid primary key references public.canteens(id) on delete cascade,
  billing_model text not null default 'standard' check (billing_model in ('standard','pooling')),
  mess_cut_min_days integer not null default 6 check (mess_cut_min_days between 1 and 31),
  bill_send_mode text not null default 'manual' check (bill_send_mode in ('manual','automatic')),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
alter table public.canteen_billing_settings enable row level security;
drop policy if exists canteen_billing_settings_select on public.canteen_billing_settings;
create policy canteen_billing_settings_select on public.canteen_billing_settings for select to authenticated
  using (canteen_id = public.current_canteen_id());
-- Writes only through set_canteen_billing_settings() (permission checked there).
revoke insert, update, delete on public.canteen_billing_settings from anon, authenticated;

create or replace function public.set_canteen_billing_settings(p_billing_model text, p_mess_cut_min_days integer, p_bill_send_mode text)
returns public.canteen_billing_settings language plpgsql security definer set search_path='' as $$
declare v_canteen uuid := public.current_canteen_id(); v_row public.canteen_billing_settings%rowtype;
begin
  if auth.uid() is null or v_canteen is null then raise exception 'Authentication required'; end if;
  if not public.has_admin_permission('payments') then raise exception 'Payment administration permission required'; end if;
  insert into public.canteen_billing_settings(canteen_id,billing_model,mess_cut_min_days,bill_send_mode,updated_at,updated_by)
  values (v_canteen, coalesce(p_billing_model,'standard'), coalesce(p_mess_cut_min_days,6), coalesce(p_bill_send_mode,'manual'), now(), auth.uid())
  on conflict (canteen_id) do update set billing_model=excluded.billing_model, mess_cut_min_days=excluded.mess_cut_min_days,
    bill_send_mode=excluded.bill_send_mode, updated_at=excluded.updated_at, updated_by=excluded.updated_by
  returning * into v_row;
  return v_row;
end $$;
revoke all on function public.set_canteen_billing_settings(text,integer,text) from public, anon;
grant execute on function public.set_canteen_billing_settings(text,integer,text) to authenticated;

-- Month snapshot of a pooling calculation. One row per canteen+month.
-- draft: may be recomputed/replaced. published: immutable (bills already issued).
create table if not exists public.pooling_bill_runs(
  id uuid primary key default gen_random_uuid(),
  canteen_id uuid not null references public.canteens(id) on delete cascade,
  bill_year integer not null, bill_month integer not null check (bill_month between 1 and 12),
  status text not null default 'draft' check (status in ('draft','published')),
  mess_cut_min_days integer not null,
  expense_total_paise bigint not null check (expense_total_paise >= 0),
  allocated_paise bigint not null, unallocated_paise bigint not null,
  calculation jsonb not null default '{}'::jsonb,
  computed_at timestamptz not null default now(), computed_by uuid, computed_via text not null default 'admin',
  published_at timestamptz,
  unique (canteen_id, bill_year, bill_month),
  check (allocated_paise + unallocated_paise = expense_total_paise)
);
create table if not exists public.pooling_bill_lines(
  run_id uuid not null references public.pooling_bill_runs(id) on delete cascade,
  canteen_id uuid not null references public.canteens(id) on delete cascade,
  employee_id uuid not null references public.profiles(id) on delete cascade,
  window_days integer not null, attended_days integer not null, absent_days integer not null,
  mess_cut_applied boolean not null, chargeable_days integer not null,
  share_paise bigint not null check (share_paise >= 0), admin_added_paise bigint not null default 0,
  total_paise bigint not null, monthly_bill_id uuid,
  primary key (run_id, employee_id)
);
alter table public.pooling_bill_runs enable row level security;
alter table public.pooling_bill_lines enable row level security;
drop policy if exists pooling_bill_runs_admin_select on public.pooling_bill_runs;
create policy pooling_bill_runs_admin_select on public.pooling_bill_runs for select to authenticated
  using (canteen_id = public.current_canteen_id() and public.is_admin_user());
drop policy if exists pooling_bill_lines_select on public.pooling_bill_lines;
-- Admins of the canteen see all lines; a member sees only their own line.
create policy pooling_bill_lines_select on public.pooling_bill_lines for select to authenticated
  using (canteen_id = public.current_canteen_id() and (public.is_admin_user() or employee_id = auth.uid()));
revoke insert, update, delete on public.pooling_bill_runs, public.pooling_bill_lines from anon, authenticated;

-- Audit / idempotency ledger for automatic sending. One 'sent' per canteen/member/period.
create table if not exists public.bill_auto_send_attempts(
  id uuid primary key default gen_random_uuid(),
  canteen_id uuid not null references public.canteens(id) on delete cascade,
  employee_id uuid references public.profiles(id) on delete set null,
  bill_year integer not null, bill_month integer not null,
  billing_model text not null, status text not null check (status in ('sent','skipped','failed','dry_run')),
  detail text, monthly_bill_id uuid, attempted_at timestamptz not null default now()
);
create unique index if not exists bill_auto_send_attempts_one_sent
  on public.bill_auto_send_attempts(canteen_id, employee_id, bill_year, bill_month) where status = 'sent';
alter table public.bill_auto_send_attempts enable row level security;
drop policy if exists bill_auto_send_attempts_admin_select on public.bill_auto_send_attempts;
create policy bill_auto_send_attempts_admin_select on public.bill_auto_send_attempts for select to authenticated
  using (canteen_id = public.current_canteen_id() and public.is_admin_user());
revoke insert, update, delete on public.bill_auto_send_attempts from anon, authenticated;
-- explicit grants (do not rely on platform default privileges); RLS restricts rows
grant select on public.canteen_billing_settings, public.pooling_bill_runs, public.pooling_bill_lines, public.bill_auto_send_attempts to authenticated;
revoke all on public.canteen_billing_settings, public.pooling_bill_runs, public.pooling_bill_lines, public.bill_auto_send_attempts from anon;
grant all on public.canteen_billing_settings, public.pooling_bill_runs, public.pooling_bill_lines, public.bill_auto_send_attempts to service_role;

-- Private schema (not exposed through the Data API) for internal helpers.
create schema if not exists gocanteen_private;
revoke all on schema gocanteen_private from public, anon, authenticated;
grant usage on schema gocanteen_private to service_role;

-- Store (or replace a draft) snapshot. Validates tenant, members and totals against
-- the canteen's own EXISTING Expenses records for that month.
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
  delete from public.pooling_bill_runs where canteen_id=p_canteen and bill_year=p_year and bill_month=p_month and status='draft';
  insert into public.pooling_bill_runs(canteen_id,bill_year,bill_month,mess_cut_min_days,expense_total_paise,allocated_paise,unallocated_paise,calculation,computed_by,computed_via)
  values(p_canteen,p_year,p_month,(p_payload->>'messCutMinDays')::integer,v_expense,v_lines_sum,(p_payload->>'unallocatedPaise')::bigint,p_payload,p_actor,coalesce(p_via,'admin'))
  returning * into v_run;
  insert into public.pooling_bill_lines(run_id,canteen_id,employee_id,window_days,attended_days,absent_days,mess_cut_applied,chargeable_days,share_paise,admin_added_paise,total_paise)
  select v_run.id,p_canteen,(l->>'memberId')::uuid,(l->>'windowDays')::int,(l->>'attendedDays')::int,(l->>'absentDays')::int,(l->>'messCutApplied')::boolean,
         (l->>'chargeableDays')::int,(l->>'sharePaise')::bigint,coalesce((l->>'adminAddedPaise')::bigint,0),(l->>'totalPaise')::bigint
  from jsonb_array_elements(p_payload->'lines') l;
  return v_run;
end $$;

-- Publish one member's pooling bill into the EXISTING monthly_bills / bill_payments
-- tables (same bill format & member Bills screen as standard). Idempotent.
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
  insert into public.monthly_bills(employee_id,bill_month,bill_year,billing_start_date,billing_end_date,days_ordered,food_total,guest_food_total,admin_added_total,total,published,published_at,updated_at,canteen_id,upi_name,upi_id,upi_number,gross_food_total,employee_food_total,company_food_total,employee_contribution_percentage,company_contribution_percentage)
  values(p_employee,v_run.bill_month,v_run.bill_year,v_start,v_end,v_line.chargeable_days,v_line.share_paise/100.0,0,v_line.admin_added_paise/100.0,v_line.total_paise/100.0,true,v_now,v_now,v_run.canteen_id,
    nullif(trim(v_settings.upi_name),''),nullif(trim(v_settings.upi_id),''),nullif(trim(v_settings.upi_number),''),v_line.share_paise/100.0,v_line.share_paise/100.0,0,null,0)
  returning * into v_bill;
  insert into public.bill_payments(id,bill_id,employee_id,amount,status,created_at,updated_at,canteen_id,payment_reference,covered_through,covered_through_at,request_sequence,upi_name,upi_id,upi_number)
  values(v_id,v_bill.id,p_employee,v_line.total_paise/100.0,'unpaid',v_now,v_now,v_run.canteen_id,
    'GoCanteen-'||v_run.bill_year||'-'||lpad(v_run.bill_month::text,2,'0')||'-'||left(p_employee::text,8)||'-P1-'||left(v_id::text,8),v_end,v_now,1,v_bill.upi_name,v_bill.upi_id,v_bill.upi_number);
  update public.pooling_bill_lines set monthly_bill_id=v_bill.id where run_id=p_run and employee_id=p_employee;
  update public.pooling_bill_runs set status='published', published_at=coalesce(published_at,v_now) where id=p_run;
  return v_bill;
end $$;

-- Admin-facing wrappers (manual path). Tenant = caller's canteen; requires 'payments'.
create or replace function public.save_pooling_bill_run(p_month integer, p_year integer, p_payload jsonb)
returns public.pooling_bill_runs language plpgsql security definer set search_path='' as $$
declare v_canteen uuid := public.current_canteen_id(); v_today date := public.gocanteen_business_timestamp()::date;
begin
  if auth.uid() is null or v_canteen is null then raise exception 'Authentication required'; end if;
  if not public.has_admin_permission('payments') then raise exception 'Payment administration permission required'; end if;
  if (make_date(p_year,p_month,1) + interval '1 month - 1 day')::date >= v_today then raise exception 'Only completed months can be billed'; end if;
  return gocanteen_private.save_pooling_run(v_canteen,p_year,p_month,p_payload,auth.uid(),'admin');
end $$;
create or replace function public.publish_pooling_bill(p_run_id uuid, p_employee_id uuid)
returns public.monthly_bills language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.has_admin_permission('payments') then raise exception 'Payment administration permission required'; end if;
  if not exists(select 1 from public.pooling_bill_runs where id=p_run_id and canteen_id=public.current_canteen_id()) then raise exception 'Run not found in your canteen'; end if;
  return gocanteen_private.publish_pooling_line(p_run_id,p_employee_id);
end $$;
revoke all on function public.save_pooling_bill_run(integer,integer,jsonb), public.publish_pooling_bill(uuid,uuid) from public, anon;
grant execute on function public.save_pooling_bill_run(integer,integer,jsonb), public.publish_pooling_bill(uuid,uuid) to authenticated;

-- Automatic path (service_role only, used by the auto-send-monthly-bills Edge Function).
-- Standard canteens: reuse the EXISTING public.publish_employee_bill unchanged by running
-- it in a transaction-local JWT context of the canteen's active owner admin, so all its
-- existing permission/tenant checks and calculations apply exactly as for a manual send.
create or replace function gocanteen_private.system_publish_standard_bill(p_canteen uuid, p_employee uuid, p_month integer, p_year integer)
returns public.monthly_bills language plpgsql security definer set search_path='' as $$
declare v_owner uuid; v_days integer;
begin
  select id into v_owner from public.profiles where canteen_id=p_canteen and role='admin' and status='active' and admin_role in ('owner','master_admin')
    order by case admin_role when 'owner' then 0 else 1 end, created_at limit 1;
  if v_owner is null then raise exception 'No active owner admin for canteen'; end if;
  if not exists(select 1 from public.profiles where id=p_employee and canteen_id=p_canteen and role='employee') then raise exception 'Member not in canteen'; end if;
  select count(distinct o.ordered_for) into v_days from public.orders o where o.employee_id=p_employee and o.canteen_id=p_canteen and o.status='active'
    and o.ordered_for between make_date(p_year,p_month,1) and (make_date(p_year,p_month,1) + interval '1 month - 1 day')::date;
  perform set_config('request.jwt.claims', json_build_object('sub',v_owner,'role','authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  return public.publish_employee_bill(p_employee,p_month,p_year,0,0,0,v_days,null,null);
end $$;
create or replace function gocanteen_private.record_auto_send(p_canteen uuid, p_employee uuid, p_year integer, p_month integer, p_model text, p_status text, p_detail text, p_bill uuid)
returns void language sql security definer set search_path='' as $$
  insert into public.bill_auto_send_attempts(canteen_id,employee_id,bill_year,bill_month,billing_model,status,detail,monthly_bill_id)
  values(p_canteen,p_employee,p_year,p_month,p_model,p_status,left(p_detail,500),p_bill) on conflict do nothing $$;
revoke all on all functions in schema gocanteen_private from public, anon, authenticated;
grant execute on all functions in schema gocanteen_private to service_role;

-- Thin RPC entry points for the Edge Function. EXECUTE granted to service_role ONLY
-- (never anon/authenticated) and re-checked inside.
create or replace function public.auto_bill_save_pooling_run(p_canteen uuid, p_year integer, p_month integer, p_payload jsonb)
returns public.pooling_bill_runs language plpgsql security definer set search_path='' as $$
begin if coalesce(auth.role(),'') <> 'service_role' then raise exception 'service_role only'; end if;
  if (make_date(p_year,p_month,1) + interval '1 month - 1 day')::date >= public.gocanteen_business_timestamp()::date then raise exception 'Only completed months can be billed'; end if;
  return gocanteen_private.save_pooling_run(p_canteen,p_year,p_month,p_payload,null,'automatic'); end $$;
create or replace function public.auto_bill_publish_pooling_line(p_run uuid, p_employee uuid)
returns public.monthly_bills language plpgsql security definer set search_path='' as $$
begin if coalesce(auth.role(),'') <> 'service_role' then raise exception 'service_role only'; end if;
  return gocanteen_private.publish_pooling_line(p_run,p_employee); end $$;
create or replace function public.auto_bill_publish_standard(p_canteen uuid, p_employee uuid, p_month integer, p_year integer)
returns public.monthly_bills language plpgsql security definer set search_path='' as $$
begin if coalesce(auth.role(),'') <> 'service_role' then raise exception 'service_role only'; end if;
  if (make_date(p_year,p_month,1) + interval '1 month - 1 day')::date >= public.gocanteen_business_timestamp()::date then raise exception 'Only completed months can be billed'; end if;
  return gocanteen_private.system_publish_standard_bill(p_canteen,p_employee,p_month,p_year); end $$;
create or replace function public.auto_bill_record_attempt(p_canteen uuid, p_employee uuid, p_year integer, p_month integer, p_model text, p_status text, p_detail text, p_bill uuid)
returns void language plpgsql security definer set search_path='' as $$
begin if coalesce(auth.role(),'') <> 'service_role' then raise exception 'service_role only'; end if;
  perform gocanteen_private.record_auto_send(p_canteen,p_employee,p_year,p_month,p_model,p_status,p_detail,p_bill); end $$;
revoke all on function public.auto_bill_save_pooling_run(uuid,integer,integer,jsonb), public.auto_bill_publish_pooling_line(uuid,uuid),
  public.auto_bill_publish_standard(uuid,uuid,integer,integer), public.auto_bill_record_attempt(uuid,uuid,integer,integer,text,text,text,uuid) from public, anon, authenticated;
grant execute on function public.auto_bill_save_pooling_run(uuid,integer,integer,jsonb), public.auto_bill_publish_pooling_line(uuid,uuid),
  public.auto_bill_publish_standard(uuid,uuid,integer,integer), public.auto_bill_record_attempt(uuid,uuid,integer,integer,text,text,text,uuid) to service_role;
-- NOTE: no pg_cron job is created here. See docs/POOLING_BILLING.md for the opt-in schedule.
