-- Super Admin: read-only canteen summary (bills, payments, members, billing settings, orders, unbilled).
-- SECURITY DEFINER, but refuses anyone who is not an active super admin (public.is_super_admin()).
-- Read-only: no INSERT/UPDATE/DELETE. Additive: creates one new function only.

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

  select s.billing_model, s.bill_send_mode, s.mess_cut_min_days
    into v_model, v_send, v_mess
    from public.canteen_billing_settings s where s.canteen_id = p_canteen_id;
  v_model := coalesce(v_model, 'standard');
  v_send := coalesce(v_send, 'manual');

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
    'settings', jsonb_build_object('billing_model', v_model, 'bill_send_mode', v_send, 'mess_cut_min_days', v_mess),
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
