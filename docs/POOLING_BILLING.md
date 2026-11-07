# Opt-in Pooling billing & Automatic monthly bill sending

**Status: test branch only. Migration committed but NOT applied. Edge Function NOT deployed. No scheduler installed.**

## Settings (per canteen, Settings → Billing Mode, needs `payments` permission)
| key | default (row absent) | values |
|---|---|---|
| billing_model | `standard` (current behaviour, unchanged) | `standard`, `pooling` |
| mess_cut_min_days | 6 | 1–31 |
| bill_send_mode | `manual` (current behaviour) | `manual`, `automatic` |

If the table/row does not exist the app behaves exactly as today.

## Pooling mode
* Menu: items can be added without a price (stored `unit_price=0` for new items only). Editing an existing item in pooling mode never changes its stored price, so switching back to Standard restores prices.
* Member screens (order form, guest order, order history/calendar, today's order card) and the admin "order for member" item list hide food prices and food totals. Admin-added amounts and bills (which are real amounts due) are still shown.
* Monthly Reports shows the **Pooling bill** screen instead of the standard report.

### Accounting model
Source of money = the canteen's existing **Expenses** records for the month (`expenses.canteen_id`, `expense_date` in month, amount > 0). Menu prices / order revenue are not used. Additional revenue is not subtracted.
1. **Operating day** = not a declared holiday / recurring weekly off AND at least one member ate (active order with at least one non-guest item). Days nobody ate are closed days and never count as absences.
2. **Member window** = operating days from the member's join date (`profiles.created_at`, IST) to month end. Deleted members are excluded.
3. **No-order days** = window operating days without a consumed order (cumulative, not continuous; several orders on a date = 1 day; cancelled and guest-only orders don't count).
4. **Mess cut**: no-order days ≥ threshold → all those days are not charged. Below threshold → no exclusion (full share).
5. Each expense dated on an operating day is split equally among members chargeable that day (a cut member's day is borne by the others; on days they ate they pay their share).
6. Expenses dated on non-operating days (e.g. bulk purchases on a Sunday) are monthly overhead, split by chargeable member-days.
7. Nobody chargeable → nothing charged; amount shown as **Unallocated** for admin review.
8. Integer paise, largest-remainder rounding (ties by member id): shares sum exactly to the expense total.
9. Admin-added amounts (`employee_adjustments`) are added to that member only, not pooled.
10. Guests: guest items do not create attendance and are not charged separately; their cost is inside the pooled expenses. (Decision for owner — see PR.)

### Snapshot / idempotency
`pooling_bill_runs` (one per canteen+month) + `pooling_bill_lines`. Server re-checks the expense total against `expenses` and that all members belong to the canteen. Draft runs can be recalculated; once any bill is published the run is locked. Publishing writes the same `monthly_bills` + `bill_payments` rows as the standard path (same member Bills screen / UPI payment flow). It refuses if a bill already exists for that member+month.

## Automatic sending
The existing "send" = publishing the bill in-app (`monthly_bills`/`bill_payments`, then existing notifications). It is a server-side database action, so unattended sending is technically possible. No WhatsApp/SMS is involved.
* Edge Function `auto-send-monthly-bills` (service role) processes canteens with `bill_send_mode='automatic'` for the previous **completed IST month** only.
* Standard canteens: calls the unchanged `publish_employee_bill` in a transaction-local JWT context of the canteen's active owner admin (`auto_bill_publish_standard`), so the same checks and calculation apply.
* Pooling canteens: computes, stores the snapshot, publishes each line.
* `bill_auto_send_attempts` audits every attempt (`sent/skipped/failed/dry_run`); a partial unique index allows only one `sent` per canteen/member/month; failures are retried on the next run.
* Safety: requires header `x-cron-secret` = `AUTO_BILL_CRON_SECRET`; sends only if `AUTO_BILL_SEND_LIVE=true`, otherwise dry run; body `{"dryRun":true}` forces dry run.

### Proposed schedule (NOT installed)
```sql
-- run 00:30 IST on the 1st (= 19:00 UTC on the last day; use daily + idempotency instead):
select cron.schedule('gocanteen-auto-bills','0 19 * * *', $$
  select net.http_post(url:='https://<project>.supabase.co/functions/v1/auto-send-monthly-bills',
    headers:=jsonb_build_object('x-cron-secret','<secret>','Content-Type','application/json'), body:='{}'::jsonb) $$);
```
Daily is safe: only the previous month is billed and already-sent members are skipped.

## Testing
* `npm test` — engine + auto-send tests with in-memory fakes (no network).
* Local UI without any backend: run `npm run dev` with no `VITE_SUPABASE_*` env → app uses its existing local-storage mode; Settings → Billing Mode → Pooling hides prices in menu/member screens. The Pooling bill screen needs the database migration, so it shows an error in local mode.
* Full end-to-end requires applying the migration to a **separate (non-production) Supabase project / branch**.
