-- Targeted authorization hardening for the three confirmed RPC issues.
-- No business logic changes.

CREATE OR REPLACE FUNCTION public.publish_employee_bill(p_employee_id uuid, p_month integer, p_year integer, p_food_total numeric, p_admin_added_total numeric, p_guest_food_total numeric DEFAULT 0, p_days_ordered integer DEFAULT 0, p_billing_start_date date DEFAULT NULL::date, p_billing_end_date date DEFAULT NULL::date)
 RETURNS monthly_bills
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_admin public.profiles%rowtype;
  v_employee public.profiles%rowtype;
  v_settings public.payment_settings%rowtype;
  v_bill public.monthly_bills%rowtype;
  v_now timestamptz:=clock_timestamp();
  v_start date:=coalesce(p_billing_start_date,make_date(p_year,p_month,1));
  v_end date:=coalesce(p_billing_end_date,(make_date(p_year,p_month,1)+interval '1 month - 1 day')::date);
  v_gross numeric:=0;
  v_employee_food numeric:=0;
  v_guest numeric:=0;
  v_admin_added numeric:=0;
  v_total numeric:=0;
  v_new numeric:=0;
  v_cutoff timestamptz;
  v_seq integer:=1;
  v_id uuid;
  v_ref text;
  v_pct numeric:=0;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if public.is_super_admin() then
    select * into v_admin
    from public.profiles
    where id=auth.uid() and role='admin' and status='active';
  else
    if not public.has_admin_permission('payments') then
      raise exception 'Payment administration permission required';
    end if;

    select * into v_admin
    from public.profiles
    where id=auth.uid() and role='admin' and status='active' and canteen_id=public.current_canteen_id();

    if not found then
      raise exception 'Admin authorization required';
    end if;
  end if;

  if not found then
    raise exception 'Admin authorization required';
  end if;

  if not public.is_super_admin() then
    select * into v_employee
    from public.profiles
    where id=p_employee_id and role='employee' and canteen_id=public.current_canteen_id();
  else
    select * into v_employee
    from public.profiles
    where id=p_employee_id and role='employee';
  end if;

  if not found then
    raise exception 'Employee not found in authorized canteen';
  end if;

  select * into v_settings from public.payment_settings where canteen_id=coalesce(v_employee.canteen_id,public.current_canteen_id()) limit 1;

  select coalesce(sum(q.gross_amount),0),coalesce(sum(q.employee_amount),0),coalesce(sum(q.guest_amount),0)
  into v_gross,v_employee_food,v_guest
  from (
    select o.id,
      sum(coalesce(oi.line_total,oi.quantity*oi.unit_price)) filter(where oi.item_source<>'guest') gross_amount,
      coalesce(max(o.employee_food_amount),sum(coalesce(oi.line_total,oi.quantity*oi.unit_price)) filter(where oi.item_source<>'guest')) employee_amount,
      sum(coalesce(oi.line_total,oi.quantity*oi.unit_price)) filter(where oi.item_source='guest') guest_amount
    from public.orders o
    join public.order_items oi on oi.order_id=o.id
    where o.employee_id=p_employee_id
      and o.canteen_id=v_employee.canteen_id
      and o.status='active'
      and o.ordered_for between v_start and v_end
    group by o.id
  ) q;

  select coalesce(sum(a.amount),0) into v_admin_added
  from public.employee_adjustments a
  where a.employee_id=p_employee_id and a.canteen_id=v_employee.canteen_id and a.adjustment_date between v_start and v_end;

  select case when min(coalesce(o.employee_contribution_percentage,0))=max(coalesce(o.employee_contribution_percentage,0))
    then min(coalesce(o.employee_contribution_percentage,0)) else null end
  into v_pct
  from public.orders o
  where o.employee_id=p_employee_id and o.canteen_id=v_employee.canteen_id and o.status='active' and o.ordered_for between v_start and v_end;

  v_total:=greatest(v_employee_food,0)+greatest(v_guest,0)+greatest(v_admin_added,0);

  perform pg_advisory_xact_lock(hashtext(format('gocanteen-bill-publish:%s:%s:%s:%s',v_employee.canteen_id,p_employee_id,p_month,p_year)));

  select max(coalesce(p.covered_through_at,p.created_at)) into v_cutoff
  from public.bill_payments p
  join public.monthly_bills b on b.id=p.bill_id
  where b.employee_id=p_employee_id and b.bill_month=p_month and b.bill_year=p_year
    and b.canteen_id=v_employee.canteen_id and p.employee_id=p_employee_id;

  if v_cutoff is null then
    v_new:=v_total;
  else
    select coalesce(sum(q.employee_amount),0)+coalesce(sum(q.guest_amount),0) into v_new
    from (
      select o.id,
        coalesce(max(o.employee_food_amount),sum(coalesce(oi.line_total,oi.quantity*oi.unit_price)) filter(where oi.item_source<>'guest')) employee_amount,
        sum(coalesce(oi.line_total,oi.quantity*oi.unit_price)) filter(where oi.item_source='guest') guest_amount
      from public.orders o
      join public.order_items oi on oi.order_id=o.id
      where o.employee_id=p_employee_id and o.canteen_id=v_employee.canteen_id and o.status='active'
        and o.ordered_for between v_start and v_end and o.created_at>v_cutoff
      group by o.id
    ) q;

    select v_new+coalesce(sum(a.amount),0) into v_new
    from public.employee_adjustments a
    where a.employee_id=p_employee_id and a.canteen_id=v_employee.canteen_id
      and a.adjustment_date between v_start and v_end and a.created_at>v_cutoff;
  end if;

  if v_cutoff is not null and greatest(v_new,0)<=0 then
    raise exception 'No new amount since the last publication';
  end if;
  if v_cutoff is null and v_total<=0 then
    raise exception 'No payable amount available';
  end if;

  insert into public.monthly_bills(
    employee_id,bill_month,bill_year,billing_start_date,billing_end_date,days_ordered,
    food_total,guest_food_total,admin_added_total,total,published,published_at,updated_at,
    canteen_id,upi_name,upi_id,upi_number,gross_food_total,employee_food_total,company_food_total,
    employee_contribution_percentage,company_contribution_percentage
  )
  values(
    p_employee_id,p_month,p_year,v_start,v_end,greatest(coalesce(p_days_ordered,0),0),
    v_employee_food+v_guest,v_guest,v_admin_added,v_total,true,v_now,v_now,
    v_employee.canteen_id,nullif(trim(v_settings.upi_name),''),nullif(trim(v_settings.upi_id),''),
    nullif(trim(v_settings.upi_number),''),v_gross,v_employee_food,greatest(v_gross-v_employee_food,0),
    v_pct,case when v_pct>0 then 100-v_pct else 0 end
  )
  on conflict(employee_id,bill_month,bill_year) do update set
    billing_start_date=excluded.billing_start_date,billing_end_date=excluded.billing_end_date,
    days_ordered=excluded.days_ordered,food_total=excluded.food_total,
    guest_food_total=excluded.guest_food_total,admin_added_total=excluded.admin_added_total,
    total=excluded.total,published=true,published_at=excluded.published_at,updated_at=excluded.updated_at,
    upi_name=excluded.upi_name,upi_id=excluded.upi_id,upi_number=excluded.upi_number,
    gross_food_total=excluded.gross_food_total,employee_food_total=excluded.employee_food_total,
    company_food_total=excluded.company_food_total,employee_contribution_percentage=excluded.employee_contribution_percentage,
    company_contribution_percentage=excluded.company_contribution_percentage
  returning * into v_bill;

  select coalesce(max(request_sequence),0)+1 into v_seq from public.bill_payments where bill_id=v_bill.id;
  v_id=gen_random_uuid();
  v_ref='GoCanteen-'||p_year||'-'||lpad(p_month::text,2,'0')||'-'||left(v_bill.employee_id::text,8)||'-B'||v_seq||'-'||left(v_id::text,8);

  insert into public.bill_payments(
    id,bill_id,employee_id,amount,status,created_at,updated_at,canteen_id,payment_reference,
    covered_through,covered_through_at,request_sequence,upi_name,upi_id,upi_number
  )
  values(
    v_id,v_bill.id,v_bill.employee_id,greatest(case when v_cutoff is null then v_total else v_new end,0),
    'unpaid',v_now,v_now,v_bill.canteen_id,v_ref,v_end,v_now,v_seq,
    v_bill.upi_name,v_bill.upi_id,v_bill.upi_number
  );

  return v_bill;
