import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePoolingBills, normalizeBillingSettings, previousBillingPeriod, isCompletedPeriod, istBusinessDate, apportion, toPaise, DEFAULT_BILLING_SETTINGS } from '../supabase/functions/_shared/poolingBilling.ts';

const d = (n: number) => `2026-09-${String(n).padStart(2, '0')}`;
// Sept 2026: 30 days. Helper: member eats on given days.
const orders = (id: string, days: number[], extra: any = {}) => days.map(n => ({ memberId: id, date: d(n), status: 'active', ...extra }));
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const base = (over: any) => ({ year: 2026, month: 9, messCutMinDays: 6, expenses: [], orders: [], members: [{ memberId: 'A' }, { memberId: 'B' }], ...over });
const line = (r: any, id: string) => r.lines.find((l: any) => l.memberId === id);
const sum = (r: any) => r.lines.reduce((s: number, l: any) => s + l.sharePaise, 0);

test('defaults: absent settings row = exact standard/manual behaviour', () => {
  assert.deepEqual(normalizeBillingSettings(null), DEFAULT_BILLING_SETTINGS);
  assert.deepEqual(normalizeBillingSettings({}), { billingModel: 'standard', messCutMinDays: 6, billSendMode: 'manual' });
  assert.equal(normalizeBillingSettings({ billing_model: 'weird', bill_send_mode: 'x' }).billingModel, 'standard');
  assert.equal(normalizeBillingSettings({ billing_model: 'pooling', mess_cut_min_days: 4 }).messCutMinDays, 4);
  assert.equal(normalizeBillingSettings({ mess_cut_min_days: 0 }).messCutMinDays, 6);
});

const daily = range(1, 30).map(n => ({ date: d(n), amountPaise: 3000 }));

test('below threshold (5 absent, nonconsecutive) -> no exclusion, full equal share', () => {
  const r = computePoolingBills(base({ expenses: daily, orders: [...orders('A', range(1, 30)), ...orders('B', range(1, 30).filter(n => ![2, 9, 15, 21, 28].includes(n)))] }));
  assert.equal(line(r, 'B').absentDays, 5);
  assert.equal(line(r, 'B').messCutApplied, false);
  assert.equal(line(r, 'A').sharePaise, 45000); assert.equal(line(r, 'B').sharePaise, 45000);
});

test('equal to threshold (6 cumulative nonconsecutive) -> those days pooled among others', () => {
  const absent = [2, 5, 9, 15, 21, 28];
  const r = computePoolingBills(base({ expenses: daily, orders: [...orders('A', range(1, 30)), ...orders('B', range(1, 30).filter(n => !absent.includes(n)))] }));
  const b = line(r, 'B');
  assert.equal(b.absentDays, 6); assert.equal(b.messCutApplied, true); assert.equal(b.chargeableDays, 24);
  assert.equal(b.sharePaise, 24 * 1500);
  assert.equal(line(r, 'A').sharePaise, 24 * 1500 + 6 * 3000);
  assert.equal(sum(r), 90000);
});

test('above threshold excludes all absent days', () => {
  const r = computePoolingBills(base({ expenses: daily, orders: [...orders('A', range(1, 30)), ...orders('B', range(1, 20))] }));
  assert.equal(line(r, 'B').excludedDays, 10);
  assert.equal(line(r, 'B').sharePaise, 20 * 1500);
});

test('cancelled and guest-only orders are not attendance; duplicate orders same date count once', () => {
  const r = computePoolingBills(base({ messCutMinDays: 2, expenses: [{ date: d(1), amountPaise: 1000 }, { date: d(2), amountPaise: 1000 }],
    orders: [...orders('A', [1, 2]), ...orders('A', [1]), ...orders('B', [1], { status: 'cancelled' }), ...orders('B', [2], { guestOnly: true })] }));
  assert.equal(line(r, 'A').attendedDays, 2);
  assert.equal(line(r, 'B').absentDays, 2); assert.equal(line(r, 'B').sharePaise, 0);
  assert.equal(line(r, 'A').sharePaise, 2000);
});

