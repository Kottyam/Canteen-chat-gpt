// Go Canteen — Pooling (mess expense sharing) bill engine.
// Pure, dependency-free module shared by the web app (preview / manual
// publication) and the `auto-send-monthly-bills` Edge Function.
// All money is integer paise. Dates are India business dates (YYYY-MM-DD).
//
// Accounting model (documented in docs/POOLING_BILLING.md):
//  * Operating day = every day of the month that is NOT an admin-declared holiday
//    or recurring weekly off (Holiday Management). Closure is never inferred from
//    "nobody ordered": a day without orders is a no-order day for every member.
//  * A member's window = operating days between activeFrom and activeTo (inclusive).
//  * absentDays = window operating days without any consumed order of that member
//    (cumulative, need not be consecutive). Many orders on one date = 1 day.
//  * Mess cut: absentDays >= threshold  -> every absent day is non-chargeable.
//              absentDays <  threshold  -> no exclusion; all window days chargeable.
//  * Each dated expense on an operating day is split equally among members
//    chargeable on that date (so a cut member's day is pooled by the others).
//  * Expenses dated on a holiday / weekly off (e.g. bulk purchases) and dated
//    expenses on a day where nobody is chargeable are monthly overhead,
//    apportioned by chargeable member-days for the whole month.
//  * If there are no chargeable member-days at all, nothing is charged and the
//    whole amount is reported as `unallocatedPaise` (never divided by zero and
//    never charged to cut members).
//  * Rounding: exact fractional shares are computed, floored to paise and the
//    remaining paise are given by largest remainder (ties by memberId), so the
//    distributed total equals the allocatable expense exactly.

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

/** Absent / partial rows always resolve to the existing standard behaviour. */
export function normalizeBillingSettings(row: any): CanteenBillingSettings {
  if (!row || typeof row !== 'object') return { ...DEFAULT_BILLING_SETTINGS };
  const model: BillingModel = row.billing_model === 'pooling' || row.billingModel === 'pooling' ? 'pooling' : 'standard';
  const send: BillSendMode = row.bill_send_mode === 'automatic' || row.billSendMode === 'automatic' ? 'automatic' : 'manual';
  const raw = Number(row.mess_cut_min_days ?? row.messCutMinDays);
  const days = Number.isInteger(raw) && raw >= 1 && raw <= 31 ? raw : DEFAULT_BILLING_SETTINGS.messCutMinDays;
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
}
export interface PoolingLine {
  memberId: string;
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
  warnings: string[];
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
  const threshold = Math.max(1, Math.floor(Number(input.messCutMinDays) || DEFAULT_BILLING_SETTINGS.messCutMinDays));
  const start = monthStart(year, month), end = monthEnd(year, month);
  const inMonth = (d: string) => typeof d === 'string' && d >= start && d <= end;
  const warnings: string[] = [];
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
  for (const id of attended.keys()) if (!memberIds.has(id)) warnings.push(`Orders found for a member not in the member list (${id}); ignored.`);
  const operating: string[] = [];
  for (let d = 1; d <= daysInMonth(year, month); d++) {
    const date = `${year}-${pad(month)}-${pad(d)}`;
    if (holidays.has(date) || weekly.has(weekdayOf(date))) continue;
    operating.push(date);
  }
  const opSet = new Set(operating);
  // per-member chargeable dates
  const chargeable = new Map<string, Set<string>>();
  const lines = new Map<string, PoolingLine>();
  for (const m of members) {
    const from = m.activeFrom && m.activeFrom > start ? m.activeFrom : start;
    const to = m.activeTo && m.activeTo < end ? m.activeTo : end;
    const window = operating.filter(d => d >= from && d <= to);
    const mine = attended.get(m.memberId) || new Set<string>();
    const att = window.filter(d => mine.has(d));
    const absent = window.length - att.length;
    const cut = absent >= threshold;
    const charge = new Set(cut ? att : window);
    chargeable.set(m.memberId, charge);
    lines.set(m.memberId, {
      memberId: m.memberId, windowDays: window.length, attendedDays: att.length, absentDays: absent,
      messCutApplied: cut, excludedDays: cut ? absent : 0, chargeableDays: charge.size,
      dailySharePaise: 0, overheadSharePaise: 0, sharePaise: 0,
      adminAddedPaise: Math.max(0, Math.round(Number(m.adminAddedPaise) || 0)), totalPaise: 0,
    });
  }
  // expenses
  let total = 0, daily = 0, overhead = 0;
  const exact = new Map<string, number>(members.map(m => [m.memberId, 0]));
  const dailyExact = new Map<string, number>(members.map(m => [m.memberId, 0]));
  for (const e of input.expenses) {
    if (!inMonth(e.date)) continue;
    const a = Math.round(Number(e.amountPaise) || 0);
    if (a < 0) { warnings.push(`Negative expense ${e.id ?? e.date} ignored.`); continue; }
    total += a;
    const sharers = opSet.has(e.date) ? members.filter(m => chargeable.get(m.memberId)!.has(e.date)) : [];
    if (sharers.length) {
      daily += a;
      for (const m of sharers) { exact.set(m.memberId, exact.get(m.memberId)! + a / sharers.length); dailyExact.set(m.memberId, dailyExact.get(m.memberId)! + a / sharers.length); }
    } else overhead += a;
  }
  const memberDays = members.reduce((s, m) => s + chargeable.get(m.memberId)!.size, 0);
  let unallocated = 0;
  if (overhead > 0) {
    if (memberDays > 0) for (const m of members) exact.set(m.memberId, exact.get(m.memberId)! + (overhead * chargeable.get(m.memberId)!.size) / memberDays);
    else { unallocated = overhead; warnings.push('No chargeable member-days this month: expense left unallocated for admin review.'); }
  }
  const allocatable = total - unallocated;
  const rounded = largestRemainder(allocatable, members.map(m => ({ key: m.memberId, v: exact.get(m.memberId)! })));
  const dailyRounded = largestRemainder(daily, members.map(m => ({ key: m.memberId, v: dailyExact.get(m.memberId)! })));
  for (const m of members) {
    const l = lines.get(m.memberId)!;
    l.sharePaise = rounded.get(m.memberId) || 0;
    l.dailySharePaise = Math.min(l.sharePaise, dailyRounded.get(m.memberId) || 0);
    l.overheadSharePaise = l.sharePaise - l.dailySharePaise;
    l.totalPaise = l.sharePaise + l.adminAddedPaise;
  }
  if (!operating.length && total > 0) warnings.push('Every day of this month is marked as a holiday.');
  for (const date of operating) if (!members.some(m => attended.get(m.memberId)?.has(date))) { warnings.push(`No member ordered on ${date}; it is still counted as a no-order day for everyone (mark it as a holiday if the mess was closed).`); }
  return {
    year, month, periodStart: start, periodEnd: end, messCutMinDays: threshold, operatingDays: operating,
    expenseTotalPaise: total, dailyExpensePaise: daily, overheadExpensePaise: overhead,
    allocatedPaise: allocatable, unallocatedPaise: unallocated,
    lines: members.map(m => lines.get(m.memberId)!), warnings,
  };
}
