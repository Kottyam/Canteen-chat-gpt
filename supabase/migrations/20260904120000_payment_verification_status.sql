-- Payment verification: employees can confirm payment, admins alone can approve/reject.
alter table public.bill_payments drop constraint if exists bill_payments_status_check;
alter table public.bill_payments add constraint bill_payments_status_check check (status in ('pending_verification','paid','not_received'));

drop policy if exists "bill_payments_employee_update" on public.bill_payments;

create or replace function public.confirm_bill_payment(p_bill_id uuid)
returns public.bill_payments
language plpgsql security definer set search_path=public
as $$
declare result public.bill_payments; bill_amount numeric;
begin
  select total into bill_amount from public.monthly_bills where id=p_bill_id and employee_id=auth.uid() and published=true;
  if bill_amount is null then raise exception 'Bill is not available for payment'; end if;
  update public.bill_payments set status='pending_verification',amount=bill_amount,confirmed_at=now(),updated_at=now(),approved_at=null,approved_by=null
    where bill_id=p_bill_id and employee_id=auth.uid() and status='not_received' returning * into result;
  if result.id is not null then return result; end if;
  insert into public.bill_payments(bill_id,employee_id,amount,status,confirmed_at,updated_at)
    values(p_bill_id,auth.uid(),bill_amount,'pending_verification',now(),now())
    on conflict (bill_id,employee_id) do update set status='pending_verification',amount=excluded.amount,confirmed_at=now(),updated_at=now(),approved_at=null,approved_by=null
    returning * into result;
  return result;
end; $$;
revoke all on function public.confirm_bill_payment(uuid) from public;
grant execute on function public.confirm_bill_payment(uuid) to authenticated;

create or replace function public.set_bill_payment_status(p_payment_id uuid,p_status text)
returns public.bill_payments
language plpgsql security definer set search_path=public
as $$
declare result public.bill_payments;
begin
  if not exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='admin' and p.status='active') then raise exception 'Only an authorized admin can manage payments'; end if;
  if p_status not in ('paid','not_received') then raise exception 'Invalid payment status'; end if;
  update public.bill_payments set status=p_status,approved_at=case when p_status='paid' then now() else null end,approved_by=case when p_status='paid' then auth.uid() else null end,updated_at=now()
    where id=p_payment_id returning * into result;
  if result.id is null then raise exception 'Payment record not found'; end if;
  if to_regclass('public.notifications') is not null then
    insert into public.notifications(recipient_id,title,message,notification_type,payload)
    values(result.employee_id,case when p_status='paid' then 'Payment Received' else 'Payment Not Received' end,
      case when p_status='paid' then 'Your monthly bill payment has been verified as received.' else 'Your monthly bill payment was not verified as received. You can make the payment again.' end,
      'payment_status_updated',jsonb_build_object('bill_id',result.bill_id,'payment_id',result.id,'status',p_status,'amount',result.amount));
  end if;
  return result;
end; $$;
revoke all on function public.set_bill_payment_status(uuid,text) from public;
grant execute on function public.set_bill_payment_status(uuid,text) to authenticated;

create or replace function public.approve_bill_payment(p_payment_id uuid)
returns public.bill_payments language plpgsql security definer set search_path=public
as $$ begin return public.set_bill_payment_status(p_payment_id,'paid'); end; $$;
revoke all on function public.approve_bill_payment(uuid) from public;
grant execute on function public.approve_bill_payment(uuid) to authenticated;

NOTIFY pgrst,'reload schema';
