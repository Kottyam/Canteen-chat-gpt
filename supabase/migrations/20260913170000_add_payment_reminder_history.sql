create table if not exists public.payment_reminders (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references public.monthly_bills(id) on delete cascade,
  payment_id uuid references public.bill_payments(id) on delete set null,
  employee_id uuid not null,
  canteen_id uuid not null,
  sent_at timestamptz not null default now()
);

create index if not exists payment_reminders_bill_id_idx on public.payment_reminders(bill_id, sent_at desc);
create index if not exists payment_reminders_payment_id_idx on public.payment_reminders(payment_id);

alter table public.payment_reminders enable row level security;

create policy payment_reminders_admin_select on public.payment_reminders
for select using (
  current_canteen_id() = canteen_id
  and has_admin_permission('payments'::text)
);

create policy payment_reminders_admin_insert on public.payment_reminders
for insert with check (
  current_canteen_id() = canteen_id
  and has_admin_permission('payments'::text)
  and exists (
    select 1 from public.monthly_bills b
    where b.id = bill_id
      and b.canteen_id = canteen_id
      and b.employee_id = employee_id
  )
  and (
    payment_id is null
    or exists (
      select 1 from public.bill_payments p
      where p.id = payment_id
        and p.bill_id = bill_id
        and p.employee_id = employee_id
        and p.canteen_id = canteen_id
    )
  )
);

grant select, insert on public.payment_reminders to authenticated;
