-- Allow negative admin-added amounts as per-member deductions against UNBILLED
-- (not-yet-published) charges only. Existing published bills are never changed.
-- Also updates pooling line-total validation so a clamped-to-zero total is accepted.

do $$
declare c record;
begin
  for c in select con.conname from pg_constraint con
           where con.conrelid = 'public.employee_adjustments'::regclass and con.contype = 'c'
             and pg_get_constraintdef(con.oid) ~* 'amount'
  loop execute format('alter table public.employee_adjustments drop constraint %I', c.conname); end loop;
end $$;
alter table public.employee_adjustments
  add constraint employee_adjustments_amount_check check (amount <> 0 and amount >= -10000 and amount <= 10000000);

create or replace function gocanteen_private.member_unpublished_payable(
  p_canteen uuid, p_employee uuid, p_date date, p_exclude uuid
) returns table(is_published boolean, available numeric, billing_model text)
language plpgsql stable security definer set search_path='' as $$
declare
  v_year integer := extract(year from p_date)::integer;
  v_month integer := extract(month from p_date)::integer;
  v_start date := date_trunc('month', p_date)::date;
  v_end date := (date_trunc('month', p_date) + interval '1 month - 1 day')::date;
  v_model text := coalesce((select s.billing_model from public.canteen_billing_settings s where s.canteen_id=p_canteen),'standard');
  v_food numeric := 0; v_guest numeric := 0; v_adj numeric := 0; v_special numeric := 0;
  v_expense numeric := 0; v_share numeric := 0; v_threshold integer := 6;
  v_my_days integer := 0; v_all_days integer := 0;
begin
  if exists(
    select 1 from public.monthly_bills mb
    where mb.employee_id=p_employee and mb.canteen_id=p_canteen
      and mb.bill_year=v_year and mb.bill_month=v_month and mb.published
  ) then
    return query select true, 0::numeric, v_model; return;
  end if;

  select coalesce(sum(case when coalesce(a.contribution_eligible,false) then coalesce(a.employee_food_amount,a.amount) else a.amount end),0)
    into v_adj
    from public.employee_adjustments a
    where a.employee_id=p_employee and a.canteen_id=p_canteen
      and a.adjustment_date between v_start and v_end
      and (p_exclude is null or a.id <> p_exclude);

  if v_model = 'pooling' then
    select coalesce(mess_cut_min_days,6) into v_threshold from public.canteen_billing_settings where canteen_id=p_canteen;
    select coalesce(sum(e.amount),0) into v_expense
      from public.expenses e where e.canteen_id=p_canteen and e.expense_date between v_start and v_end and e.amount > 0;
    select coalesce(sum(oi.quantity * coalesce(oi.pooling_special_unit_paise,0) / 100.0),0) into v_special
      from public.orders o
      join public.order_items oi on oi.order_id=o.id
      where o.employee_id=p_employee and o.canteen_id=p_canteen and o.status='active'
        and o.ordered_for between v_start and v_end
        and coalesce(oi.pooling_special,false) and oi.pooling_special_unit_paise is not null;
    with op as (
      select gs::date d
      from generate_series(v_start, v_end, interval '1 day') gs
      where not exists(select 1 from public.holiday_dates h where h.canteen_id=p_canteen and h.holiday_date=gs::date)
        and not (
          extract(dow from gs)::int = any(
            coalesce((select hs.recurring_weekdays from public.holiday_settings hs where hs.canteen_id=p_canteen limit 1), '{}'::int[])
          )
        )
    ),
    att as (
      select o.employee_id, o.ordered_for::date d
      from public.orders o
      where o.canteen_id=p_canteen and o.status='active' and o.ordered_for between v_start and v_end
        and exists(
          select 1 from public.order_items oi
          where oi.order_id=o.id and coalesce(oi.item_source,'member') <> 'guest'
        )
    ),
    mem as (
      select p.id from public.profiles p where p.canteen_id=p_canteen and p.role='employee' and p.status <> 'deleted'
    ),
    chg as (
      select m.id,
        case
          when (select count(*) from op) = 0 then 0
          when ((select count(*) from op) - (select count(distinct a.d) from att a where a.employee_id=m.id and a.d in (select d from op))) >= v_threshold
               and ((select count(*) from op) - (select count(distinct a.d) from att a where a.employee_id=m.id and a.d in (select d from op))) > 0
            then (select count(distinct a.d) from att a where a.employee_id=m.id and a.d in (select d from op))
          else (select count(*) from op)
        end as days
      from mem m
    )
    select coalesce(sum(days),0), coalesce(max(case when id=p_employee then days end),0)
      into v_all_days, v_my_days
      from chg;
    if v_all_days > 0 then v_share := round((v_expense * v_my_days / v_all_days)::numeric, 2); end if;
    return query select false, greatest(v_share + v_special + v_adj, 0), v_model; return;
  end if;

  select coalesce(sum(q.employee_amount),0), coalesce(sum(q.guest_amount),0)
    into v_food, v_guest
  from (
    select o.id,
      coalesce(max(o.employee_food_amount), sum(coalesce(oi.line_total, oi.quantity*oi.unit_price)) filter (where coalesce(oi.item_source,'member')<>'guest')) employee_amount,
      coalesce(sum(coalesce(oi.line_total, oi.quantity*oi.unit_price)) filter (where oi.item_source='guest'),0) guest_amount
    from public.orders o
    join public.order_items oi on oi.order_id=o.id
    where o.employee_id=p_employee and o.canteen_id=p_canteen and o.status='active' and o.ordered_for between v_start and v_end
    group by o.id
  ) q;
  return query select false, greatest(coalesce(v_food,0)+coalesce(v_guest,0)+coalesce(v_adj,0), 0), v_model;
