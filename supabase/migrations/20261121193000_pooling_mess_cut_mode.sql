-- Pooling mess cut mode: 'any' (default, today's scattered-days rule) or 'consecutive'
-- (only operating-day no-order runs of length >= mess_cut_min_days are not charged).
-- Existing rows and runs default to 'any', so current bills and Kochi are unchanged.
-- Holidays and weekly offs are skipped in the engine (neither leave nor a break).

alter table public.canteen_billing_settings
  add column if not exists mess_cut_mode text not null default 'any';
alter table public.canteen_billing_settings drop constraint if exists canteen_billing_settings_mess_cut_mode_check;
alter table public.canteen_billing_settings
  add constraint canteen_billing_settings_mess_cut_mode_check check (mess_cut_mode in ('any', 'consecutive'));

alter table public.pooling_bill_runs
  add column if not exists mess_cut_mode text not null default 'any';
alter table public.pooling_bill_runs drop constraint if exists pooling_bill_runs_mess_cut_mode_check;
alter table public.pooling_bill_runs
  add constraint pooling_bill_runs_mess_cut_mode_check check (mess_cut_mode in ('any', 'consecutive'));

-- Replace the 3-arg settings RPC with a backward-compatible 4-arg version (4th arg defaults to 'any').
drop function if exists public.set_canteen_billing_settings(text, integer, text);
create function public.set_canteen_billing_settings(p_billing_model text, p_mess_cut_min_days integer, p_bill_send_mode text, p_mess_cut_mode text default 'any')
returns public.canteen_billing_settings
language plpgsql security definer set search_path to ''
as $function$
declare v_canteen uuid := public.current_canteen_id(); v_row public.canteen_billing_settings%rowtype;
  v_mode text := coalesce(nullif(p_mess_cut_mode, ''), 'any');
begin
  if auth.uid() is null or v_canteen is null then raise exception 'Authentication required'; end if;
  if not public.has_admin_permission('payments') then raise exception 'Payment administration permission required'; end if;
  if p_mess_cut_min_days is not null and (p_mess_cut_min_days < 0 or p_mess_cut_min_days > 31) then
    raise exception 'Mess cut days must be a whole number from 0 to 31' using errcode = '22023';
  end if;
  if v_mode not in ('any', 'consecutive') then
    raise exception 'Mess cut mode must be any or consecutive' using errcode = '22023';
  end if;
  insert into public.canteen_billing_settings(canteen_id,billing_model,mess_cut_min_days,bill_send_mode,mess_cut_mode,updated_at,updated_by)
  values (v_canteen, coalesce(p_billing_model,'standard'), coalesce(p_mess_cut_min_days,6), coalesce(p_bill_send_mode,'manual'), v_mode, now(), auth.uid())
  on conflict (canteen_id) do update set billing_model=excluded.billing_model, mess_cut_min_days=excluded.mess_cut_min_days,
    bill_send_mode=excluded.bill_send_mode, mess_cut_mode=excluded.mess_cut_mode, updated_at=excluded.updated_at, updated_by=excluded.updated_by
  returning * into v_row;
  return v_row;
end $function$;
revoke all on function public.set_canteen_billing_settings(text, integer, text, text) from public, anon;
grant execute on function public.set_canteen_billing_settings(text, integer, text, text) to authenticated;

create or replace function gocanteen_private.save_pooling_run(p_canteen uuid, p_year integer, p_month integer, p_payload jsonb, p_actor uuid, p_via text)
returns public.pooling_bill_runs language plpgsql security definer set search_path='' as $$
declare v_run public.pooling_bill_runs%rowtype; v_start date := make_date(p_year,p_month,1);
  v_end date := (make_date(p_year,p_month,1) + interval '1 month - 1 day')::date; v_expense bigint; v_lines_sum bigint; v_bad integer;
  v_mode text := coalesce(nullif(p_payload->>'messCutMode',''), 'any');
  v_setting_mode text;
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
    where e.canteen_id=p_canteen and e.expense_date between v_start and v_end and e.amount > 0;
  if v_expense <> (p_payload->>'expenseTotalPaise')::bigint then
    raise exception 'Expense total changed since preview (server % paise). Recalculate.', v_expense; end if;
  select coalesce(sum((l->>'sharePaise')::bigint),0) into v_lines_sum from jsonb_array_elements(p_payload->'lines') l;
  if v_lines_sum + (p_payload->>'unallocatedPaise')::bigint <> v_expense then raise exception 'Allocation does not add up to the expense total'; end if;
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
  select count(*) into v_bad from jsonb_array_elements(p_payload->'lines') l
    where (l->>'totalPaise')::bigint <> greatest((l->>'sharePaise')::bigint + coalesce((l->>'adminAddedPaise')::bigint,0)
          + coalesce((l->>'specialMemberPaise')::bigint,0) + coalesce((l->>'specialGuestPaise')::bigint,0), 0);
  if v_bad > 0 then raise exception 'Line totals do not add up'; end if;
  delete from public.pooling_bill_runs where canteen_id=p_canteen and bill_year=p_year and bill_month=p_month and status='draft';
  insert into public.pooling_bill_runs(canteen_id,bill_year,bill_month,mess_cut_min_days,mess_cut_mode,expense_total_paise,allocated_paise,unallocated_paise,calculation,computed_by,computed_via)
  values(p_canteen,p_year,p_month,(p_payload->>'messCutMinDays')::integer,v_mode,v_expense,v_lines_sum,(p_payload->>'unallocatedPaise')::bigint,p_payload,p_actor,coalesce(p_via,'admin'))
  returning * into v_run;
  insert into public.pooling_bill_lines(run_id,canteen_id,employee_id,window_days,attended_days,absent_days,mess_cut_applied,chargeable_days,share_paise,admin_added_paise,special_member_paise,special_guest_paise,total_paise)
  select v_run.id,p_canteen,(l->>'memberId')::uuid,(l->>'windowDays')::int,(l->>'attendedDays')::int,(l->>'absentDays')::int,(l->>'messCutApplied')::boolean,
         (l->>'chargeableDays')::int,(l->>'sharePaise')::bigint,coalesce((l->>'adminAddedPaise')::bigint,0),
         coalesce((l->>'specialMemberPaise')::bigint,0),coalesce((l->>'specialGuestPaise')::bigint,0),(l->>'totalPaise')::bigint
  from jsonb_array_elements(p_payload->'lines') l;
  return v_run;
end $$;
revoke all on function gocanteen_private.save_pooling_run(uuid,integer,integer,jsonb,uuid,text) from public, anon, authenticated;
grant execute on function gocanteen_private.save_pooling_run(uuid,integer,integer,jsonb,uuid,text) to service_role;

create or replace function public.super_admin_canteen_summary(
  p_canteen_id uuid,
  p_year integer default null,
  p_month integer default null
) returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_year integer := coalesce(p_year, extract(year from v_today)::integer);
  v_month integer := coalesce(p_month, extract(month from v_today)::integer);
  v_start date;
  v_end date;
  v_is_current boolean;
  v_canteen public.canteens%rowtype;
  v_model text;
  v_send text;
  v_mess integer;
  v_mess_mode text;
  v_unbilled numeric := null;
  v_result jsonb;
begin
  if not public.is_super_admin() then
    raise exception 'Super Admin authorization required';
  end if;
  if v_month < 1 or v_month > 12 then raise exception 'Invalid month'; end if;
  select * into v_canteen from public.canteens where id = p_canteen_id;
  if not found then raise exception 'Canteen not found'; end if;

  v_start := make_date(v_year, v_month, 1);
  v_end := (v_start + interval '1 month - 1 day')::date;
  v_is_current := v_year = extract(year from v_today)::integer and v_month = extract(month from v_today)::integer;

  select s.billing_model, s.bill_send_mode, s.mess_cut_min_days, s.mess_cut_mode
    into v_model, v_send, v_mess, v_mess_mode
    from public.canteen_billing_settings s where s.canteen_id = p_canteen_id;
  v_model := coalesce(v_model, 'standard');
  v_send := coalesce(v_send, 'manual');
  v_mess_mode := coalesce(v_mess_mode, 'any');

  if v_is_current then
    select coalesce(sum(x.amt), 0) into v_unbilled from (
      -- members with no published bill this month: everything payable so far
      select r.available amt
        from public.profiles p
        cross join lateral gocanteen_private.member_unpublished_payable(p_canteen_id, p.id, v_today, null) r
       where p.canteen_id = p_canteen_id and p.role = 'employee' and coalesce(p.status, 'active') <> 'deleted'
         and not exists (select 1 from public.monthly_bills mb where mb.employee_id = p.id and mb.canteen_id = p_canteen_id
                          and mb.bill_year = v_year and mb.bill_month = v_month and mb.published)
      union all
      -- Standard members already published this month: orders/adjustments added after their publish
      select coalesce(sum(coalesce(oi.line_total, oi.quantity * oi.unit_price)), 0)
        from public.monthly_bills mb
        join public.orders o on o.employee_id = mb.employee_id and o.canteen_id = mb.canteen_id
        join public.order_items oi on oi.order_id = o.id
       where v_model = 'standard' and mb.canteen_id = p_canteen_id and mb.bill_year = v_year and mb.bill_month = v_month and mb.published
         and o.status = 'active' and o.ordered_for between v_start and v_end and o.created_at > mb.published_at
      union all
      select coalesce(sum(a.amount), 0)
        from public.monthly_bills mb
        join public.employee_adjustments a on a.employee_id = mb.employee_id and a.canteen_id = mb.canteen_id
       where v_model = 'standard' and mb.canteen_id = p_canteen_id and mb.bill_year = v_year and mb.bill_month = v_month and mb.published
         and a.adjustment_date between v_start and v_end and a.created_at > mb.published_at
    ) x;
  end if;

  with bills as (
    select mb.*,
      coalesce((select sum(bp.amount) from public.bill_payments bp where bp.bill_id = mb.id and bp.status = 'paid'), 0) paid,
      coalesce((select sum(bp.amount) from public.bill_payments bp where bp.bill_id = mb.id and bp.status = 'pending_verification'), 0) pending_verification
    from public.monthly_bills mb
    where mb.canteen_id = p_canteen_id and mb.published
  ),
  month_bills as (select * from bills where bill_year = v_year and bill_month = v_month),
  month_orders as (
    select o.* from public.orders o
    where o.canteen_id = p_canteen_id and o.ordered_for between v_start and v_end
  )
  select jsonb_build_object(
    'canteen', jsonb_build_object(
      'id', v_canteen.id, 'name', v_canteen.name, 'created_at', v_canteen.created_at,
      'archived', coalesce(v_canteen.archived, false), 'member_login_mode', v_canteen.member_login_mode),
    'settings', jsonb_build_object('billing_model', v_model, 'bill_send_mode', v_send, 'mess_cut_min_days', v_mess, 'mess_cut_mode', v_mess_mode),
    'members', jsonb_build_object(
      'active', (select count(*) from public.profiles p where p.canteen_id = p_canteen_id and p.role = 'employee' and coalesce(p.status, 'active') = 'active'),
      'total', (select count(*) from public.profiles p where p.canteen_id = p_canteen_id and p.role = 'employee' and coalesce(p.status, 'active') <> 'deleted'),
      'admins', (select count(*) from public.profiles p where p.canteen_id = p_canteen_id and p.role = 'admin' and coalesce(p.status, 'active') = 'active')),
    'period', jsonb_build_object('year', v_year, 'month', v_month, 'start', v_start, 'end', v_end, 'is_current', v_is_current, 'today', v_today),
    'month', jsonb_build_object(
      'published_bills', (select count(*) from month_bills),
      'billed_total', (select coalesce(sum(total), 0) from month_bills),
      'paid', (select coalesce(sum(least(paid, greatest(total, 0))), 0) from month_bills),
      'pending_verification', (select coalesce(sum(pending_verification), 0) from month_bills),
      'outstanding', (select coalesce(sum(greatest(total - paid, 0)), 0) from month_bills),
      'fully_paid_bills', (select count(*) from month_bills where paid >= total),
      'last_published_at', (select max(published_at) from month_bills),
      'orders', (select count(*) from month_orders where status = 'active'),
      'cancelled_orders', (select count(*) from month_orders where status = 'cancelled'),
      'admin_orders', (select count(*) from month_orders where status = 'active' and order_source = 'admin'),
      'members_ordered', (select count(distinct employee_id) from month_orders where status = 'active'),
      'admin_added', (select coalesce(sum(a.amount), 0) from public.employee_adjustments a where a.canteen_id = p_canteen_id and a.adjustment_date between v_start and v_end),
      'expenses', (select coalesce(sum(e.amount), 0) from public.expenses e where e.canteen_id = p_canteen_id and e.expense_date between v_start and v_end),
      'unbilled', v_unbilled),
    'all_time', jsonb_build_object(
      'published_bills', (select count(*) from bills),
      'billed_total', (select coalesce(sum(total), 0) from bills),
      'paid', (select coalesce(sum(least(paid, greatest(total, 0))), 0) from bills),
      'pending_verification', (select coalesce(sum(pending_verification), 0) from bills),
      'outstanding', (select coalesce(sum(greatest(total - paid, 0)), 0) from bills),
      'first_bill_month', (select min(make_date(bill_year, bill_month, 1)) from bills),
      'last_published_at', (select max(published_at) from bills),
      'orders', (select count(*) from public.orders o where o.canteen_id = p_canteen_id and o.status = 'active')),
    'months', coalesce((
      select jsonb_agg(m order by m->>'key' desc) from (
        select jsonb_build_object(
          'key', to_char(make_date(bill_year, bill_month, 1), 'YYYY-MM'),
          'year', bill_year, 'month', bill_month,
          'bills', count(*), 'billed_total', coalesce(sum(total), 0),
          'paid', coalesce(sum(least(paid, greatest(total, 0))), 0),
          'outstanding', coalesce(sum(greatest(total - paid, 0)), 0),
          'last_published_at', max(published_at)) m
        from bills group by bill_year, bill_month
      ) q), '[]'::jsonb)
  ) into v_result;
  return v_result;
end
$function$;


revoke all on function public.super_admin_canteen_summary(uuid, integer, integer) from public, anon;
grant execute on function public.super_admin_canteen_summary(uuid, integer, integer) to authenticated;
notify pgrst, 'reload schema';
