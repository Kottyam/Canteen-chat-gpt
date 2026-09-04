-- GoCanteen payment workflow: bill-specific UPI snapshots + payment verification.
-- Existing monthly_bills remains the billing/publishing source of truth.

alter table public.monthly_bills
  add column if not exists upi_name text,
  add column if not exists upi_id text;

create table if not exists public.payment_settings (
  id integer primary key default 1 check (id = 1),
  upi_name text not null default '',
  upi_id text not null default '',
  updated_at timestamptz not null default now()
);

insert into public.payment_settings (id, upi_name, upi_id)
values (1, '', '')
on conflict (id) do nothing;

create table if not exists public.bill_payments (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references public.monthly_bills(id) on delete cascade,
  employee_id uuid not null references public.profiles(id) on delete cascade,
  amount numeric(12,2) not null check (amount >= 0),
  status text not null default 'pending_verification' check (status in ('pending_verification','paid')),
  confirmed_at timestamptz,
  approved_at timestamptz,
  approved_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bill_id, employee_id)
);

create index if not exists bill_payments_status_idx on public.bill_payments(status);
create index if not exists bill_payments_employee_idx on public.bill_payments(employee_id);
create index if not exists bill_payments_bill_idx on public.bill_payments(bill_id);

alter table public.payment_settings enable row level security;
alter table public.bill_payments enable row level security;

-- Payment settings: authenticated users may read the current configuration only;
-- only an admin profile may change it.
drop policy if exists "payment_settings_read_authenticated" on public.payment_settings;
drop policy if exists "payment_settings_admin_write" on public.payment_settings;
create policy "payment_settings_read_authenticated"
  on public.payment_settings for select to authenticated
  using (true);
create policy "payment_settings_admin_write"
  on public.payment_settings for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin' and p.status = 'active'))
  with check (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin' and p.status = 'active'));

-- Employees can see only their own payment record. They can create the
-- confirmation record, but cannot write the terminal paid state.
drop policy if exists "bill_payments_employee_select" on public.bill_payments;
drop policy if exists "bill_payments_employee_insert" on public.bill_payments;
drop policy if exists "bill_payments_employee_update" on public.bill_payments;
drop policy if exists "bill_payments_admin_all" on public.bill_payments;
create policy "bill_payments_employee_select"
  on public.bill_payments for select to authenticated
  using (employee_id = (select auth.uid()) or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin' and p.status = 'active'));
create policy "bill_payments_employee_insert"
  on public.bill_payments for insert to authenticated
  with check (
    employee_id = (select auth.uid())
    and status = 'pending_verification'
    and amount = (select mb.total from public.monthly_bills mb where mb.id = bill_id and mb.employee_id = employee_id and mb.published = true)
  );
create policy "bill_payments_employee_update"
  on public.bill_payments for update to authenticated
  using (employee_id = (select auth.uid()) and status = 'pending_verification')
  with check (employee_id = (select auth.uid()) and status = 'pending_verification');
create policy "bill_payments_admin_all"
  on public.bill_payments for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin' and p.status = 'active'))
  with check (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin' and p.status = 'active'));

-- Employees can read their published bills. Preserve existing policies if any.
-- Snapshot UPI only at first creation of a bill version. Existing rows retain
-- their original snapshot on re-publish.
create or replace function public.snapshot_bill_upi()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare s record;
begin
  if new.upi_id is null or btrim(new.upi_id) = '' then
    select upi_name, upi_id into s from public.payment_settings where id = 1;
    new.upi_name := coalesce(new.upi_name, s.upi_name);
    new.upi_id := coalesce(new.upi_id, s.upi_id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_snapshot_bill_upi on public.monthly_bills;
create trigger trg_snapshot_bill_upi
before insert on public.monthly_bills
for each row execute function public.snapshot_bill_upi();

-- Approval is exposed as a database function so an employee cannot forge
-- approved_by/status through the client. Only an active admin may execute it.
create or replace function public.approve_bill_payment(p_payment_id uuid)
returns public.bill_payments
language plpgsql
security definer
set search_path = public
as $$
declare result public.bill_payments;
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin' and p.status = 'active') then
    raise exception 'Only an authorized admin can approve payments';
  end if;
  update public.bill_payments
  set status = 'paid', approved_at = now(), approved_by = auth.uid(), updated_at = now()
  where id = p_payment_id and status = 'pending_verification'
  returning * into result;
  if result.id is null then raise exception 'Payment is not pending verification'; end if;
  return result;
end;
$$;
revoke all on function public.approve_bill_payment(uuid) from public;
grant execute on function public.approve_bill_payment(uuid) to authenticated;
