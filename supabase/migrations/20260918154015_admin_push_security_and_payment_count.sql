drop policy if exists notifications_admin on public.notifications;
create policy notifications_admin_select on public.notifications
for select to authenticated
using (
  recipient_id=(select auth.uid())
  and current_canteen_id()=canteen_id
  and (
    public.has_admin_permission('dashboard')
    or public.has_admin_permission('payments')
    or public.has_admin_permission('members')
    or public.has_admin_permission('orders')
    or public.has_admin_permission('menu')
    or public.has_admin_permission('daily_reports')
    or public.has_admin_permission('monthly_reports')
    or public.has_admin_permission('revenue')
    or public.has_admin_permission('expenses')
    or public.has_admin_permission('time_management')
  )
);
create policy notifications_admin_update on public.notifications
for update to authenticated
using (
  recipient_id=(select auth.uid())
  and current_canteen_id()=canteen_id
  and (
    public.has_admin_permission('dashboard')
    or public.has_admin_permission('payments')
    or public.has_admin_permission('members')
    or public.has_admin_permission('orders')
    or public.has_admin_permission('menu')
    or public.has_admin_permission('daily_reports')
    or public.has_admin_permission('monthly_reports')
    or public.has_admin_permission('revenue')
    or public.has_admin_permission('expenses')
    or public.has_admin_permission('time_management')
  )
)
with check (
  recipient_id=(select auth.uid())
  and current_canteen_id()=canteen_id
);

create or replace function public.notify_bill_payment_status_change()
returns trigger
language plpgsql
security definer
set search_path='public'
as $fn$
declare
  v_pending_count integer;
begin
  if new.status='pending_verification' and new.status is distinct from old.status then
    perform public.create_member_notification(
      new.employee_id,'payment_submitted','Payment Submitted',
      'Your payment has been submitted for verification.',
      jsonb_build_object('bill_id',new.bill_id,'payment_id',new.id,'request_sequence',new.request_sequence,'amount',new.amount),
      format('payment_submitted:%s:%s',new.id,coalesce(new.confirmed_at::text,new.updated_at::text))
    );
    select count(*) into v_pending_count from public.bill_payments p where p.canteen_id=new.canteen_id and p.status='pending_verification';
    perform private.create_admin_notification(
      new.canteen_id,'payments','payment_pending_verification','Payment Verification Required',
      format('%s submitted a payment of ₹%s. %s payments are now pending verification.',
        coalesce(new.member_name_snapshot,'Member'),to_char(new.amount,'FM999999990.00'),v_pending_count),
      jsonb_build_object('screen','payment_verification','payment_id',new.id,'bill_id',new.bill_id,'amount',new.amount,'pending_payment_count',v_pending_count),
      format('payment_pending:%s',new.id)
    );
  elsif new.status='rejected' and new.status is distinct from old.status then
    perform public.create_member_notification(
      new.employee_id,'payment_status_updated','Payment Rejected',
      'Your payment was rejected. Please review the payment request and try again.',
      jsonb_build_object('bill_id',new.bill_id,'payment_id',new.id,'request_sequence',new.request_sequence,'status','rejected','amount',new.amount),
      format('payment_status:%s:rejected:%s',new.id,new.updated_at::text)
    );
  end if;
  return new;
end;
$fn$;
