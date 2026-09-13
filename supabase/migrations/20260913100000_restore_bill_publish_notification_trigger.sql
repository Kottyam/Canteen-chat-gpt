-- Restore the existing server-side notification path for newly published bill payment batches.
-- create_member_notification remains SECURITY DEFINER and is intentionally not executable
-- by client roles; this trigger runs through its existing trusted server-side path.

create or replace function public.notify_new_bill_payment_batch()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_type text;
  v_title text;
begin
  if new.status<>'unpaid' then return new; end if;
  v_type:=case when coalesce(new.request_sequence,1)=1 then 'monthly_bill_published' else 'additional_bill_published' end;
  v_title:=case when coalesce(new.request_sequence,1)=1 then 'Bill Published' else 'Additional Bill Published' end;
  perform public.create_member_notification(
    new.employee_id,
    v_type,
    v_title,
    case when coalesce(new.request_sequence,1)=1
      then format('Bill published — Amount: ₹%s.',to_char(new.amount,'FM999999990.00'))
      else format('Additional bill published — ₹%s.',to_char(new.amount,'FM999999990.00'))
    end,
    jsonb_build_object(
      'bill_id',new.bill_id,
      'payment_id',new.id,
      'request_sequence',new.request_sequence,
      'amount',new.amount,
      'covered_through',new.covered_through
    ),
    format('bill_batch:%s:%s',new.bill_id,coalesce(new.request_sequence,1))
  );
  return new;
end;
$$;

revoke all on function public.notify_new_bill_payment_batch() from public,anon,authenticated;
grant execute on function public.notify_new_bill_payment_batch() to postgres;

drop trigger if exists trg_notify_new_bill_payment_batch on public.bill_payments;
create trigger trg_notify_new_bill_payment_batch
  after insert on public.bill_payments
  for each row execute function public.notify_new_bill_payment_batch();

notify pgrst,'reload schema';
