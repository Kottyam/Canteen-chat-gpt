create table if not exists public.additional_revenues (
  id uuid primary key default gen_random_uuid(),
  canteen_id uuid references public.canteens(id) on delete cascade,
  revenue_date date not null,
  amount numeric not null check (amount > 0),
  description text not null default '',
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists additional_revenues_canteen_date_idx on public.additional_revenues(canteen_id,revenue_date);
alter table public.additional_revenues enable row level security;
alter table public.additional_revenues force row level security;
drop policy if exists additional_revenues_admin on public.additional_revenues;
create policy additional_revenues_admin on public.additional_revenues
  for all to authenticated
  using (public.current_canteen_id() = canteen_id and public.has_admin_permission('revenue'))
  with check (public.current_canteen_id() = canteen_id and public.has_admin_permission('revenue'));

create or replace function public.set_additional_revenue_context()
returns trigger language plpgsql security definer set search_path to 'public'
as $$
begin
  if public.current_canteen_id() is null then raise exception 'Canteen context required'; end if;
  new.canteen_id := public.current_canteen_id();
  if new.created_by is null then new.created_by := auth.uid(); end if;
  return new;
end;
$$;
drop trigger if exists additional_revenues_context on public.additional_revenues;
create trigger additional_revenues_context before insert or update on public.additional_revenues
for each row execute function public.set_additional_revenue_context();

create or replace function public.touch_additional_revenue()
returns trigger language plpgsql set search_path to 'public'
as $$ begin new.updated_at := now(); return new; end; $$;
drop trigger if exists additional_revenues_touch on public.additional_revenues;
create trigger additional_revenues_touch before update on public.additional_revenues
for each row execute function public.touch_additional_revenue();

create or replace function public.get_monthly_revenue_report(p_year integer,p_month integer)
returns jsonb language plpgsql security definer set search_path to ''
as $$
declare
  v_canteen uuid; v_canteen_name text; v_start date; v_end date;
  v_food numeric := 0; v_guest numeric := 0; v_admin numeric := 0; v_additional numeric := 0; v_expenses numeric := 0;
  v_transactions jsonb; v_expense_rows jsonb;
begin
  if not public.has_admin_permission('revenue') then raise exception 'Revenue permission required'; end if;
  if p_month < 1 or p_month > 12 then raise exception 'Invalid month'; end if;
  v_canteen := public.current_canteen_id();
  if v_canteen is null then raise exception 'Canteen context required'; end if;
  v_start := make_date(p_year,p_month,1); v_end := (v_start + interval '1 month')::date;
  select c.name into v_canteen_name from public.canteens c where c.id=v_canteen;

  select coalesce(sum(case when oi.item_source='guest' then 0 else oi.quantity*oi.unit_price end),0),
         coalesce(sum(case when oi.item_source='guest' then oi.quantity*oi.unit_price else 0 end),0)
    into v_food,v_guest
    from public.orders o join public.order_items oi on oi.order_id=o.id
   where o.canteen_id=v_canteen and o.ordered_for>=v_start and o.ordered_for<v_end
     and coalesce(o.status,'')<>'cancelled' and oi.canteen_id=v_canteen;
  select coalesce(sum(a.amount),0) into v_admin from public.employee_adjustments a
   where a.canteen_id=v_canteen and a.adjustment_date>=v_start and a.adjustment_date<v_end;
  select coalesce(sum(r.amount),0) into v_additional from public.additional_revenues r
   where r.canteen_id=v_canteen and r.revenue_date>=v_start and r.revenue_date<v_end;
  select coalesce(sum(e.amount),0) into v_expenses from public.expenses e
   where e.canteen_id=v_canteen and e.expense_date>=v_start and e.expense_date<v_end;

  select coalesce(jsonb_agg(x.obj order by x.sort_date,x.sort_order), '[]'::jsonb) into v_transactions
  from (
    select o.ordered_for sort_date,1 sort_order,
      jsonb_build_object('date',o.ordered_for,'particulars',coalesce(oi.item_name,'Food Order'),'type',case when oi.item_source='guest' then 'Guest Revenue' else 'Food Revenue' end,'amount',(oi.quantity*oi.unit_price)::numeric) obj
      from public.orders o join public.order_items oi on oi.order_id=o.id
     where o.canteen_id=v_canteen and o.ordered_for>=v_start and o.ordered_for<v_end
       and coalesce(o.status,'')<>'cancelled' and oi.canteen_id=v_canteen
    union all
    select a.adjustment_date,2,jsonb_build_object('date',a.adjustment_date,'particulars',coalesce(nullif(a.description,''),'Admin Added'),'type','Admin Added','amount',a.amount)
      from public.employee_adjustments a where a.canteen_id=v_canteen and a.adjustment_date>=v_start and a.adjustment_date<v_end
    union all
    select r.revenue_date,3,jsonb_build_object('date',r.revenue_date,'particulars',coalesce(nullif(r.description,''),'Additional Revenue'),'type','Additional Revenue','amount',r.amount)
      from public.additional_revenues r where r.canteen_id=v_canteen and r.revenue_date>=v_start and r.revenue_date<v_end
  ) x;
  select coalesce(jsonb_agg(jsonb_build_object('date',e.expense_date,'particulars',coalesce(nullif(e.description,''),'Expense'),'type','Expense','amount',e.amount) order by e.expense_date), '[]'::jsonb)
    into v_expense_rows from public.expenses e
   where e.canteen_id=v_canteen and e.expense_date>=v_start and e.expense_date<v_end;

  return jsonb_build_object('canteen_name',coalesce(v_canteen_name,'Go Canteen'),'start_date',v_start,'end_date',(v_end-1),
    'food_revenue',v_food,'guest_revenue',v_guest,'admin_added_revenue',v_admin,'additional_revenue',v_additional,
    'total_collection',v_food+v_guest+v_admin+v_additional,'total_expenses',v_expenses,
    'net_revenue',v_food+v_guest+v_admin+v_additional-v_expenses,'transactions',v_transactions,'expenses',v_expense_rows);
end;
$$;
revoke all on function public.get_monthly_revenue_report(integer,integer) from public;
grant execute on function public.get_monthly_revenue_report(integer,integer) to authenticated;

create or replace function public.get_monthly_revenue(p_year integer,p_month integer)
returns table(total_collection numeric,total_expenses numeric,net_revenue numeric,food_revenue numeric,admin_added_revenue numeric)
language plpgsql security definer set search_path to ''
as $$ declare r jsonb; begin
  r := public.get_monthly_revenue_report(p_year,p_month);
  return query select (r->>'total_collection')::numeric,(r->>'total_expenses')::numeric,(r->>'net_revenue')::numeric,
    ((r->>'food_revenue')::numeric+(r->>'guest_revenue')::numeric),(r->>'admin_added_revenue')::numeric;
end; $$;