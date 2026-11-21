// Go Canteen — Pooling (mess expense sharing) bill engine.
// Pure, dependency-free module shared by the web app (preview / manual
// publication) and the `auto-send-monthly-bills` Edge Function.
// All money is integer paise. Dates are India business dates (YYYY-MM-DD).
//
// Accounting model (documented in docs/POOLING_BILLING.md):
//  * Operating day = every day of the month that is NOT an admin-declared holiday
//    or recurring weekly off (Holiday Management). Closure is never inferred from
//    "nobody ordered": a day without orders is a no-order day for every member.
//  * Billable cohort = members whose membership overlaps any day of the month
//    (members removed during the month stay in the cohort for that month).
//  * A member's window = ALL operating days of the month (owner rule t53s243):
//    operating days before joining / after leaving count as no-order days.
//  * absentDays = window operating days without any consumed order of that member
//    (pre-join + post-exit + ordinary no-order days, cumulative, need not be
//    consecutive). Many orders on one date = 1 day.
//  * Mess cut (threshold 0..31, default 6) and mode 'any' | 'consecutive' (default 'any' = today's behaviour):
//      any: absentDays >= threshold and > 0 -> every absent day is non-chargeable (0 = any no-order day).
//           absentDays < threshold -> no exclusion; all window days chargeable. Days need not be consecutive.
//      consecutive (threshold > 0): only no-order *runs* of length >= threshold (on operating days) are excluded.
//           Shorter / scattered runs stay chargeable. Multiple qualifying runs each count.
//           Holidays and weekly offs are skipped: they neither count as leave nor break a run.
//           Threshold 0: same as 'any' (every no-order day is dropped).
//  * Expense allocation (updated): 'eaters' (default) expenses — the month's food-pool
//    total is shared proportionally across members by their chargeable days (after mess
//    cut). 'all_members' expenses (Common bill) are combined and split equally among
//    the monthly cohort (every employee whose membership overlaps the month, including
//    zero-order and mid-month joiners/leavers; not admins or guests). Common bill is
//    not reduced by mess cut. No unallocated leftover on the food pool unless there are
//    zero chargeable days; Common bill is unallocated only if the cohort is empty.
//    A running-month draft (asOf) uses only elapsed operating days and expenses dated <= asOf.
//  * Special-item snapshots and Admin Added amounts are added on top (never deducted).
//  * Rounding: exact fractional shares are computed, floored to paise and the
//    remaining paise are given by largest remainder (members by memberId), so the
//    distributed total equals the expense total exactly.

/** 3 = proportional share of total expense by chargeable days (after mess cut). Server rejects older. */
export const POOLING_ENGINE_VERSION = 3;

export type BillingModel = 'standard' | 'pooling';
export type BillSendMode = 'manual' | 'automatic';
/** 'any' = scattered no-order days count (historical default). 'consecutive' = only runs of length >= threshold. */
export type MessCutMode = 'any' | 'consecutive';

export interface CanteenBillingSettings {
  billingModel: BillingModel;
  messCutMinDays: number;
  messCutMode: MessCutMode;
  billSendMode: BillSendMode;
}

export const DEFAULT_BILLING_SETTINGS: CanteenBillingSettings = Object.freeze({
  billingModel: 'standard',
  messCutMinDays: 6,
  messCutMode: 'any',
  billSendMode: 'manual',
}) as CanteenBillingSettings;

