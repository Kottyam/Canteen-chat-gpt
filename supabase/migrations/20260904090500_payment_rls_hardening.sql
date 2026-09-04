-- Employee payment rows are immutable after confirmation; only the admin RPC may transition to paid.
drop policy if exists "bill_payments_employee_update" on public.bill_payments;

-- Restrict monthly bill visibility to the employee who owns it or an active admin.
create policy "monthly_bills_employee_or_admin_select"
  on public.monthly_bills for select to authenticated
  using (
    employee_id = (select auth.uid())
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin' and p.status = 'active')
  );
