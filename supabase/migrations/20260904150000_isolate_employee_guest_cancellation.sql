-- Employee and guest food share one daily parent order, but cancellation is source-specific.
-- If an employee cancels while guest food remains, remove only employee items and keep
-- the guest order active. Guest cancellation is already source-specific in the UI.
create or replace function public.isolate_employee_guest_cancellation()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_has_employee boolean;
  v_has_guest boolean;
  v_guest_total numeric;
begin
  if old.status='active'
     and new.status='cancelled'
     and auth.uid()=old.employee_id
     and coalesce(old.order_source,'employee')<>'admin' then

    select exists(select 1 from public.order_items where order_id=old.id and item_source<>'guest' and quantity>0),
           exists(select 1 from public.order_items where order_id=old.id and item_source='guest' and quantity>0)
      into v_has_employee,v_has_guest;

    if v_has_employee and v_has_guest then
      delete from public.order_items where order_id=old.id and item_source<>'guest';
      select coalesce(sum(quantity*unit_price),0) into v_guest_total
      from public.order_items where order_id=old.id and item_source='guest' and quantity>0;
      new.status:='active';
      new.cancelled_at:=null;
      new.guest_total:=v_guest_total;
      new.guest_name:=old.guest_name;
      new.guest_count:=old.guest_count;
      new.updated_at:=now();
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists isolate_employee_guest_cancellation_trigger on public.orders;
create trigger isolate_employee_guest_cancellation_trigger
before update of status on public.orders
for each row execute function public.isolate_employee_guest_cancellation();

-- Cancelled parent orders must not appear in an employee's history.
drop policy if exists "orders: employee reads own or admin reads all" on public.orders;
create policy "orders: employee reads active own or admin reads all"
on public.orders for select to authenticated
using ((employee_id=auth.uid() and status='active') or ((auth.jwt()->'app_metadata'->>'role')='admin'));

drop policy if exists "order items: employee reads own or admin reads all" on public.order_items;
create policy "order items: employee reads active own or admin reads all"
on public.order_items for select to authenticated
using (exists(select 1 from public.orders o where o.id=order_items.order_id and ((o.employee_id=auth.uid() and o.status='active') or ((auth.jwt()->'app_metadata'->>'role')='admin'))));

notify pgrst,'reload schema';
