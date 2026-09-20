-- Authorize Payment Verification with the existing payments permission.
-- Preserve canteen isolation and enforce payment-action authorization in the database.

drop policy if exists bills_admin_read on public.monthly_bills;

create policy bills_admin_read on public.monthly_bills
for select to public
using (
  public.is_super_admin()
  or (
    public.current_canteen_id() = canteen_id
    and public.has_admin_permission('payments')
  )
);

create or replace function public.set_bill_payment_status(p_payment_id uuid, p_status text)
returns public.bill_payments
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  p public.bill_payments%rowtype;
  v_is_super_admin boolean := public.is_super_admin();
  v_canteen_id uuid := public.current_canteen_id();
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not v_is_super_admin and not public.has_admin_permission('payments') then
    raise exception 'Payment permission required';
  end if;

  if not v_is_super_admin and v_canteen_id is null then
    raise exception 'Active canteen context required';
  end if;

  if p_status not in ('paid','not_received') then
    raise exception 'Invalid payment status';
  end if;

  if v_is_super_admin then
    select * into p
    from public.bill_payments
    where id=p_payment_id;
  else
    select * into p
    from public.bill_payments
    where id=p_payment_id
      and canteen_id=v_canteen_id;
  end if;

  if not found then
    raise exception 'Payment record not found';
  end if;

  if p_status='paid' and p.status not in ('unpaid','pending_verification','not_received') then
    raise exception 'Payment request is already resolved';
  end if;

  if p_status='not_received' and p.status<>'pending_verification' then
    raise exception 'Only pending verification payments can be marked not received';
  end if;

  update public.bill_payments
  set status=p_status,
      approved_at=case when p_status='paid' then now() else null end,
      approved_by=case when p_status='paid' then auth.uid() else null end,
      updated_at=now()
  where id=p.id
  returning * into p;

  insert into public.notifications(
    recipient_id,notification_type,title,message,payload,created_at,canteen_id
  )
  values(
    p.employee_id,
    'payment_status_updated',
    case when p_status='paid' then 'Payment Received' else 'Payment Not Received' end,
    case when p_status='paid'
      then 'Your payment has been verified as received.'
      else 'Your payment was not received. Please make the payment again.'
    end,
    jsonb_build_object(
      'bill_id',p.bill_id,
      'payment_id',p.id,
      'status',p_status,
      'amount',p.amount,
      'payment_reference',p.payment_reference
    ),
    now(),
    p.canteen_id
  );

  return p;
end;
$function$;
