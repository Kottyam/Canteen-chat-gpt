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
//  * Mess cut (threshold 0..31, default 6): absentDays >= threshold and > 0 -> every absent day is non-chargeable (0 = any no-order day).
//              absentDays <  threshold  -> no exclusion; all window days chargeable.
//  * Expense allocation (owner-approved, t74s334): the month's total expense (all
//    expenses dated in the window) is split equally across the operating days; each
//    day's amount is shared equally among the members chargeable that day (so a cut
//    member's day is pooled by the others). The expense date within the month does
//    not change anyone's share. A running-month draft (asOf) uses only elapsed
//    operating days and expenses dated <= asOf.
//  * A day with no chargeable member, or a month with no operating days, is never
//    moved to unchargeable members: it is reported as `unallocatedPaise` for review.
//  * Special-item snapshots and Admin Added amounts are added on top (never deducted).
//  * Rounding: exact fractional shares are computed, floored to paise and the
//    remaining paise are given by largest remainder (days by date, members by memberId), so the
//    distributed total equals the allocatable expense exactly.

/** 2 = monthly total / operating days, per-day split among chargeable members (t74s334). Server rejects older. */
export const POOLING_ENGINE_VERSION = 2;

export type BillingModel = 'standard' | 'pooling';
export type BillSendMode = 'manual' | 'automatic';

export interface CanteenBillingSettings {
  billingModel: BillingModel;
  messCutMinDays: number;
  billSendMode: BillSendMode;
}

export const DEFAULT_BILLING_SETTINGS: CanteenBillingSettings = Object.freeze({
  billingModel: 'standard',
  messCutMinDays: 6,
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

/** Absent / partial rows always resolve to the existing standard behaviour. */
export function normalizeBillingSettings(row: any): CanteenBillingSettings {
  if (!row || typeof row !== 'object') return { ...DEFAULT_BILLING_SETTINGS };
  const model: BillingModel = row.billing_model === 'pooling' || row.billingModel === 'pooling' ? 'pooling' : 'standard';
  const send: BillSendMode = row.bill_send_mode === 'automatic' || row.billSendMode === 'automatic' ? 'automatic' : 'manual';
  const days = messCutDaysOrDefault(row.mess_cut_min_days ?? row.messCutMinDays);
  return { billingModel: model, messCutMinDays: days, billSendMode: send };
}

export interface PoolingExpense { id?: string; date: string; amountPaise: number }
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
  totalPaise: number;
}
export interface PoolingResult {
  year: number;
  month: number;
  periodStart: string;
  periodEnd: string;
  messCutMinDays: number;
  operatingDays: string[];
  expenseTotalPaise: number;
  dailyExpensePaise: number;
  overheadExpensePaise: number;
  allocatedPaise: number;
  unallocatedPaise: number;
  lines: PoolingLine[];
  /** Internal diagnostics (stored with the calculation; not shown in the normal bills view). */
  warnings: string[];
  /** Actionable money problems the admin must see (short). Unallocated is reported separately. */
  issues: string[];
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

export function computePoolingBills(input: PoolingInput): PoolingResult {
  const { year, month } = input;
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) throw new Error('Invalid billing month');
  const threshold = messCutDaysOrDefault(input.messCutMinDays);
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
    const cut = absent > 0 && absent >= threshold; // threshold 0: any actual no-order day is cut
    const charge = new Set(cut ? att : window);
    chargeable.set(m.memberId, charge);
    lines.set(m.memberId, {
      memberId: m.memberId, windowDays: window.length, attendedDays: att.length, absentDays: absent,
      messCutApplied: cut, excludedDays: cut ? absent : 0, chargeableDays: charge.size,
      dailySharePaise: 0, overheadSharePaise: 0, sharePaise: 0,
      adminAddedPaise: Math.max(0, Math.round(Number(m.adminAddedPaise) || 0)), totalPaise: 0,
      specialMemberPaise: Math.max(0, Math.round(Number(input.specials?.[m.memberId]?.memberPaise) || 0)),
      specialGuestPaise: Math.max(0, Math.round(Number(input.specials?.[m.memberId]?.guestPaise) || 0)),
    });
  }
  // expenses — approved method (owner t74s334): the month's TOTAL expense (dated in the window) is split
  // equally across the operating days (integer paise, largest remainder by date), and each day's amount is
  // shared equally among the members chargeable that day. The expense date inside the month does not matter.
  // A day with nobody chargeable (or a month with no operating days) is NOT moved to others: it is reported
  // as unallocated for admin review.
  let total = 0;
  for (const e of input.expenses) {
    if (!inMonth(e.date)) continue;
    const a = Math.round(Number(e.amountPaise) || 0);
    if (a < 0) { warnings.push(`Negative expense ${e.id ?? e.date} ignored.`); issues.push(`A negative expense on ${e.date} was ignored. Fix it in Expenses.`); continue; }
    total += a;
  }
  const exact = new Map<string, number>(members.map(m => [m.memberId, 0]));
  let unallocated = 0;
  const perDay = operating.length ? largestRemainder(total, operating.map(date => ({ key: date, v: total / operating.length }))) : new Map<string, number>();
  if (!operating.length) unallocated = total;
  for (const date of operating) {
    const amt = perDay.get(date) || 0; if (!amt) continue;
    const sharers = members.filter(m => chargeable.get(m.memberId)!.has(date));
    if (!sharers.length) { unallocated += amt; continue; }
    for (const m of sharers) exact.set(m.memberId, exact.get(m.memberId)! + amt / sharers.length);
  }
  if (unallocated > 0) warnings.push('Some expense days have no chargeable member: amount left unallocated for admin review.');
  const allocatable = total - unallocated;
  const daily = allocatable, overhead = 0;
  const rounded = largestRemainder(allocatable, members.map(m => ({ key: m.memberId, v: exact.get(m.memberId)! })));
  for (const m of members) {
    const l = lines.get(m.memberId)!;
    l.sharePaise = rounded.get(m.memberId) || 0;
    l.dailySharePaise = l.sharePaise;
    l.overheadSharePaise = 0;
    l.totalPaise = l.sharePaise + l.adminAddedPaise + (l.specialMemberPaise || 0) + (l.specialGuestPaise || 0);
  }
  { const missing = Object.keys(input.specials || {}).filter(id => !lines.has(id) && ((input.specials![id].memberPaise || 0) + (input.specials![id].guestPaise || 0)) > 0).length;
    if (missing) { const t = `Special item charges for ${missing} member${missing > 1 ? 's' : ''} without a membership record this month cannot be billed. Check the member list.`; warnings.push(t); issues.push(t); } }
  if (!operating.length && total > 0) warnings.push('Every day of this month is marked as a holiday.');
  const emptyDays = operating.filter(date => !members.some(m => attended.get(m.memberId)?.has(date)));
  if (emptyDays.length) warnings.push(`No orders on ${emptyDays.length} day${emptyDays.length > 1 ? 's' : ''} (${emptyDays.map(x => Number(x.slice(8))).join(', ')}). If the mess was closed, mark them as holidays.`);
  return {
    year, month, periodStart: start, periodEnd: end, messCutMinDays: threshold, operatingDays: operating,
    expenseTotalPaise: total, dailyExpensePaise: daily, overheadExpensePaise: overhead,
    allocatedPaise: allocatable, unallocatedPaise: unallocated,
    lines: members.map(m => lines.get(m.memberId)!), warnings, issues,
  };
}
