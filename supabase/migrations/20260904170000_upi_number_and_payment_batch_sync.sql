-- Extend the existing GoCanteen payment workflow with an optional UPI number
-- and source-specific employee payment confirmation. No new payment system.

alter table public.payment_settings
  add column if not exists upi_number text;

alter table public.monthly_bills
  add column if not exists upi_number text;

alter table public.bill_payments
  add column if not exists upi_name text,
  add column if not exists upi_id text,
  add column if not exists upi_number text;

create or replace function public.snapshot_bill_upi()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  s record;
begin
  if (new.upi_id is null or btrim(new.upi_id) = '')
     or (new.upi_name is null or btrim(new.upi_name) = '')
     or new.upi_number is null then
    select upi_name, upi_id, upi_number into s
    from public.payment_settings
    where id = 1
      and (new.canteen_id is null or canteen_id = new.canteen_id)
    limit 1;
    if new.upi_name is null then new.upi_name := s.upi_name; end if;
    if new.upi_id is null then new.upi_id := s.upi_id; end if;
    if new.upi_number is null then new.upi_number := s.upi_number; end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_snapshot_bill_upi on public.monthly_bills;
create trigger trg_snapshot_bill_upi
before insert on public.monthly_bills
for each row execute function public.snapshot_bill_upi();

create or replace function public.snapshot_bill_payment_upi()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  b record;
begin
  select upi_name, upi_id, upi_number into b
  from public.monthly_bills
  where id = new.bill_id;
  if new.upi_name is null then new.upi_name := b.upi_name; end if;
  if new.upi_id is null then new.upi_id := b.upi_id; end if;
  if new.upi_number is null then new.upi_number := b.upi_number; end if;
  return new;
end;
$$;

drop trigger if exists trg_snapshot_bill_payment_upi on public.bill_payments;
create trigger trg_snapshot_bill_payment_upi
before insert on public.bill_payments
for each row execute function public.snapshot_bill_payment_upi();

update public.bill_payments p
set upi_name = coalesce(p.upi_name, b.upi_name),
    upi_id = coalesce(p.upi_id, b.upi_id),
    upi_number = coalesce(p.upi_number, b.upi_number)
from public.monthly_bills b
where b.id = p.bill_id
  and (p.upi_name is null or p.upi_id is null or p.upi_number is null);

create or replace function public.confirm_bill_payment(p_payment_id uuid)
returns public.bill_payments
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.bill_payments;
begin
  select p.* into result
  from public.bill_payments p
  join public.monthly_bills b on b.id = p.bill_id
  where p.id = p_payment_id
    and p.employee_id = auth.uid()
    and b.employee_id = auth.uid()
    and b.published = true;

  if result.id is null then raise exception 'Payment request is not available'; end if;
  if result.status = 'paid' then return result; end if;
  if result.status not in ('unpaid','not_received','pending_verification') then raise exception 'Payment request cannot be confirmed'; end if;

  update public.bill_payments
  set status = 'pending_verification', confirmed_at = now(), approved_at = null, approved_by = null, updated_at = now()
  where id = p_payment_id
  returning * into result;
  return result;
end;
$$;
revoke all on function public.confirm_bill_payment(uuid) from public;
grant execute on function public.confirm_bill_payment(uuid) to authenticated;

notify pgrst,'reload schema';
