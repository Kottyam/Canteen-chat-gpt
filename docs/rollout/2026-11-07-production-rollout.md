# Production rollout evidence — gocanteen (cdrjfukxirkanrdklnli), 2026-11-07 IST

Authorized by owner (answered card t47s8): merge PR44, set up live DB/server, automatic sending OFF,
no canteen billing mode changes.

## Migration history (as recorded in production)
| prod version | name | repo file |
|---|---|---|
| 20261107100000 | opt_in_pooling_billing_and_auto_bill_send | same id |
| 20261107101029 | pooling_standard_publish_guard_and_auto_actor | same id |
| 20261107102605 | harden_pooling_table_grants | renamed in this PR to the prod id (was created locally as 20261107102453) |

Note: the connector's apply_migration records its own timestamp. For the first two, it recorded
20261107102047 and a later timestamp; they were then updated in `supabase_migrations.schema_migrations` to the repo
ids (a metadata-only change). The hardening migration was left exactly as the connector recorded it
(20261107102605), and the repo file uses that id.

## Edge Function
`auto-send-monthly-bills` v1 ACTIVE, verify_jwt=false, ezbr_sha256 3b08181a…40fc.
Deployed files are byte-identical to this PR's `supabase/functions/auto-send-monthly-bills/index.ts` (the only change is that
imports point to `./_shared/` for the flat upload) and to `_shared/{autoSend,poolingBilling,poolingInputs,cronAuth}.ts`.
**main (7074c42) does NOT match the deployment until this PR is merged.** main's cronAuth let env
AUTO_BILL_SEND_LIVE=true enable sending; the deployed (PR45) code allows live only through the DB switch.

## OFF state
- `gocanteen_private.auto_bill_runtime.live = false`
- cron `gocanteen-auto-bill-send` `30 1 1-3 * *` (cron.timezone GMT = 07:00 IST, days 1–3), body `{"dryRun":true}`
- Vault secret `auto_bill_cron_secret` generated in-DB (never displayed)
- `canteen_billing_settings` rows: 0 (every canteen Standard/Manual)

## Validation
- Unauthorized / wrong header → 401; GET → 405. Authorized in-DB dry run (net request 74506) → 200, liveSend=false, 0 canteens.
- Aggregate counts unchanged (monthly_bills 8, bill_payments 15, notifications 218, attempts 0).
- Hardening: anon/authenticated have no TRUNCATE/TRIGGER/REFERENCES on the 4 pooling tables + private runtime;
  authenticated SELECT is kept and service_role has full access. Old tables are untouched (e.g. bill_payments grants unchanged).
