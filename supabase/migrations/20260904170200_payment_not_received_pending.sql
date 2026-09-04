-- Admin has exactly two outcomes for a pending payment request:
-- Payment Received -> paid
-- Not Received -> not_received, which remains the employee's payable/pending request.
create or replace function public.confirm_bill_payment(p_payment_id uuid) returns public.bill_payments language plpgsql security definer set search_path=public as $$
declare p public.bill_payments%rowtype;
begin
  select * into p from public.bill_payments where id=p_payment_id and employee_id=auth.uid() and canteen_id=public.current_canteen_id();
  if not found then raise exception 'Payment request not found or not accessible'; end if;
  if p.status='pending_verification' then return p; end if;
  if p.status not in ('unpaid','not_received') then raise exception 'Payment request is not payable in its current status'; end if;
  update public.bill_payments set status='pending_verification',confirmed_at=now(),updated_at=now() where id=p.id returning * into p;
  return p;
end;
$$;
revoke all on function public.confirm_bill_payment(uuid) from public;
grant execute on function public.confirm_bill_payment(uuid) to authenticated;

create or replace function public.set_bill_payment_status(p_payment_id uuid,p_status text) returns public.bill_payments language plpgsql security definer set search_path=public as $$
declare a public.profiles%rowtype; p public.bill_payments%rowtype;
begin
  select * into a from public.profiles where id=auth.uid() and role='admin' and status='active' and canteen_id=public.current_canteen_id();
  if not found then raise exception 'Admin authorization required'; end if;
  if p_status not in ('paid','not_received') then raise exception 'Invalid payment status'; end if;
  select * into p from public.bill_payments where id=p_payment_id and canteen_id=public.current_canteen_id();
  if not found then raise exception 'Payment record not found'; end if;
  if p.status<>'pending_verification' then raise exception 'Only pending verification payments can be resolved'; end if;
  update public.bill_payments set status=p_status,approved_at=case when p_status='paid' then now() else null end,approved_by=case when p_status='paid' then auth.uid() else null end,updated_at=now() where id=p.id returning * into p;
  insert into public.notifications(recipient_id,notification_type,title,message,payload,created_at,canteen_id)
  values(p.employee_id,'payment_status_updated',case when p_status='paid' then 'Payment Received' else 'Payment Not Received' end,case when p_status='paid' then 'Your payment has been verified as received.' else 'Your payment was not received. The payment request is pending again and can be paid again.' end,jsonb_build_object('bill_id',p.bill_id,'payment_id',p.id,'status',p_status,'amount',p.amount,'payment_reference',p.payment_reference),now(),p.canteen_id);
  return p;
end;
$$;
revoke all on function public.set_bill_payment_status(uuid,text) from public;
grant execute on function public.set_bill_payment_status(uuid,text) to authenticated;