/** Mess cut threshold: whole number 0..31 (0 = every actual no-order day is not charged). */
export const isValidMessCutDays = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 31;
/** Missing / null / invalid => default 6 (explicit, consistent fallback). */
export function messCutDaysOrDefault(v: unknown): number {
  if (v == null || v === '') return DEFAULT_BILLING_SETTINGS.messCutMinDays;
  const n = Number(v);
  return isValidMessCutDays(n) ? n : DEFAULT_BILLING_SETTINGS.messCutMinDays;
}
/** Strict parse of an admin-typed value; null when not a whole number 0..31. */
export function parseMessCutDays(text: string): number | null {
  const t = String(text ?? '').trim();
  return /^\d{1,2}$/.test(t) && isValidMessCutDays(Number(t)) ? Number(t) : null;
}
export const isValidMessCutMode = (v: unknown): v is MessCutMode => v === 'any' || v === 'consecutive';
export function messCutModeOrDefault(v: unknown): MessCutMode {
  return isValidMessCutMode(v) ? v : DEFAULT_BILLING_SETTINGS.messCutMode;
}
/** Admin bill-line / PDF label for an applied mess cut. */
export function messCutAppliedLabel(excludedDays: number, mode: MessCutMode, style: 'short' | 'long' = 'long'): string {
  if (mode === 'consecutive') return style === 'short' ? `Mess cut (${excludedDays} consecutive)` : `Mess cut (${excludedDays} consecutive days not charged)`;
  return style === 'short' ? `Mess cut (${excludedDays})` : `Mess cut (${excludedDays} days not charged)`;
}

/** Absent / partial rows always resolve to the existing standard behaviour. */
export function normalizeBillingSettings(row: any): CanteenBillingSettings {
  if (!row || typeof row !== 'object') return { ...DEFAULT_BILLING_SETTINGS };
  const model: BillingModel = row.billing_model === 'pooling' || row.billingModel === 'pooling' ? 'pooling' : 'standard';
  const send: BillSendMode = row.bill_send_mode === 'automatic' || row.billSendMode === 'automatic' ? 'automatic' : 'manual';
  const days = messCutDaysOrDefault(row.mess_cut_min_days ?? row.messCutMinDays);
  const mode = messCutModeOrDefault(row.mess_cut_mode ?? row.messCutMode);
  return { billingModel: model, messCutMinDays: days, messCutMode: mode, billSendMode: send };
}

export type ExpenseSplitMode = 'eaters' | 'all_members';
export const COMMON_BILL_LABEL = 'Common bill';
export const isValidExpenseSplitMode = (v: unknown): v is ExpenseSplitMode => v === 'eaters' || v === 'all_members';
export function expenseSplitModeOrDefault(v: unknown): ExpenseSplitMode {
  return isValidExpenseSplitMode(v) ? v : 'eaters';
}

export type SpecialPricingMode = 'fixed' | 'shared';
export const SPECIAL_PRICING_FIXED = 'fixed' as const;
export const SPECIAL_PRICING_SHARED = 'shared' as const;
export const isValidSpecialPricingMode = (v: unknown): v is SpecialPricingMode => v === 'fixed' || v === 'shared';
export function specialPricingModeOrDefault(v: unknown): SpecialPricingMode {
  return isValidSpecialPricingMode(v) ? v : 'fixed';
}
/** Short bill-line label: "Chicken biryani · 10 Nov". */
export function sharedSpecialLineLabel(itemName: string, date: string): string {
  const name = (itemName || 'Special').trim() || 'Special';
  const [y, m, d] = String(date).split('-').map(Number);
  if (!y || !m || !d) return name;
  const pretty = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  return `${name} · ${pretty}`;
}

export interface SharedSpecialCost { date: string; itemCode: string; itemName?: string; totalPaise: number }
/** One row per member who ordered a shared-cost special (qty ignored; guest items count as that member). */
export interface SharedSpecialOrder { memberId: string; date: string; itemCode: string; itemName?: string }
export interface SharedSpecialPending { date: string; itemCode: string; itemName: string; memberIds: string[]; memberCount: number }
export interface SharedSpecialShare { memberId: string; paise: number }
export interface SharedSpecialSummary {
  date: string; itemCode: string; itemName: string;
  memberIds: string[]; memberCount: number;
  totalPaise: number | null; pending: boolean;
  /** Present when a total has been entered and there are members to charge; amounts use the same equal split as the bill. */
  shares?: SharedSpecialShare[];
}
export interface SpecialLine { label: string; paise: number; itemCode?: string; date?: string }

