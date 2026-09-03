alter table public.monthly_bills add column if not exists billing_start_date date;
alter table public.monthly_bills add column if not exists billing_end_date date;
alter table public.monthly_bills add column if not exists days_ordered integer not null default 0;

alter table public.monthly_bills drop constraint if exists monthly_bills_days_ordered_check;
alter table public.monthly_bills add constraint monthly_bills_days_ordered_check
  check (days_ordered >= 0);