test('closed days / holidays never create absences; non-operating expense = overhead by member-days', () => {
  const r = computePoolingBills(base({ messCutMinDays: 1, holidayDates: [d(3)], expenses: [{ date: d(3), amountPaise: 900 }, { date: d(4), amountPaise: 0 }],
    orders: [...orders('A', [1, 2]), ...orders('B', [1, 2, 3])] }));
  assert.deepEqual(r.operatingDays, [d(1), d(2)]);
  assert.equal(line(r, 'A').absentDays, 0);
  assert.equal(r.overheadExpensePaise, 900);
  assert.equal(line(r, 'A').sharePaise + line(r, 'B').sharePaise, 900);
});

test('no-order month: nobody charged, expense surfaced as unallocated', () => {
  const r = computePoolingBills(base({ expenses: [{ date: d(5), amountPaise: 12345 }] }));
  assert.equal(r.unallocatedPaise, 12345); assert.equal(sum(r), 0); assert.ok(r.warnings.length);
});

test('zero expense -> zero shares', () => {
  const r = computePoolingBills(base({ orders: orders('A', [1]) }));
  assert.equal(r.expenseTotalPaise, 0); assert.equal(sum(r), 0);
});

test('all members cut / no eligible chargeable days -> unallocated, cut members not charged', () => {
  const r = computePoolingBills(base({ messCutMinDays: 1, expenses: [{ date: d(10), amountPaise: 500 }], orders: [...orders('A', [1]), ...orders('B', [2])] }));
  // d10 is not operating -> overhead split over chargeable days (A:1, B:1)
  assert.equal(sum(r) + r.unallocatedPaise, 500);
  assert.equal(line(r, 'A').chargeableDays, 1);
});

test('rounding: total distributed exactly with stable largest remainder', () => {
  const r = computePoolingBills({ ...base({ members: [{ memberId: 'A' }, { memberId: 'B' }, { memberId: 'C' }] }), expenses: [{ date: d(1), amountPaise: 1000 }], orders: [...orders('A', [1]), ...orders('B', [1]), ...orders('C', [1])] });
  assert.deepEqual(r.lines.map((l: any) => l.sharePaise), [334, 333, 333]);
  const a = apportion(10, [{ key: 'x', weight: 1 }, { key: 'y', weight: 1 }, { key: 'z', weight: 1 }]);
  assert.equal([...a.values()].reduce((s, v) => s + v, 0), 10);
  assert.equal(toPaise('12.345'), 1235);
});

test('member join boundary: days before activeFrom are not absences', () => {
  const r = computePoolingBills(base({ members: [{ memberId: 'A' }, { memberId: 'B', activeFrom: d(21) }], expenses: daily, orders: [...orders('A', range(1, 30)), ...orders('B', range(21, 30))] }));
  assert.equal(line(r, 'B').absentDays, 0); assert.equal(line(r, 'B').windowDays, 10);
  assert.equal(line(r, 'B').sharePaise, 10 * 1500);
});

test('admin added amounts are member-specific, not pooled', () => {
  const r = computePoolingBills(base({ members: [{ memberId: 'A', adminAddedPaise: 250 }, { memberId: 'B' }], expenses: [{ date: d(1), amountPaise: 1000 }], orders: [...orders('A', [1]), ...orders('B', [1])] }));
  assert.equal(line(r, 'A').totalPaise, 750); assert.equal(sum(r), 1000);
});

test('IST month rollover', () => {
  assert.equal(istBusinessDate(new Date('2026-09-30T18:29:59Z')), '2026-09-30');
  assert.equal(istBusinessDate(new Date('2026-09-30T18:30:00Z')), '2026-10-01');
  assert.deepEqual(previousBillingPeriod(new Date('2026-09-30T18:30:00Z')), { year: 2026, month: 9 });
  assert.deepEqual(previousBillingPeriod(new Date('2026-09-30T18:29:00Z')), { year: 2026, month: 8 });
  assert.deepEqual(previousBillingPeriod(new Date('2027-01-01T00:00:00Z')), { year: 2026, month: 12 });
  assert.equal(isCompletedPeriod(2026, 9, new Date('2026-09-30T12:00:00Z')), false);
  assert.equal(isCompletedPeriod(2026, 9, new Date('2026-10-01T00:00:00Z')), true);
});
