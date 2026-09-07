-- Optional employee/company food contribution layer.
-- 0% is the compatibility mode: the employee remains responsible for the full gross food value.

create table if not exists public.employee_food_arrangement_settings (
  canteen_id uuid primary key references public.canteens(id) on delete cascade,
  employee_contribution_percentage numeric(5,2) not null default 0 check (employee_contribution_percentage >= 0 and employee_contribution_percentage <= 100),
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.employee_food_arrangement_settings enable row level security;
alter table public.employee_food_arrangement_settings force row level security;
drop policy if exists employee_food_arrangement_settings_admin on public.employee_food_arrangement_settings;
create policy employee_food_arrangement_settings_admin on public.employee_food_arrangement_settings for all to authenticated using (public.current_canteen_id() = canteen_id and public.has_admin_permission('payments')) with check (public.current_canteen_id() = canteen_id and public.has_admin_permission('payments'));

create or replace function public.get_employee_food_contribution_percentage()
returns numeric language plpgsql security definer set search_path='public'
as $$
declare v_canteen uuid; v_percentage numeric;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  v_canteen:=public.current_canteen_id();
  if v_canteen is null then raise exception 'Canteen context required'; end if;
  select employee_contribution_percentage into v_percentage from public.employee_food_arrangement_settings where canteen_id=v_canteen;
  return coalesce(v_percentage,0);
end;
$$;
revoke all on function public.get_employee_food_contribution_percentage() from public;
grant execute on function public.get_employee_food_contribution_percentage() to authenticated;

create or replace function public.set_employee_food_contribution_percentage(p_percentage numeric)
returns numeric language plpgsql security definer set search_path='public'
as $$
declare v_canteen uuid; v_percentage numeric;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.has_admin_permission('payments') then raise exception 'Settings permission required'; end if;
  if p_percentage is null or p_percentage < 0 or p_percentage > 100 then raise exception 'Employee contribution must be between 0% and 100%'; end if;
  v_canteen:=public.current_canteen_id();
  if v_canteen is null then raise exception 'Canteen context required'; end if;
  v_percentage:=round(p_percentage,2);
  insert into public.employee_food_arrangement_settings(canteen_id,employee_contribution_percentage,updated_by,updated_at) values(v_canteen,v_percentage,auth.uid(),now()) on conflict(canteen_id) do update set employee_contribution_percentage=excluded.employee_contribution_percentage,updated_by=excluded.updated_by,updated_at=now();
  return v_percentage;
end;
$$;
revoke all on function public.set_employee_food_contribution_percentage(numeric) from public;
grant execute on function public.set_employee_food_contribution_percentage(numeric) to authenticated;

create or replace function public.touch_employee_food_arrangement_settings()
returns trigger language plpgsql set search_path='public' as $$ begin new.updated_at:=now(); return new; end; $$;
drop trigger if exists employee_food_arrangement_settings_touch on public.employee_food_arrangement_settings;
create trigger employee_food_arrangement_settings_touch before update on public.employee_food_arrangement_settings for each row execute function public.touch_employee_food_arrangement_settings();

alter table public.orders add column if not exists employee_contribution_percentage numeric(5,2);
alter table public.orders add column if not exists employee_food_amount numeric;
alter table public.orders add column if not exists company_food_amount numeric;
alter table public.orders add constraint orders_employee_contribution_percentage_check check(employee_contribution_percentage is null or (employee_contribution_percentage>=0 and employee_contribution_percentage<=100));
alter table public.orders add constraint orders_food_contribution_amounts_check check((employee_food_amount is null or employee_food_amount>=0) and (company_food_amount is null or company_food_amount>=0));

create or replace function public.snapshot_employee_food_contribution()
returns trigger language plpgsql security definer set search_path='public'
as $$
declare v_percentage numeric;
begin
  if tg_op='INSERT' and new.employee_contribution_percentage is null then
    v_percentage:=public.get_employee_food_contribution_percentage();
    new.employee_contribution_percentage:=coalesce(v_percentage,0);
  end if;
  return new;
end;
$$;
drop trigger if exists orders_employee_food_contribution_snapshot on public.orders;
create trigger orders_employee_food_contribution_snapshot before insert on public.orders for each row execute function public.snapshot_employee_food_contribution();

create or replace function public.recalculate_employee_food_contribution_for_order(p_order_id uuid)
returns void language plpgsql security definer set search_path='public'
as $$
declare v_gross numeric:=0; v_percentage numeric:=0; v_employee numeric:=0; v_company numeric:=0;
begin
  select coalesce(sum(coalesce(oi.line_total,oi.quantity*oi.unit_price)),0) into v_gross from public.order_items oi where oi.order_id=p_order_id and oi.item_source<>'guest';
  select coalesce(employee_contribution_percentage,0) into v_percentage from public.orders where id=p_order_id;
  v_percentage:=least(100,greatest(0,v_percentage));
  if v_percentage=0 then v_employee:=round(v_gross,2); v_company:=0; else v_employee:=round(v_gross*v_percentage/100,2); v_company:=round(v_gross-v_employee,2); end if;
  update public.orders set employee_food_amount=v_employee,company_food_amount=v_company where id=p_order_id;
end;
$$;
revoke all on function public.recalculate_employee_food_contribution_for_order(uuid) from public;

create or replace function public.recalculate_employee_food_contribution_trigger()
returns trigger language plpgsql security definer set search_path='public'
as $$ begin perform public.recalculate_employee_food_contribution_for_order(coalesce(new.order_id,old.order_id)); return coalesce(new,old); end; $$;
drop trigger if exists order_items_employee_food_contribution on public.order_items;
create trigger order_items_employee_food_contribution after insert or update or delete on public.order_items for each row execute function public.recalculate_employee_food_contribution_trigger();

alter table public.monthly_bills add column if not exists employee_food_total numeric;
alter table public.monthly_bills add column if not exists company_food_total numeric;

notify pgrst,'reload schema';
