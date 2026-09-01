create table if not exists public.employee_adjustments (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles(id) on delete cascade,
  adjustment_date date not null,
  amount numeric(12,2) not null check (amount >= 0),
  description text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists employee_adjustments_employee_date_idx on public.employee_adjustments(employee_id, adjustment_date);
create index if not exists employee_adjustments_date_idx on public.employee_adjustments(adjustment_date);
grant select, insert, update, delete on public.employee_adjustments to anon, authenticated;
create or replace function public.get_monthly_revenue(p_year integer,p_month integer) returns table(total_collection numeric,total_expenses numeric,net_revenue numeric) language sql security definer set search_path to 'public' as $function$
with bounds as (select make_date(p_year,p_month,1) start_date,(make_date(p_year,p_month,1)+interval '1 month')::date end_date),
orders_total as (select coalesce(sum(oi.quantity*oi.unit_price),0) total from public.orders o join public.order_items oi on oi.order_id=o.id,bounds b where o.ordered_for>=b.start_date and o.ordered_for<b.end_date and coalesce(o.status,'')<>'cancelled'),
adjustments_total as (select coalesce(sum(a.amount),0) total from public.employee_adjustments a,bounds b where a.adjustment_date>=b.start_date and a.adjustment_date<b.end_date),
expense as (select coalesce(sum(e.amount),0) total from public.expenses e,bounds b where e.expense_date>=b.start_date and e.expense_date<b.end_date)
select orders_total.total+adjustments_total.total,expense.total,orders_total.total+adjustments_total.total-expense.total from orders_total,adjustments_total,expense;
$function$;
