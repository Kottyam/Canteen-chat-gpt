-- Monthly bill republish/payment balance hardening.
-- One monthly_bills row remains the canonical current bill; bill_payments stores
-- individual payment requests/receipts so confirmed payments are never double-counted.
alter table public.bill_payments drop constraint if exists bill_payments_bill_id_employee_id_key;
create unique index if not exists bill_payments_pending_unique
  on public.bill_payments (bill_id, employee_id)
  where status = 'pending_verification';

create or replace function public.confirm_bill_payment(p_bill_id uuid)
returns public.bill_payments
language plpgsql
security definer
set search_path=public
as $$
declare
  v_bill public.monthly_bills%rowtype;
  v_paid numeric := 0;
  v_pending public.bill_payments%rowtype;
  v_balance numeric := 0;
  v_payment public.bill_payments%rowtype;
begin
  select * into v_bill
  from public.monthly_bills
  where id=p_bill_id and employee_id=auth.uid() and published=true;
  if not found then raise exception 'Bill not found or not accessible'; end if;

  select coalesce(sum(amount),0) into v_paid
  from public.bill_payments
  where bill_id=p_bill_id and employee_id=auth.uid() and status='paid';

  select * into v_pending
  from public.bill_payments
  where bill_id=p_bill_id and employee_id=auth.uid() and status='pending_verification'
  order by created_at desc limit 1;
  if found then return v_pending; end if;

  v_balance := greatest(coalesce(v_bill.total,0)-v_paid,0);
  if v_balance <= 0 then raise exception 'No additional payment due'; end if;

  insert into public.bill_payments
    (id,bill_id,employee_id,amount,status,confirmed_at,created_at,updated_at)
  values
    (gen_random_uuid(),p_bill_id,auth.uid(),v_balance,'pending_verification',now(),now(),now())
  returning * into v_payment;
  return v_payment;
end;
$$;
revoke all on function public.confirm_bill_payment(uuid) from public;
grant execute on function public.confirm_bill_payment(uuid) to authenticated;

create or replace function public.get_bill_payment_summary(p_bill_id uuid)
returns table(current_total numeric,confirmed_received numeric,pending_amount numeric,outstanding_balance numeric,current_payment_id uuid)
language sql
security definer
set search_path=public
as $$
  select coalesce(mb.total,0),
         coalesce((select sum(amount) from public.bill_payments where bill_id=mb.id and employee_id=mb.employee_id and status='paid'),0),
         coalesce((select sum(amount) from public.bill_payments where bill_id=mb.id and employee_id=mb.employee_id and status='pending_verification'),0),
         greatest(coalesce(mb.total,0)-coalesce((select sum(amount) from public.bill_payments where bill_id=mb.id and employee_id=mb.employee_id and status='paid'),0),0),
         (select id from public.bill_payments where bill_id=mb.id and employee_id=mb.employee_id and status='pending_verification' order by created_at desc limit 1)
  from public.monthly_bills mb
  where mb.id=p_bill_id
    and (mb.employee_id=auth.uid() or exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='admin' and p.status='active'));
$$;
revoke all on function public.get_bill_payment_summary(uuid) from public;
grant execute on function public.get_bill_payment_summary(uuid) to authenticated;

notify pgrst,'reload schema';
