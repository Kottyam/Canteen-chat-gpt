-- Payment requests are independent batches under the same monthly_bills row.
-- The previous partial unique index on (bill_id, employee_id) allowed only one
-- pending batch per monthly bill, which incorrectly blocked a later incremental
-- publish while an earlier batch was still pending verification.
--
-- request_sequence is the existing batch identity assigned by publish_employee_bill.
-- Keep uniqueness at that batch level: the same batch sequence cannot be inserted
-- twice for the same bill, while different batches remain valid.

drop index if exists public.bill_payments_pending_unique;

create unique index if not exists bill_payments_bill_batch_unique
  on public.bill_payments (bill_id, request_sequence)
  where request_sequence is not null;