end $$;

create or replace function public.get_member_unbilled_admin_room(
  p_employee_id uuid, p_date date, p_exclude_adjustment_id uuid default null
) returns table(published boolean, available numeric, billing_model text)
language plpgsql stable security definer set search_path='' as $$
declare v_admin uuid := auth.uid(); v_canteen uuid; v_emp public.profiles%rowtype;
begin
  if v_admin is null then raise exception 'Authentication required'; end if;
  select * into v_emp from public.profiles where id=p_employee_id and role='employee';
  if not found then raise exception 'Member not found'; end if;
  if public.is_super_admin() then
    v_canteen := v_emp.canteen_id;
  else
    if not public.is_admin_user() then raise exception 'Admin authorization required'; end if;
    v_canteen := public.current_canteen_id();
    if v_canteen is null or v_emp.canteen_id is distinct from v_canteen then raise exception 'Member not found in current canteen'; end if;
  end if;
  return query select r.is_published, r.available, r.billing_model
    from gocanteen_private.member_unpublished_payable(v_canteen, p_employee_id, p_date, p_exclude_adjustment_id) r;
end $$;
revoke all on function public.get_member_unbilled_admin_room(uuid,date,uuid) from public, anon;
grant execute on function public.get_member_unbilled_admin_room(uuid,date,uuid) to authenticated;

create or replace function gocanteen_private.enforce_negative_admin_adjustment()
returns trigger language plpgsql security definer set search_path='' as $$
declare r record; v_amt numeric; v_canteen uuid;
begin
  if NEW.amount >= 0 then return NEW; end if;
  NEW.contribution_eligible := false;
  v_amt := round(NEW.amount::numeric, 2);
  v_canteen := coalesce(NEW.canteen_id, (select p.canteen_id from public.profiles p where p.id=NEW.employee_id));
  select * into r from gocanteen_private.member_unpublished_payable(v_canteen, NEW.employee_id, NEW.adjustment_date, NEW.id);
  if not found or r.is_published then
    raise exception 'This month''s bill is already published. Date the minus amount in the current unbilled month.';
  end if;
  if r.available <= 0 or abs(v_amt) > r.available + 0.001 then
    raise exception 'Minus amount can''t exceed this member''s unbilled amount (₹%)', to_char(round(r.available,2), 'FM999999990.00');
  end if;
  return NEW;
end $$;

drop trigger if exists trg_enforce_negative_admin_adjustment on public.employee_adjustments;
create trigger trg_enforce_negative_admin_adjustment
  before insert or update of amount, adjustment_date, employee_id, canteen_id
  on public.employee_adjustments
  for each row execute function gocanteen_private.enforce_negative_admin_adjustment();

revoke all on function gocanteen_private.member_unpublished_payable(uuid,uuid,date,uuid) from public, anon, authenticated;
revoke all on function gocanteen_private.enforce_negative_admin_adjustment() from public, anon, authenticated;
grant execute on function gocanteen_private.member_unpublished_payable(uuid,uuid,date,uuid) to service_role;


create or replace function public.publish_employee_bill(
p_employee_id uuid,p_month integer,p_year integer,p_food_total numeric,p_admin_added_total numeric,
p_guest_food_total numeric default 0,p_days_ordered integer default 0,
p_billing_start_date date default null,p_billing_end_date date default null
) returns public.monthly_bills language plpgsql security definer set search_path='' as $$
declare
 v_admin public.profiles%rowtype; v_employee public.profiles%rowtype; v_settings public.payment_settings%rowtype; v_bill public.monthly_bills%rowtype;
 v_now timestamptz:=clock_timestamp(); v_business_date date:=public.gocanteen_business_timestamp()::date;
 v_start date:=coalesce(p_billing_start_date,make_date(p_year,p_month,1));
 v_end date:=coalesce(p_billing_end_date,(make_date(p_year,p_month,1)+interval '1 month - 1 day')::date);
 v_gross numeric:=0; v_employee_food numeric:=0; v_guest numeric:=0; v_admin_added numeric:=0; v_total numeric:=0; v_new numeric:=0;
 v_cutoff timestamptz; v_cutoff_through date; v_seq integer:=1; v_id uuid; v_ref text; v_pct numeric:=0;