export interface PoolingExpense { id?: string; date: string; amountPaise: number; splitMode?: ExpenseSplitMode }
export interface PoolingOrder {
  memberId: string;
  date: string;
  status?: string | null; // 'active' | 'cancelled'
  /** true when the order only carries guest items (member did not eat). */
  guestOnly?: boolean;
}
export interface PoolingMember {
  memberId: string;
  activeFrom?: string | null; // first business date the member belongs to the mess
  activeTo?: string | null;   // last business date (deleted/left), inclusive
  /** Membership periods (rejoin = several). Overrides activeFrom/activeTo when given. to=null => open. */
  periods?: { from: string; to?: string | null }[];
  adminAddedPaise?: number;   // member-specific admin-added amounts (not pooled)
}
export interface PoolingInput {
  year: number;
  month: number; // 1-12
  messCutMinDays: number;
  messCutMode?: MessCutMode;
  expenses: PoolingExpense[];
  orders: PoolingOrder[];
  members: PoolingMember[];
  /** Closed dates: declared holidays. */
  holidayDates?: string[];
  /** Recurring weekly offs, 0=Sunday … 6=Saturday. */
  recurringWeekdays?: number[];
  /** Special priced items (server snapshot, integer paise) per member: own items + guest items they ordered.
   *  Added on top of the pool share; never deducted from expenses (owner t57u/t57s265). */
  specials?: Record<string, { memberPaise: number; guestPaise: number }>;
  /** Shared-cost specials: totals entered by the admin (per date + item) and the members who ordered them. */
  sharedSpecialCosts?: SharedSpecialCost[];
  sharedSpecialOrders?: SharedSpecialOrder[];
  /** Optional as-of business date (running month draft). Caps the window at this date: later days,
   *  orders, expenses and memberships are not counted. Omitted => the full completed-month result. */
  asOf?: string;
}
export interface PoolingLine {
  memberId: string;
  specialMemberPaise?: number;
  specialGuestPaise?: number;
  windowDays: number;
  attendedDays: number;
  absentDays: number;
  messCutApplied: boolean;
  excludedDays: number;
  chargeableDays: number;
  dailySharePaise: number;
  overheadSharePaise: number;
  sharePaise: number;
  adminAddedPaise: number;
  allMembersSharePaise: number;
  /** Named Shared cost special lines (allocated only). Not mess-cut, not Common bill, not the food pool. */
  specialLines?: SpecialLine[];
  sharedSpecialPaise?: number;
  specialPending?: boolean;
  totalPaise: number;
}
export interface PoolingResult {
  year: number;
  month: number;
  periodStart: string;
  periodEnd: string;
  messCutMinDays: number;
  messCutMode: MessCutMode;
  operatingDays: string[];
  expenseTotalPaise: number;
  allMembersExpensePaise: number;
  allMembersUnallocatedPaise: number;
  dailyExpensePaise: number;
  overheadExpensePaise: number;
  allocatedPaise: number;
  unallocatedPaise: number;
  lines: PoolingLine[];
  /** Internal diagnostics (stored with the calculation; not shown in the normal bills view). */
  warnings: string[];
  /** Actionable money problems the admin must see (short). Unallocated is reported separately. */
  issues: string[];
  /** Shared-cost specials ordered this month that still have no total entered. Blocks publish for those members. */
  pendingSharedSpecials: SharedSpecialPending[];
  sharedSpecialSummaries: SharedSpecialSummary[];
}

const pad = (n: number) => String(n).padStart(2, '0');
export const monthStart = (y: number, m: number) => `${y}-${pad(m)}-01`;
export const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
export const monthEnd = (y: number, m: number) => `${y}-${pad(m)}-${pad(daysInMonth(y, m))}`;
const weekdayOf = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

/** India business date (UTC+05:30, no DST) for an instant. */
export function istBusinessDate(instant: Date): string {
  const t = new Date(instant.getTime() + 330 * 60_000);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}
/** The most recent fully completed billing month in IST. */
export function previousBillingPeriod(instant: Date): { year: number; month: number } {
  const [y, m] = istBusinessDate(instant).split('-').map(Number);
  return m === 1 ? { year: y - 1, month: 12 } : { year: y, month: m - 1 };
}
export function isCompletedPeriod(year: number, month: number, instant: Date): boolean {
  return monthEnd(year, month) < istBusinessDate(instant);
}

