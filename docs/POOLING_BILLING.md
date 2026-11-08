# Opt-in Pooling billing & Automatic monthly bill sending

**Status: merged to main; NOT applied to production. See docs/POOLING_DEPLOYMENT_PLAN.md.**

## Settings (per canteen, Settings → Billing Mode, needs `payments` permission)
| key | default (row absent) | values |
|---|---|---|
| billing_model | `standard` (current behaviour, unchanged) | `standard`, `pooling` |
| mess_cut_min_days | 6 (also used for a missing/invalid value) | whole number 0–31; 0 = no minimum (every actual no-order day is not charged). Out-of-range values are rejected, never clamped. |
| bill_send_mode | `manual` (current behaviour) | `manual`, `automatic` |

If the table/row does not exist the app behaves exactly as today.

## Pooling mode
* Menu: items can be added without a price (stored `unit_price=0` for new items only). Editing an existing item in pooling mode never changes its stored price, so switching back to Standard restores prices.
* Member screens (order form, guest order, order history/calendar, today's order card) and the admin "order for member" item list hide food prices and food totals. Admin-added amounts and bills (which are real amounts due) are still shown.
* Monthly Reports shows the **Pooling bill** screen instead of the standard report.

### Accounting model
Source of money = the canteen's existing **Expenses** records for the month (`expenses.canteen_id`, `expense_date` in month, amount > 0). Menu prices / order revenue are not used. Additional revenue is not subtracted.
1. **Operating day** = every day of the month that is not an admin-declared holiday or recurring weekly off (Holiday Management). Closure is **never inferred** from "nobody ordered": such a day is a no-order day for every member (the pooling screen warns, so the admin can mark it as a holiday if the mess was closed).
2. **Member window** = operating days from the member's join date (`profiles.created_at`, IST) to month end. Deleted members are excluded.
3. **No-order days** = window operating days without a consumed order (cumulative, not continuous; several orders on a date = 1 day; cancelled and guest-only orders don't count).
4. **Mess cut**: no-order days ≥ threshold (and at least one) → all those days are not charged. Below threshold → no exclusion (full share). Threshold 0 → any no-order day is not charged; 31 → practically never cut.
5. **Expense split (owner-approved method, t74s334, engine v2):** the month's **total** expenses are divided equally across the month's operating days; each day's amount is shared equally among the members chargeable that day (a cut member's no-order days are borne by the others). The date of an expense inside the month does not change anyone's share. Example: ₹3000, 30 operating days (₹100/day): A ate 1 day, B 30 days → A ₹50, B ₹2950; A ate 10 days → A ₹500, B ₹2500.
6. A running-month draft (as of today, IST) uses only the elapsed operating days and the expenses dated up to today.
7. A day where nobody is chargeable, or a month without operating days, is **not** moved to other members: that amount is shown as **Unallocated** for admin review.
8. Integer paise, largest-remainder rounding (per-day amounts by date, member shares by member id): shares + unallocated sum exactly to the expense total.
9. Admin-added amounts (`employee_adjustments`) and special-item snapshot charges (member + guest) are added to that member only, on top of the pool share; never deducted from expenses.
11. Attendance comes from the member's orders whoever placed them (the member or an admin on their behalf); cancelled, empty and guest-only orders are not attendance.
10. Guests: guest items do not create attendance and are not charged separately; their cost is inside the pooled expenses. (Decision for owner — see PR.)

### Snapshot / idempotency
`pooling_bill_runs` (one per canteen+month) + `pooling_bill_lines`. Server re-checks the expense total against `expenses`, that all members belong to the canteen, that the mess cut setting is unchanged, and refuses payloads / unpublished saved runs from an older engine (`engineVersion` < 2) so an old app cannot save or publish the previous dated-expense split. Already-published months are never recalculated. Draft runs can be recalculated; once any bill is published the run is locked. Publishing writes the same `monthly_bills` + `bill_payments` rows as the standard path (same member Bills screen / UPI payment flow). It refuses if a bill already exists for that member+month.

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

## Settings load failures
Missing table/row (migration not applied) => standard, silently (exact current behaviour). Any other load error is surfaced: the last good settings are kept, Monthly Reports refuses to show the standard publisher, and Billing Mode cannot be saved.

## Testing
* `npm test` — engine + auto-send tests with in-memory fakes (no network).
* Local UI without any backend: run `npm run dev` with no `VITE_SUPABASE_*` env → app uses its existing local-storage mode; Settings → Billing Mode → Pooling hides prices in menu/member screens. The Pooling bill screen needs the database migration, so it shows an error in local mode.
* Full end-to-end requires applying the migration to a **separate (non-production) Supabase project / branch**.

### Real-Postgres integration tests (`npm run test:db`)
`supabase/tests/run-db-tests.sh` (local throwaway DB only; refuses non-local URLs):
1. `00_stub_base_schema.sql` — synthetic stand-in for Supabase platform pieces (roles, `auth.uid()/auth.role()`, default privileges) and the original base tables/functions that pre-date this repo's migration history (`profiles`, `orders`, `order_items`, `monthly_bills`, `expenses`, `has_admin_permission`, `is_admin_user`, …). **These are inferred from app code, not the production schema.**
2. Replays all repo migrations in order (real `publish_employee_bill`, `current_canteen_id`, triggers incl. bill notifications). 14 unrelated migrations (subscriptions, pg_net, additional revenue) don't replay locally; the pooling migration must succeed or the run fails.
3. Two **pre-existing** repo migration syntax defects are patched in a temp copy only: `20260907180000` (`RAISE '... 0% and 100%'` needs `%%`) and `20260920135602` (missing `;` after `$function$`). They would fail a fresh `supabase db reset`; production evidently got these objects another way.
4. Synthetic fixtures, then `tests/db.integration.test.ts` runs as real roles/JWT claims (authenticated owner/staff/member, other tenant, anon, service_role) so RLS, grants and triggers are exercised.

## Owner decisions recorded (2026-11-07 IST)
- t53s243: days before joining / after leaving count toward the mess-cut threshold together with ordinary
  no-order days; exemption only when the combined count reaches the threshold (implemented in PR #47).
- t57u (special priced menu items, NOT yet implemented): the admin opts in per menu item ("Add price?").
  Only those items show a price to members/customers when ordering; regular pool items show no price.
  Members who order a priced item pay price × quantity IN ADDITION to their normal pool share.
  The special amount is NEVER deducted from pool Expenses; the common pool share calculation (including
  mess cut) is unchanged.
- Still undecided: monthly allocation method (option A vs B), mid-month publishing / credits, admin running draft.

## Special priced items (owner t56u/t57u/t57s265) — implemented in PR47
- Where: the weekly menu editor (the menu the order screens actually use). In Pooling, both **Add Menu Item** and
  **Edit** have an optional "Add price?" checkbox; the price field appears only when ticked and is validated (0 or more,
  stored in paise). Item + price are kept with the normal **Save** — no second step.
- Who: only admins with payments permission. Menu admins without it see no price controls, just a short note, and can
  still add/edit ordinary items. The server enforces this (`set_pooling_special_item` RPC; table is read-only for apps).
- Storage: `pooling_special_items(canteen_id, weekday, item_code, price_paise)` — separate from `weekly_menu`, so the
  existing weekly delete+insert save never drops or re-checks prices. Removing an item from a day clears its price.
- Effective price for an order (server, `gocanteen_private.effective_pooling_special`):
  1. `daily_menu` row for that date+item with `pooling_special` **TRUE** → daily price; **FALSE** → NOT special
     (explicit; never falls back to the weekly price); **NULL**/no row → inherit
  2. weekly price for that weekday, only if the item is on that day's active weekly menu
  3. otherwise not special. Day-specific overrides have **no UI** (server/data only; not requested).
- Snapshot: `order_items.pooling_special/pooling_special_unit_paise` are set by a trigger at order time (Pooling canteens
  only); client values are ignored on INSERT and UPDATE. Quantity edits keep the snapshot; changing the item or moving it
  to another order re-validates; rescheduling an order re-prices from the server; items ordered before an item was
  flagged stay unpriced; an item's canteen must match its order's canteen.
- Display: menu lists for NEW orders show the current price ("₹x extra"). Already placed orders (today, guest summary,
  admin order view, history calendar) show the server-RECORDED snapshot × quantity — never the current menu price; old
  normal pool orders never show a price, and no ₹0 is shown.
- Bill = pool share (formula unchanged, never reduced) + admin added + member specials + guest specials (guest specials
  charged to the member who ordered). Cancelled orders excluded. `monthly_bills.special_items_total` shows the specials.
  save_pooling_run verifies specials per member against the server and that every line total adds up; published months
  stay locked.

## Guest orders On/Off (owner t58u/t59u) — implemented in PR47
- One per-canteen setting, in Employee Food Arrangement, applies to ALL modes. Default On (no row).
- Off: guest option hidden for members; the server rejects new guest orders/items, switching items/orders to guest,
  guest quantity increases and reactivating a cancelled guest order. Cancel, decrease and history still work; existing
  guest items remain billed. Only payments admins can change it (RPC `set_guest_orders_enabled`).

## NOT implemented (not approved)
- Monthly allocation option A vs B; admin running draft; mid-month publishing/credits.
- Standard mode still trusts client unit prices (pre-existing).

## Manual publish when "Automatic" is selected (owner t60) — existing behaviour, confirmed
- Standard ("Publish Eligible Bills") and Pooling ("Publish Bills") buttons do not read the send mode; they stay usable
  in Automatic mode for the same eligible, completed-month bills as in Manual. Server RPCs (`publish_employee_bill`,
  `save/publish_pooling_bill`) do not check the send mode either; their existing guards are unchanged.
- The scheduler (when enabled) only handles the previous completed month and skips/reuses what was already published
  (Standard: "No new amount" → skipped; Pooling: reuses the published snapshot and returns the existing bill), so a
  manual publish followed by the automatic run creates no duplicate bills or payments (DB test).
- Schedule: pg_cron `30 1 1-3 * *` (GMT) = 07:00 IST on the 1st–3rd. Live sending is globally OFF (dry run only).

## Pooling monthly bills screen (owner t60)
Shows only: month label, total expenses, per-member counts (ate/no-order/mess cut/charged days), admin added, special
items, total, Published, and the action buttons. Real money problems stay visible in red (Unallocated; special charges
that cannot be billed). Removed from the normal view: the explanatory header sentence, Operating days / Shared daily /
Shared monthly rows, all diagnostic notes ("No orders on N days (…) … mark them as holidays", ignored-orders notes) and
the "live recalculation for reference only" footnote. Diagnostics are still stored with the calculation (`warnings`).
A published member shows the billed (saved) amount.

## Running month on the Monthly Bills page (admin only, read-only)
The Pooling Monthly Bills page shows the current month (1st to today, IST) above the previous completed
month. It is computed with `computePoolingBills({ ...input, asOf })`: the window, cohort, expenses, orders,
special-item snapshots and Admin Added amounts stop at `asOf`; days after it never count as operating,
no-order or mess-cut days. Elapsed pre-join / post-exit days count toward the unchanged threshold.
Without `asOf` the completed-month result is identical to before. The current month has no Save or Publish
and never writes bills, runs or notifications; "Download PDF" exports the displayed draft only.
Publishing stays previous-completed-month only (manual or automatic; global auto send stays off).
It refreshes on mount, focus, in-app Expenses add/edit/delete (`gocanteen:pooling-inputs-changed`) and the
existing realtime tables (coalesced). Members only ever see published bills.
