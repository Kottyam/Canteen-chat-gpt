-- Optional member-entered UPI reference / UTR on a payment request.
-- Member supplies it (optional) when tapping "I Have Paid"; admins see it during verification.
-- Statuses, amounts and the UPI pay flow are unchanged.
alter table public.bill_payments add column if not exists member_upi_reference text;
alter table public.bill_payments drop constraint if exists bill_payments_member_upi_reference_format;
alter table public.bill_payments add constraint bill_payments_member_upi_reference_format
  check (member_upi_reference is null or member_upi_reference ~ '^[A-Za-z0-9]{6,35}$');

-- Replace the 1-arg function with a backward-compatible 2-arg version (second arg defaults to null),
-- so existing calls with only p_payment_id keep working.
drop function if exists public.confirm_bill_payment(uuid);
create function public.confirm_bill_payment(p_payment_id uuid, p_member_upi_reference text default null)
returns public.bill_payments
language plpgsql security definer set search_path to 'public'
as $function$
declare result public.bill_payments; v_ref text;
begin
  v_ref := nullif(regexp_replace(coalesce(p_member_upi_reference,''),'\s','','g'),'');
  if v_ref is not null and v_ref !~ '^[A-Za-z0-9]{6,35}$' then
    raise exception 'UPI reference must be 6 to 35 letters or numbers';
  end if;
  select p.* into result from public.bill_payments p join public.monthly_bills b on b.id=p.bill_id
   where p.id=p_payment_id and p.employee_id=auth.uid() and b.employee_id=auth.uid() and b.published=true;
  if result.id is null then raise exception 'Payment request is not available'; end if;
  if result.status='paid' then return result; end if;
  if result.status not in ('unpaid','not_received','pending_verification') then raise exception 'Payment request cannot be confirmed'; end if;
  update public.bill_payments set status='pending_verification',confirmed_at=now(),approved_at=null,approved_by=null,updated_at=now(),
    member_upi_reference=coalesce(v_ref,member_upi_reference)
   where id=p_payment_id returning * into result;
  return result;
end; $function$;
grant execute on function public.confirm_bill_payment(uuid, text) to authenticated;
