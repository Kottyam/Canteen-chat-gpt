# Pooling billing / auto-send — staged production plan (NOT executed)

Project: `gocanteen` (ref `cdrjfukxirkanrdklnli`, ap-southeast-2, PG 17.6). Prod state at prep (2026-11-07 IST):
latest applied migration `20260929165408`; none of the pooling objects exist; Edge Function
`auto-send-monthly-bills` not deployed; no auto-bill cron job.

Everything below is additive. After stages 1–2 every canteen behaves exactly as today
(no `canteen_billing_settings` row = Standard + Manual). Nothing sends until stages 4–6.

## Prerequisites (owner decisions)
- The five money-policy defaults in `docs/POOLING_BILLING.md` are UNAPPROVED. Do not switch any canteen to
  Pooling until they are approved. They do not block stages 1–3.
- Approval for each stage below (production changes).

## Stage 0 — backup / evidence (read-only)
1. Confirm daily backups / PITR status in the dashboard (Database → Backups). If PITR is not on, take a
   logical schema backup (`supabase db dump --schema public` by the owner) — data is not modified by these
   migrations, so a schema snapshot + existing daily backup is sufficient.
2. Record pre-state: `list_migrations`, counts of public tables/functions/policies/triggers (32/120/87/46).

## Stage 1 — schema (connector `apply_migration`, in order, each in its own transaction)
1. `20261107100000_opt_in_pooling_billing_and_auto_bill_send` (already on main)
2. `20261107101029_pooling_standard_publish_guard_and_auto_actor` (this PR)
Objects created: tables `canteen_billing_settings`, `pooling_bill_runs`, `pooling_bill_lines`,
`bill_auto_send_attempts`; schema `gocanteen_private` (+ private table `auto_bill_runtime`, live=false);
RPCs `set_canteen_billing_settings`, `save_pooling_bill_run`, `publish_pooling_bill` (authenticated + payments
permission), `auto_bill_*` + `auto_bill_authorize` (service_role only); trigger `zz_guard_pooling_standard_bill`
on `monthly_bills` (BEFORE INSERT; no-op unless that canteen is Pooling).
Not changed: `publish_employee_bill` source, signature, grants; existing tables/data/policies.
Verify: re-run counts; `get_advisors` (expect only the intended authenticated SECURITY DEFINER RPCs and
GraphQL visibility of the 4 new tables, which have RLS + select-only policies).

## Stage 2 — app release
Frontend from main (already merged) shows the Billing mode card; with no settings row it behaves as Standard.

## Stage 3 — Edge Function (connector `deploy_edge_function`), dry run only
Deploy `auto-send-monthly-bills` (+ `_shared/autoSend.ts`, `poolingBilling.ts`, `poolingInputs.ts`,
`cronAuth.ts`) with **verify_jwt = false** (custom `x-cron-secret` auth; Supabase docs: Edge Function JWT
verification only works with legacy JWT keys; publishable/secret keys need in-function auth).
No function env secrets needed: the secret is checked against Vault via `auto_bill_authorize`.
Without a Vault secret every call returns 401 (fail closed).

## Stage 4 — secret (connector `execute_sql`, value never displayed)
```sql
select vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'auto_bill_cron_secret','auto-send cron');
```

## Stage 5 — scheduler (in-database pg_cron; not an assistant routine)
```sql
select cron.schedule('gocanteen-auto-bill-send','30 1 1-3 * *', $$
  select net.http_post(
    url := 'https://cdrjfukxirkanrdklnli.supabase.co/functions/v1/auto-send-monthly-bills',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='auto_bill_cron_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 30000) $$);
```
(01:30 UTC = 07:00 IST on the 1st–3rd; reruns are idempotent.) With `auto_bill_runtime.live=false` the runs
are dry runs: they only record what would be sent. Inspect `bill_auto_send_attempts` / function logs.

## Stage 6 — go live (separate owner approval)
`update gocanteen_private.auto_bill_runtime set live=true;` Still only canteens whose admin chose
Automatic are sent; delivery = the existing in-app bill + notification (no SMS/email).

## Rollback (never drops bill history)
- Stop sending: `update gocanteen_private.auto_bill_runtime set live=false;` and/or `select cron.unschedule('gocanteen-auto-bill-send');`
- Revoke cron auth: `delete from vault.secrets where name='auto_bill_cron_secret';` (function then 401s)
- Disable guard only if it misbehaves: `drop trigger if exists zz_guard_pooling_standard_bill on public.monthly_bills;`
- Return a canteen to Standard: admin sets Standard in the app (or `set_canteen_billing_settings`).
- Do NOT drop `monthly_bills`, `bill_payments`, `pooling_bill_runs`, `pooling_bill_lines`,
  `bill_auto_send_attempts` once anything has been published — they are the audit trail. If the feature
  must be removed before any use, the new tables can be dropped only after confirming they are empty.

## Test evidence (local only, synthetic data)
- Real-schema facsimile (catalog DDL of prod, schema only, no rows) + both migrations + re-apply: 14/14 DB tests.
- Legacy stub chain (`npm run test:db`): 14/14. Unit: 26 pass, 1 skipped (DB suite placeholder).
- Negative control: with only `20261107100000`, the guard and actor tests fail (proves they test the fix).
- Network isolation: in tests `net.http_post` and `cron.*` are local no-op stubs; nothing leaves the machine.
