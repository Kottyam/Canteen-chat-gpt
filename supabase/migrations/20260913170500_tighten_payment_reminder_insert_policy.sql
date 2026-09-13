drop policy if exists payment_reminders_admin_insert on public.payment_reminders;

create policy payment_reminders_admin_insert on public.payment_reminders
for insert with check (
  public.current_canteen_id() = public.payment_reminders.canteen_id
  and public.has_admin_permission('payments'::text)
  and exists (
    select 1 from public.monthly_bills b
    where b.id = public.payment_reminders.bill_id
      and b.canteen_id = public.payment_reminders.canteen_id
      and b.employee_id = public.payment_reminders.employee_id
  )
  and (
    public.payment_reminders.payment_id is null
    or exists (
      select 1 from public.bill_payments p
      where p.id = public.payment_reminders.payment_id
        and p.bill_id = public.payment_reminders.bill_id
        and p.employee_id = public.payment_reminders.employee_id
        and p.canteen_id = public.payment_reminders.canteen_id
    )
  )
);
