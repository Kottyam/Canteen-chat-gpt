-- Security hardening for the 4 pooling tables only (no other table / default privileges touched).
-- Platform default privileges gave authenticated TRUNCATE/TRIGGER/REFERENCES; TRUNCATE is not subject
-- to RLS. App access is SELECT under RLS + SECURITY DEFINER RPCs, so these are unnecessary.
-- Kept: authenticated SELECT (RLS policies), service_role full access, function behaviour.
revoke truncate, trigger, references on table
  public.canteen_billing_settings, public.pooling_bill_runs, public.pooling_bill_lines, public.bill_auto_send_attempts
  from public, anon, authenticated;
-- gocanteen_private.auto_bill_runtime: re-assert no app-role access (idempotent; already none).
revoke all on table gocanteen_private.auto_bill_runtime from public, anon, authenticated;
