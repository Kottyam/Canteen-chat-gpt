-- Mess cut threshold: allow 0..31 (was 1..31). 0 = no minimum: every actual no-order day is not charged.
-- Default stays 6. Out-of-range values are rejected (never silently clamped or defaulted).
do $$
declare c record;
begin
  for c in select con.conname from pg_constraint con
           where con.conrelid = 'public.canteen_billing_settings'::regclass and con.contype = 'c'
             and pg_get_constraintdef(con.oid) ilike '%mess_cut_min_days%'
  loop execute format('alter table public.canteen_billing_settings drop constraint %I', c.conname); end loop;
end $$;
alter table public.canteen_billing_settings
  add constraint canteen_billing_settings_mess_cut_min_days_check check (mess_cut_min_days between 0 and 31);

create or replace function public.set_canteen_billing_settings(p_billing_model text, p_mess_cut_min_days integer, p_bill_send_mode text)
returns public.canteen_billing_settings language plpgsql security definer set search_path='' as $$
declare v_canteen uuid := public.current_canteen_id(); v_row public.canteen_billing_settings%rowtype;
begin
  if auth.uid() is null or v_canteen is null then raise exception 'Authentication required'; end if;
  if not public.has_admin_permission('payments') then raise exception 'Payment administration permission required'; end if;
  if p_mess_cut_min_days is not null and (p_mess_cut_min_days < 0 or p_mess_cut_min_days > 31) then
    raise exception 'Mess cut days must be a whole number from 0 to 31' using errcode = '22023';
  end if;
  insert into public.canteen_billing_settings(canteen_id,billing_model,mess_cut_min_days,bill_send_mode,updated_at,updated_by)
  values (v_canteen, coalesce(p_billing_model,'standard'), coalesce(p_mess_cut_min_days,6), coalesce(p_bill_send_mode,'manual'), now(), auth.uid())
  on conflict (canteen_id) do update set billing_model=excluded.billing_model, mess_cut_min_days=excluded.mess_cut_min_days,
    bill_send_mode=excluded.bill_send_mode, updated_at=excluded.updated_at, updated_by=excluded.updated_by
  returning * into v_row;
  return v_row;
end $$;
revoke all on function public.set_canteen_billing_settings(text,integer,text) from public, anon;
grant execute on function public.set_canteen_billing_settings(text,integer,text) to authenticated;

-- Pooling expense allocation v2 (owner-approved t74s334): the browser/edge engine computes the shares; the server
-- keeps validating totals and now refuses payloads / saved draft runs from the old engine (engineVersion < 2),
-- so an old app cannot save or publish the previous dated-expense split. Published runs are never changed.
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
  -- engine 2 = approved monthly-total / operating-day method (t74s334). Older app versions must update.
  if coalesce((p_payload->>'engineVersion')::int,0) < 2 then raise exception 'This app version uses an old pooling calculation. Update the app and recalculate.'; end if;
  if (p_payload->>'messCutMinDays')::int is distinct from (select mess_cut_min_days from public.canteen_billing_settings where canteen_id=p_canteen) then
    raise exception 'Mess cut setting changed since preview. Recalculate.'; end if;
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
  if v_run.status <> 'published' and coalesce((v_run.calculation->>'engineVersion')::int,0) < 2 then
    raise exception 'This saved calculation uses the old pooling method. Recalculate and save again.'; end if;
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
revoke all on function gocanteen_private.save_pooling_run(uuid,integer,integer,jsonb,uuid,text) from public, anon, authenticated;
revoke all on function gocanteen_private.publish_pooling_line(uuid,uuid) from public, anon, authenticated;
grant execute on function gocanteen_private.save_pooling_run(uuid,integer,integer,jsonb,uuid,text) to service_role;
grant execute on function gocanteen_private.publish_pooling_line(uuid,uuid) to service_role;