end;
$function$


CREATE OR REPLACE FUNCTION public.purge_old_order_history()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  cutoff_date date:=(date_trunc('month',(now() at time zone 'Asia/Kolkata')::date)-interval '2 months')::date;
  v_canteen uuid:=public.current_canteen_id();
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not public.is_super_admin() and not public.has_admin_permission('orders') then
    raise exception 'Order administration permission required';
  end if;

  if v_canteen is null and not public.is_super_admin() then
    raise exception 'Active canteen context required';
  end if;

  delete from public.order_items
  where canteen_id=v_canteen
    and order_id in(
      select id from public.orders
      where canteen_id=v_canteen and ordered_for<cutoff_date
    );

  delete from public.orders
  where canteen_id=v_canteen and ordered_for<cutoff_date;
end;
$function$


CREATE OR REPLACE FUNCTION public.recalculate_employee_month_contributions(p_employee_id uuid, p_canteen_id uuid, p_month_start date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r record;
  v_cumulative numeric:=0;
  v_company numeric;
  v_employee numeric;
  v_gross numeric;
  v_fixed numeric;
  v_pct numeric;
  v_mode text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not public.is_super_admin() then
    if not public.has_admin_permission('payments') then
      raise exception 'Contribution administration permission required';
    end if;

    if p_canteen_id is null or p_canteen_id <> public.current_canteen_id() then
      raise exception 'Canteen authorization mismatch';
    end if;
  end if;

  if not exists (
    select 1
    from public.profiles p
    where p.id = p_employee_id
      and p.role = 'employee'
      and p.status = 'active'
      and p.canteen_id = p_canteen_id
  ) then
    raise exception 'Employee not found in requested canteen';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(coalesce(p_employee_id::text,'')||':'||coalesce(p_month_start::text,''),0));

  for r in with tx as (
    select o.id::text tx_id,'order' tx_kind,o.ordered_for tx_date,o.created_at tx_time,
      coalesce(sum(case when oi.item_source<>'guest' then greatest(coalesce(oi.line_total,oi.quantity*oi.unit_price),0) else 0 end),0) gross_amount,
      o.employee_contribution_mode mode,o.employee_contribution_percentage pct,o.fixed_monthly_amount fixed_amount
    from public.orders o
    left join public.order_items oi on oi.order_id=o.id
    where o.employee_id=p_employee_id
      and o.canteen_id=p_canteen_id
      and o.status='active'
      and o.ordered_for>=p_month_start
      and o.ordered_for<(p_month_start+interval '1 month')::date
    group by o.id,o.ordered_for,o.created_at,o.employee_contribution_mode,o.employee_contribution_percentage,o.fixed_monthly_amount

    union all

    select a.id::text,'adjustment',a.adjustment_date,a.created_at,
      greatest(coalesce(a.amount,0),0),
      a.contribution_mode,a.contribution_percentage,a.fixed_monthly_amount
    from public.employee_adjustments a
    where a.employee_id=p_employee_id
      and a.canteen_id=p_canteen_id
      and a.contribution_eligible
      and a.adjustment_date>=p_month_start
      and a.adjustment_date<(p_month_start+interval '1 month')::date
  )
  select * from tx
  order by tx_time,tx_date,tx_kind,tx_id
  loop
    v_gross:=greatest(coalesce(r.gross_amount,0),0);
    v_mode:=coalesce(r.mode,'percentage');
    v_pct:=least(100,greatest(0,coalesce(r.pct,100)));
    v_fixed:=greatest(0,coalesce(r.fixed_amount,0));

    if v_mode='fixed_amount' then
      v_company:=least(v_gross,greatest(0,v_fixed-v_cumulative));
      v_employee:=greatest(0,v_gross-v_company);
    else
      v_employee:=round(v_gross*v_pct/100,2);
      v_company:=greatest(0,round(v_gross-v_employee,2));
    end if;

    if r.tx_kind='order' then
      update public.orders
      set employee_food_amount=round(v_employee,2),company_food_amount=round(v_company,2)
      where id=r.tx_id::uuid;
    else
      update public.employee_adjustments
      set employee_food_amount=round(v_employee,2),company_food_amount=round(v_company,2)
      where id=r.tx_id::uuid;
    end if;

    v_cumulative:=v_cumulative+v_gross;
  end loop;
end;
$function$