begin
 v_end:=case when p_year=extract(year from v_business_date)::integer and p_month=extract(month from v_business_date)::integer
             then least(v_end,v_business_date) else v_end end;
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 if public.is_super_admin() then
   select * into v_admin from public.profiles where id=auth.uid() and role='admin' and status='active';
 else
   if not public.has_admin_permission('payments') then raise exception 'Payment administration permission required'; end if;
   select * into v_admin from public.profiles where id=auth.uid() and role='admin' and status='active' and canteen_id=public.current_canteen_id();
   if not found then raise exception 'Admin authorization required'; end if;
 end if;
 if not found then raise exception 'Admin authorization required'; end if;
 if not public.is_super_admin() then
   select * into v_employee from public.profiles where id=p_employee_id and role='employee' and canteen_id=public.current_canteen_id();
 else
   select * into v_employee from public.profiles where id=p_employee_id and role='employee';
 end if;
 if not found then raise exception 'Employee not found in authorized canteen'; end if;
 select * into v_settings from public.payment_settings where canteen_id=coalesce(v_employee.canteen_id,public.current_canteen_id()) limit 1;
 select coalesce(sum(q.gross_amount),0),coalesce(sum(q.employee_amount),0),coalesce(sum(q.guest_amount),0)
 into v_gross,v_employee_food,v_guest
 from (
   select o.id,
     sum(coalesce(oi.line_total,oi.quantity*oi.unit_price)) filter(where oi.item_source<>'guest') gross_amount,
     coalesce(max(o.employee_food_amount),sum(coalesce(oi.line_total,oi.quantity*oi.unit_price)) filter(where oi.item_source<>'guest')) employee_amount,
     sum(coalesce(oi.line_total,oi.quantity*oi.unit_price)) filter(where oi.item_source='guest') guest_amount
   from public.orders o join public.order_items oi on oi.order_id=o.id
   where o.employee_id=p_employee_id and o.canteen_id=v_employee.canteen_id and o.status='active' and o.ordered_for between v_start and v_end
   group by o.id
 ) q;
 select coalesce(sum(case when coalesce(a.contribution_eligible,false) then coalesce(a.employee_food_amount,a.amount) else a.amount end),0)
 into v_admin_added
 from public.employee_adjustments a
 where a.employee_id=p_employee_id and a.canteen_id=v_employee.canteen_id and a.adjustment_date between v_start and v_end;
 select case when min(coalesce(o.employee_contribution_percentage,0))=max(coalesce(o.employee_contribution_percentage,0)) then min(coalesce(o.employee_contribution_percentage,0)) else null end
 into v_pct
 from public.orders o where o.employee_id=p_employee_id and o.canteen_id=v_employee.canteen_id and o.status='active' and o.ordered_for between v_start and v_end;
 v_total:=greatest(coalesce(v_employee_food,0)+coalesce(v_guest,0)+coalesce(v_admin_added,0),0);
 perform pg_advisory_xact_lock(hashtext(format('gocanteen-bill-publish:%s:%s:%s:%s',v_employee.canteen_id,p_employee_id,p_month,p_year)));
 select coalesce(p.covered_through_at,p.created_at),p.covered_through into v_cutoff,v_cutoff_through
 from public.bill_payments p join public.monthly_bills b on b.id=p.bill_id
 where b.employee_id=p_employee_id and b.bill_month=p_month and b.bill_year=p_year and b.canteen_id=v_employee.canteen_id and p.employee_id=p_employee_id
 order by coalesce(p.covered_through_at,p.created_at) desc,p.created_at desc,p.id desc limit 1;
 if v_cutoff is null then
   v_new:=v_total;
 else
   select coalesce(sum(q.employee_amount),0)+coalesce(sum(q.guest_amount),0) into v_new
   from (
     select o.id,
       coalesce(max(o.employee_food_amount),sum(coalesce(oi.line_total,oi.quantity*oi.unit_price)) filter(where oi.item_source<>'guest')) employee_amount,
       sum(coalesce(oi.line_total,oi.quantity*oi.unit_price)) filter(where oi.item_source='guest') guest_amount
     from public.orders o join public.order_items oi on oi.order_id=o.id
     where o.employee_id=p_employee_id and o.canteen_id=v_employee.canteen_id and o.status='active'
       and ((v_cutoff_through is not null and o.ordered_for>v_cutoff_through and o.ordered_for<=v_end)
         or (v_cutoff_through is null and o.created_at>v_cutoff and o.ordered_for between v_start and v_end))
     group by o.id
   ) q;
   select v_new+coalesce(sum(case when coalesce(a.contribution_eligible,false) then coalesce(a.employee_food_amount,a.amount) else a.amount end),0) into v_new
   from public.employee_adjustments a
   where a.employee_id=p_employee_id and a.canteen_id=v_employee.canteen_id
     and ((v_cutoff_through is not null and a.adjustment_date>v_cutoff_through and a.adjustment_date<=v_end)
       or (v_cutoff_through is null and a.created_at>v_cutoff and a.adjustment_date between v_start and v_end));
 end if;
 if v_cutoff is not null and greatest(v_new,0)<=0 then raise exception 'No new amount since the last publication'; end if;
 if v_cutoff is null and v_total<=0 then raise exception 'No payable amount available'; end if;
 insert into public.monthly_bills(employee_id,bill_month,bill_year,billing_start_date,billing_end_date,days_ordered,food_total,guest_food_total,admin_added_total,total,published,published_at,updated_at,canteen_id,upi_name,upi_id,upi_number,gross_food_total,employee_food_total,company_food_total,employee_contribution_percentage,company_contribution_percentage)
 values(p_employee_id,p_month,p_year,v_start,v_end,greatest(coalesce(p_days_ordered,0),0),v_employee_food+v_guest,v_guest,
   (select coalesce(sum(a.amount),0) from public.employee_adjustments a where a.employee_id=p_employee_id and a.canteen_id=v_employee.canteen_id and a.adjustment_date between v_start and v_end),
   v_total,true,v_now,v_now,v_employee.canteen_id,nullif(trim(v_settings.upi_name),''),nullif(trim(v_settings.upi_id),''),nullif(trim(v_settings.upi_number),''),v_gross,v_employee_food,greatest(v_gross-v_employee_food,0),v_pct,case when v_pct>0 then 100-v_pct else 0 end)
 on conflict(employee_id,bill_month,bill_year) do update set
 billing_start_date=excluded.billing_start_date,billing_end_date=excluded.billing_end_date,days_ordered=excluded.days_ordered,food_total=excluded.food_total,guest_food_total=excluded.guest_food_total,admin_added_total=excluded.admin_added_total,total=excluded.total,published=true,published_at=excluded.published_at,updated_at=excluded.updated_at,upi_name=excluded.upi_name,upi_id=excluded.upi_id,upi_number=excluded.upi_number,gross_food_total=excluded.gross_food_total,employee_food_total=excluded.employee_food_total,company_food_total=excluded.company_food_total,employee_contribution_percentage=excluded.employee_contribution_percentage,company_contribution_percentage=excluded.company_contribution_percentage
 returning * into v_bill;
 select coalesce(max(request_sequence),0)+1 into v_seq from public.bill_payments where bill_id=v_bill.id;
 v_id=gen_random_uuid(); v_ref='GoCanteen-'||p_year||'-'||lpad(p_month::text,2,'0')||'-'||left(v_bill.employee_id::text,8)||'-B'||v_seq||'-'||left(v_id::text,8);
 insert into public.bill_payments(id,bill_id,employee_id,amount,status,created_at,updated_at,canteen_id,payment_reference,covered_through,covered_through_at,request_sequence,upi_name,upi_id,upi_number)
 values(v_id,v_bill.id,v_bill.employee_id,greatest(case when v_cutoff is null then v_total else v_new end,0),'unpaid',v_now,v_now,v_bill.canteen_id,v_ref,v_end,v_now,v_seq,v_bill.upi_name,v_bill.upi_id,v_bill.upi_number);
 return v_bill;
end;
$$;
revoke all on function public.publish_employee_bill(uuid,integer,integer,numeric,numeric,numeric,integer,date,date) from public;
grant execute on function public.publish_employee_bill(uuid,integer,integer,numeric,numeric,numeric,integer,date,date) to authenticated;


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
    where (l->>'totalPaise')::bigint <> greatest((l->>'sharePaise')::bigint + coalesce((l->>'adminAddedPaise')::bigint,0)
          + coalesce((l->>'specialMemberPaise')::bigint,0) + coalesce((l->>'specialGuestPaise')::bigint,0), 0);
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


revoke all on function public.publish_employee_bill(uuid,integer,integer,numeric,numeric,numeric,integer,date,date) from public;
grant execute on function public.publish_employee_bill(uuid,integer,integer,numeric,numeric,numeric,integer,date,date) to authenticated;
revoke all on function gocanteen_private.save_pooling_run(uuid,integer,integer,jsonb,uuid,text) from public, anon, authenticated;
grant execute on function gocanteen_private.save_pooling_run(uuid,integer,integer,jsonb,uuid,text) to service_role;
notify pgrst,'reload schema';