export function toPaise(rupees: number | string | null | undefined): number {
  const n = Number(rupees);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}
export const paiseToRupees = (p: number) => Math.round(p) / 100;
/** Food-pool expenses plus Common bill expenses (for Total expenses display). */
export const poolingExpenseGrandTotalPaise = (r: { expenseTotalPaise: number; allMembersExpensePaise?: number }) =>
  Math.round(Number(r.expenseTotalPaise) || 0) + Math.round(Number(r.allMembersExpensePaise) || 0);

/** Distribute `total` paise by exact weights; returns integers summing to total. */
export function apportion(total: number, weights: Array<{ key: string; weight: number }>): Map<string, number> {
  const out = new Map<string, number>();
  const sumW = weights.reduce((s, w) => s + (w.weight > 0 ? w.weight : 0), 0);
  if (total === 0 || sumW <= 0) { weights.forEach(w => out.set(w.key, 0)); return out; }
  const exact = weights.map(w => ({ key: w.key, v: (total * Math.max(0, w.weight)) / sumW }));
  return largestRemainder(total, exact);
}
function largestRemainder(total: number, exact: Array<{ key: string; v: number }>): Map<string, number> {
  const out = new Map<string, number>();
  let assigned = 0;
  const rems = exact.map(e => {
    const f = Math.floor(e.v + 1e-9);
    assigned += f;
    out.set(e.key, f);
    return { key: e.key, r: e.v - f };
  });
  let left = total - assigned;
  rems.sort((a, b) => (b.r - a.r) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  for (let i = 0; left > 0 && rems.length; i = (i + 1) % rems.length, left--) out.set(rems[i].key, out.get(rems[i].key)! + 1);
  return out;
}


/** Operating-day no-order runs with length >= threshold. Holidays/weekly offs are already absent from `window`, so they bridge a run. Threshold 0 = every no-order day. */
export function qualifyingConsecutiveAbsentDates(window: string[], attended: Set<string>, threshold: number): Set<string> {
  const out = new Set<string>();
  if (threshold <= 0) { for (const d of window) if (!attended.has(d)) out.add(d); return out; }
  let run: string[] = [];
  const flush = () => { if (run.length >= threshold) for (const d of run) out.add(d); run = []; };
  for (const d of window) { if (!attended.has(d)) run.push(d); else flush(); }
  flush();
  return out;
}

export function allocateSharedSpecials(
  costs: SharedSpecialCost[] | undefined,
  orders: SharedSpecialOrder[] | undefined,
  inMonth: (d: string) => boolean,
  cohortIds: Set<string>,
): { byMember: Map<string, SpecialLine[]>; pending: SharedSpecialPending[]; summaries: SharedSpecialSummary[]; unallocatedPaise: number; warnings: string[]; issues: string[] } {
  const byMember = new Map<string, SpecialLine[]>();
  const pending: SharedSpecialPending[] = [];
  const summaries: SharedSpecialSummary[] = [];
  const warnings: string[] = [];
  const issues: string[] = [];
  let unallocatedPaise = 0;
  const costMap = new Map<string, SharedSpecialCost>();
  for (const c of costs || []) {
    if (!inMonth(c.date)) continue;
    const a = Math.round(Number(c.totalPaise) || 0);
    if (a < 0) { warnings.push(`Negative shared-cost special ${c.itemCode} on ${c.date} ignored.`); continue; }
    costMap.set(`${c.date}::${c.itemCode}`, { ...c, totalPaise: a });
  }
  const groups = new Map<string, { date: string; itemCode: string; itemName: string; members: Set<string> }>();
  for (const o of orders || []) {
    if (!inMonth(o.date) || !o.memberId || !o.itemCode) continue;
    const key = `${o.date}::${o.itemCode}`;
    const g = groups.get(key) || { date: o.date, itemCode: o.itemCode, itemName: (o.itemName || '').trim(), members: new Set() };
    if (o.itemName && !g.itemName) g.itemName = o.itemName.trim();
    g.members.add(o.memberId);
    groups.set(key, g);
  }
  const keys = [...groups.keys()].sort();
  for (const key of keys) {
    const g = groups.get(key)!;
    const name = g.itemName || g.itemCode || 'Special';
    const participants = [...g.members].filter(id => cohortIds.has(id)).sort();
    const unknown = [...g.members].filter(id => !cohortIds.has(id)).length;
    if (unknown) warnings.push(`Shared cost special ${name} on ${g.date}: ${unknown} order(s) from members without a membership record were ignored.`);
    const cost = costMap.get(key);
    if (!cost) {
      pending.push({ date: g.date, itemCode: g.itemCode, itemName: name, memberIds: participants, memberCount: participants.length });
      summaries.push({ date: g.date, itemCode: g.itemCode, itemName: name, memberIds: participants, memberCount: participants.length, totalPaise: null, pending: true, shares: [] });
      const who = participants.length === 1 ? '1 member' : `${participants.length} members`;
      const msg = `Shared cost pending for ${sharedSpecialLineLabel(name, g.date)} (${who}). Enter the total before publishing those bills.`;
      issues.push(msg);
      continue;
    }
    if (!participants.length) {
      unallocatedPaise += cost.totalPaise;
      summaries.push({ date: g.date, itemCode: g.itemCode, itemName: name, memberIds: [], memberCount: 0, totalPaise: cost.totalPaise, pending: false, shares: [] });
      warnings.push(`Shared cost for ${sharedSpecialLineLabel(name, g.date)} has no members to charge; left unallocated.`);
      continue;
    }
    const shares = apportion(cost.totalPaise, participants.map(id => ({ key: id, weight: 1 })));
    const shareRows = participants.map(id => ({ memberId: id, paise: shares.get(id) || 0 }));
    summaries.push({ date: g.date, itemCode: g.itemCode, itemName: name, memberIds: participants, memberCount: participants.length, totalPaise: cost.totalPaise, pending: false, shares: shareRows });
    const label = sharedSpecialLineLabel(name, g.date);
    for (const id of participants) {
      const paise = shares.get(id) || 0;
      const list = byMember.get(id) || [];
      list.push({ label, paise, itemCode: g.itemCode, date: g.date });
      byMember.set(id, list);
    }
    costMap.delete(key);
  }
  for (const leftover of [...costMap.values()].sort((a, b) => a.date < b.date ? -1 : a.date === b.date ? a.itemCode.localeCompare(b.itemCode) : 1)) {
    unallocatedPaise += leftover.totalPaise;
    const name = leftover.itemName || leftover.itemCode;
    summaries.push({ date: leftover.date, itemCode: leftover.itemCode, itemName: name, memberIds: [], memberCount: 0, totalPaise: leftover.totalPaise, pending: false, shares: [] });
    warnings.push(`Shared cost for ${sharedSpecialLineLabel(name, leftover.date)} has no members to charge; left unallocated.`);
  }
  summaries.sort((a, b) => b.date.localeCompare(a.date) || a.itemCode.localeCompare(b.itemCode) || a.itemName.localeCompare(b.itemName));
  return { byMember, pending, summaries, unallocatedPaise, warnings, issues };
}

export function computePoolingBills(input: PoolingInput): PoolingResult {
  const { year, month } = input;
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) throw new Error('Invalid billing month');
  const threshold = messCutDaysOrDefault(input.messCutMinDays);
  const mode = messCutModeOrDefault(input.messCutMode);
  const start = monthStart(year, month), fullEnd = monthEnd(year, month);
  if (input.asOf != null && !(typeof input.asOf === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.asOf) && input.asOf >= start)) throw new Error('Invalid as-of date');
  const end = input.asOf && input.asOf < fullEnd ? input.asOf : fullEnd;
  const inMonth = (d: string) => typeof d === 'string' && d >= start && d <= end;
  const warnings: string[] = [];
  const issues: string[] = [];
  const holidays = new Set((input.holidayDates || []).filter(inMonth));
  const weekly = new Set((input.recurringWeekdays || []).map(Number));
  // attendance (consumed orders only)
  const attended = new Map<string, Set<string>>();
  for (const o of input.orders) {
    if (!inMonth(o.date) || (o.status && o.status !== 'active') || o.guestOnly) continue;
    if (!attended.has(o.memberId)) attended.set(o.memberId, new Set());
    attended.get(o.memberId)!.add(o.date);
  }
  const members = [...new Map(input.members.map(m => [m.memberId, m])).values()].sort((a, b) => (a.memberId < b.memberId ? -1 : 1));
  const memberIds = new Set(members.map(m => m.memberId));
  { const unknown = [...attended.keys()].filter(id => !memberIds.has(id)).length; if (unknown) warnings.push(`Orders from ${unknown} member${unknown > 1 ? 's' : ''} without a membership record were ignored.`); }
  const operating: string[] = [];
  for (let d = 1; d <= daysInMonth(year, month); d++) {
    const date = `${year}-${pad(month)}-${pad(d)}`;
    if (date > end) break;
    if (holidays.has(date) || weekly.has(weekdayOf(date))) continue;
    operating.push(date);
  }
  const opSet = new Set(operating);
  // per-member chargeable dates
  const chargeable = new Map<string, Set<string>>();
  const lines = new Map<string, PoolingLine>();
  const overlapsMonth = (m: PoolingMember) => {
    const ps = m.periods?.length ? m.periods : [{ from: m.activeFrom || start, to: m.activeTo ?? null }];
    return ps.some(p => (p.from || start) <= end && (!p.to || p.to >= start) && (!p.to || !p.from || p.from <= p.to));
  };
  const cohort = members.filter(overlapsMonth);
  for (const m of members) if (!cohort.includes(m) && attended.has(m.memberId)) warnings.push('Orders found outside a member\'s membership period; ignored.');
  members.splice(0, members.length, ...cohort);
  for (const m of members) {
    // Owner rule: whole-month window; pre-join/post-exit operating days are no-order days.
    const window = operating;
    const mine = attended.get(m.memberId) || new Set<string>();
    const att = window.filter(d => mine.has(d));
    const absent = window.length - att.length;
    let cut = false, excluded = 0;
    let charge: Set<string>;
    if (mode === 'consecutive') {
      const dropped = qualifyingConsecutiveAbsentDates(window, mine, threshold);
      excluded = dropped.size;
      cut = excluded > 0;
      charge = new Set(window.filter(d => !dropped.has(d)));
    } else {
      cut = absent > 0 && absent >= threshold; // threshold 0: any actual no-order day is cut
      excluded = cut ? absent : 0;
      charge = new Set(cut ? att : window);
    }
    chargeable.set(m.memberId, charge);
    lines.set(m.memberId, {
      memberId: m.memberId, windowDays: window.length, attendedDays: att.length, absentDays: absent,
      messCutApplied: cut, excludedDays: excluded, chargeableDays: charge.size,
      dailySharePaise: 0, overheadSharePaise: 0, sharePaise: 0,
      adminAddedPaise: Math.round(Number(m.adminAddedPaise) || 0), allMembersSharePaise: 0, totalPaise: 0,
      specialMemberPaise: Math.max(0, Math.round(Number(input.specials?.[m.memberId]?.memberPaise) || 0)),
      specialGuestPaise: Math.max(0, Math.round(Number(input.specials?.[m.memberId]?.guestPaise) || 0)),
    });
  }
  // Food-pool ('eaters') expenses: proportional share by chargeable days (after mess cut).
  // Common bill ('all_members') expenses: equal split among the monthly cohort; not mess-cut.
  let eaterTotal = 0, commonTotal = 0;
  for (const e of input.expenses) {
    if (!inMonth(e.date)) continue;
    const a = Math.round(Number(e.amountPaise) || 0);
    if (a < 0) { warnings.push(`Negative expense ${e.id ?? e.date} ignored.`); issues.push(`A negative expense on ${e.date} was ignored. Fix it in Expenses.`); continue; }
    if (expenseSplitModeOrDefault(e.splitMode) === 'all_members') commonTotal += a;
    else eaterTotal += a;
  }
  const totalChargeableDays = members.reduce((s, m) => s + (chargeable.get(m.memberId)?.size || 0), 0);
  let unallocated = 0;
  const exact = new Map<string, number>();
  if (totalChargeableDays === 0) {
    unallocated = eaterTotal;
    members.forEach(m => exact.set(m.memberId, 0));
  } else {
    for (const m of members) {
      const days = chargeable.get(m.memberId)?.size || 0;
      exact.set(m.memberId, (eaterTotal * days) / totalChargeableDays);
    }
  }
  if (unallocated > 0) warnings.push('No chargeable days: amount left unallocated for admin review.');
  const allocatable = eaterTotal - unallocated;
  const daily = allocatable, overhead = 0;
  const rounded = largestRemainder(allocatable, members.map(m => ({ key: m.memberId, v: exact.get(m.memberId)! })));
  const commonShares = members.length ? apportion(commonTotal, members.map(m => ({ key: m.memberId, weight: 1 }))) : new Map<string, number>();
  const commonUnallocated = members.length ? 0 : commonTotal;
  if (commonUnallocated > 0) warnings.push('No members this month: Common bill left unallocated for admin review.');
  const shared = allocateSharedSpecials(input.sharedSpecialCosts, input.sharedSpecialOrders, inMonth, new Set(members.map(m => m.memberId)));
  warnings.push(...shared.warnings);
  issues.push(...shared.issues);
  // Shared leftover is reported in warnings/issues, not mixed into the food-pool unallocated total
  // (save_pooling_run checks food-pool allocation separately).
  if (shared.unallocatedPaise > 0) issues.push(`Shared cost of ₹${(shared.unallocatedPaise/100).toFixed(2)} could not be charged to any member.`);
  for (const m of members) {
    const l = lines.get(m.memberId)!;
    l.sharePaise = rounded.get(m.memberId) || 0;
    l.dailySharePaise = l.sharePaise;
    l.overheadSharePaise = 0;
    l.allMembersSharePaise = commonShares.get(m.memberId) || 0;
    const specialLines = shared.byMember.get(m.memberId) || [];
    l.specialLines = specialLines.length ? specialLines : undefined;
    l.sharedSpecialPaise = specialLines.reduce((s, x) => s + x.paise, 0);
    l.specialPending = shared.pending.some(p => p.memberIds.includes(m.memberId));
    const rawTotal = l.sharePaise + l.adminAddedPaise + (l.specialMemberPaise || 0) + (l.specialGuestPaise || 0) + l.allMembersSharePaise + (l.sharedSpecialPaise || 0);
    if (rawTotal < 0) {
      warnings.push('A member\'s bill was clamped to Rs.0 because an admin deduction exceeded their unbilled share.');
      l.totalPaise = 0;
    } else l.totalPaise = rawTotal;
  }
  { const missing = Object.keys(input.specials || {}).filter(id => !lines.has(id) && ((input.specials![id].memberPaise || 0) + (input.specials![id].guestPaise || 0)) > 0).length;
    if (missing) { const tmsg = `Special item charges for ${missing} member${missing > 1 ? 's' : ''} without a membership record this month cannot be billed. Check the member list.`; warnings.push(tmsg); issues.push(tmsg); } }
  if (!operating.length && eaterTotal > 0) warnings.push('Every day of this month is marked as a holiday.');
  const emptyDays = operating.filter(date => !members.some(m => attended.get(m.memberId)?.has(date)));
  if (emptyDays.length) warnings.push(`No orders on ${emptyDays.length} day${emptyDays.length > 1 ? 's' : ''} (${emptyDays.map(x => Number(x.slice(8))).join(', ')}). If the mess was closed, mark them as holidays.`);
  return {
    year, month, periodStart: start, periodEnd: end, messCutMinDays: threshold, messCutMode: mode, operatingDays: operating,
    expenseTotalPaise: eaterTotal, allMembersExpensePaise: commonTotal, allMembersUnallocatedPaise: commonUnallocated, dailyExpensePaise: daily, overheadExpensePaise: overhead,
    allocatedPaise: allocatable, unallocatedPaise: unallocated,
    lines: members.map(m => lines.get(m.memberId)!), warnings, issues,
    pendingSharedSpecials: shared.pending,
    sharedSpecialSummaries: shared.summaries,
  };
}
