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
  const others = range(3, 30);
  const r = computePoolingBills(base({ messCutMinDays: 2, expenses: [{ date: d(1), amountPaise: 1000 }, { date: d(2), amountPaise: 1000 }],
    orders: [...orders('A', [1, 2, ...others]), ...orders('A', [1]), ...orders('B', others), ...orders('B', [1], { status: 'cancelled' }), ...orders('B', [2], { guestOnly: true })] }));
  assert.equal(line(r, 'A').attendedDays, 30);
  assert.equal(line(r, 'B').absentDays, 2); assert.equal(line(r, 'B').messCutApplied, true);
  assert.equal(line(r, 'A').sharePaise, 2000); assert.equal(line(r, 'B').sharePaise, 0);
});

test('closure is NOT inferred from no orders: a day nobody ordered is a no-order day for everyone', () => {
  const r = computePoolingBills(base({ messCutMinDays: 1, expenses: [{ date: d(15), amountPaise: 600 }],
    orders: [...orders('A', range(1, 30).filter(n => n !== 15)), ...orders('B', range(1, 30).filter(n => n !== 15))] }));
  assert.equal(r.operatingDays.length, 30);
  assert.equal(line(r, 'A').absentDays, 1); assert.equal(line(r, 'A').messCutApplied, true);
  // nobody chargeable on d15 -> its expense becomes monthly overhead shared by chargeable days (29 each)
  assert.equal(line(r, 'A').sharePaise + line(r, 'B').sharePaise, 600);
  assert.ok(r.warnings.some(w => /No orders on 1 day \(15\)/.test(w)));
  assert.equal(r.warnings.filter(w => /No orders/.test(w)).length, 1); // one grouped note, not one per day
  assert.deepEqual(r.issues, []); // diagnostics only: nothing shown to the admin as an error
});

test('declared holidays / weekly offs are not no-order days; holiday expense = overhead by member-days', () => {
  const sundays = [6, 13, 20, 27];
  const work = range(1, 30).filter(n => n !== 3 && !sundays.includes(n));
  const r = computePoolingBills(base({ messCutMinDays: 1, holidayDates: [d(3)], recurringWeekdays: [0], expenses: [{ date: d(3), amountPaise: 900 }],
    orders: [...orders('A', work), ...orders('B', work)] }));
  assert.equal(r.operatingDays.length, 25);
  assert.equal(line(r, 'A').absentDays, 0); assert.equal(line(r, 'A').messCutApplied, false);
  assert.equal(r.overheadExpensePaise, 900);
  assert.equal(line(r, 'A').sharePaise, 450); assert.equal(line(r, 'B').sharePaise, 450);
});

test('no-order month: nobody charged, expense surfaced as unallocated', () => {
  const r = computePoolingBills(base({ expenses: [{ date: d(5), amountPaise: 12345 }] }));
  assert.equal(r.unallocatedPaise, 12345); assert.equal(sum(r), 0); assert.ok(r.warnings.length);
});

test('zero expense -> zero shares', () => {
  const r = computePoolingBills(base({ orders: orders('A', [1]) }));
  assert.equal(r.expenseTotalPaise, 0); assert.equal(sum(r), 0);
});

test('all members cut with zero chargeable days -> whole expense unallocated, nobody charged', () => {
  const r = computePoolingBills(base({ messCutMinDays: 6, expenses: [{ date: d(10), amountPaise: 500 }], orders: [] }));
  assert.equal(line(r, 'A').messCutApplied, true); assert.equal(line(r, 'A').chargeableDays, 0);
  assert.equal(sum(r), 0); assert.equal(r.unallocatedPaise, 500);
});

test('threshold is inclusive: default 6 no-order days triggers, 5 does not', () => {
  const mk = (absent: number) => computePoolingBills(base({ members: [{ memberId: 'A' }], expenses: daily, orders: orders('A', range(1, 30 - absent)) }));
  assert.equal(line(mk(5), 'A').messCutApplied, false); assert.equal(line(mk(5), 'A').sharePaise, 90000);
  assert.equal(line(mk(6), 'A').messCutApplied, true);
  // single member cut: their absent days have nobody chargeable -> overhead back onto their chargeable days (sole member)
  assert.equal(line(mk(6), 'A').sharePaise, 90000);
});

test('rounding: total distributed exactly with stable largest remainder', () => {
  const r = computePoolingBills({ ...base({ members: [{ memberId: 'A' }, { memberId: 'B' }, { memberId: 'C' }] }), expenses: [{ date: d(1), amountPaise: 1000 }], orders: [...orders('A', [1]), ...orders('B', [1]), ...orders('C', [1])] });
  assert.deepEqual(r.lines.map((l: any) => l.sharePaise), [334, 333, 333]);
  const a = apportion(10, [{ key: 'x', weight: 1 }, { key: 'y', weight: 1 }, { key: 'z', weight: 1 }]);
  assert.equal([...a.values()].reduce((s, v) => s + v, 0), 10);
  assert.equal(toPaise('12.345'), 1235);
});

// Owner rule t53s243: pre-join and post-exit operating days count toward the mess-cut threshold.
test('join on day 21 (20 pre-join no-order days >= 6): mess cut, only eaten days charged', () => {
  const r = computePoolingBills(base({ members: [{ memberId: 'A' }, { memberId: 'B', periods: [{ from: d(21) }] }], expenses: daily, orders: [...orders('A', range(1, 30)), ...orders('B', range(21, 30))] }));
  const b = line(r, 'B'); assert.equal(b.windowDays, 30); assert.equal(b.absentDays, 20); assert.equal(b.messCutApplied, true);
  assert.equal(b.chargeableDays, 10); assert.equal(b.sharePaise, 10 * 1500); assert.equal(sum(r), 30 * 3000);
});
test('join in the last 5 days: qualifies for mess cut', () => {
  const r = computePoolingBills(base({ members: [{ memberId: 'A' }, { memberId: 'B', periods: [{ from: d(26) }] }], expenses: daily, orders: [...orders('A', range(1, 30)), ...orders('B', range(26, 30))] }));
  assert.equal(line(r, 'B').messCutApplied, true); assert.equal(line(r, 'B').chargeableDays, 5);
});
test('join on day 4 with no other absence (3 < 6): no mess cut, full month share', () => {
  const r = computePoolingBills(base({ members: [{ memberId: 'A' }, { memberId: 'B', periods: [{ from: d(4) }] }], expenses: daily, orders: [...orders('A', range(1, 30)), ...orders('B', range(4, 30))] }));
  const b = line(r, 'B'); assert.equal(b.absentDays, 3); assert.equal(b.messCutApplied, false);
  assert.equal(b.chargeableDays, 30); assert.equal(b.sharePaise, 30 * 1500);
});
test('removed after day 27 (3 post-exit days < 6): stays billed for the month, full share', () => {
  const r = computePoolingBills(base({ members: [{ memberId: 'A' }, { memberId: 'B', periods: [{ from: '2026-01-01', to: d(27) }] }], expenses: daily, orders: [...orders('A', range(1, 30)), ...orders('B', range(1, 27))] }));
  assert.equal(line(r, 'B').messCutApplied, false); assert.equal(line(r, 'B').sharePaise, 30 * 1500);
});
test('post-exit + ordinary absence reaching 6 together: mess cut excludes all of them', () => {
  const r = computePoolingBills(base({ members: [{ memberId: 'A' }, { memberId: 'B', periods: [{ from: '2026-01-01', to: d(25) }] }], expenses: daily,
    orders: [...orders('A', range(1, 30)), ...orders('B', range(1, 25).filter(n => n !== 10))] }));
  const b = line(r, 'B'); assert.equal(b.absentDays, 6); assert.equal(b.messCutApplied, true); assert.equal(b.chargeableDays, 24);
  assert.equal(sum(r), 30 * 3000);
});
test('cohort: left before the month or joining after it is excluded; mid-month leaver kept; rejoin periods merge', () => {
  const r = computePoolingBills(base({ members: [{ memberId: 'A' }, { memberId: 'OLD', periods: [{ from: '2026-01-01', to: '2026-08-31' }] },
    { memberId: 'FUT', periods: [{ from: '2026-10-01' }] }, { memberId: 'LEFT', periods: [{ from: '2026-01-01', to: d(12) }] },
    { memberId: 'RE', periods: [{ from: '2026-01-01', to: '2026-08-15' }, { from: d(2) }] }], expenses: daily, orders: [...orders('A', range(1, 30)), ...orders('RE', range(2, 30))] }));
  assert.deepEqual(r.lines.map((l: any) => l.memberId).sort(), ['A', 'LEFT', 'RE']);
  assert.equal(line(r, 'LEFT').messCutApplied, true); // 18 post-exit days, no orders at all -> nothing charged
  assert.equal(line(r, 'RE').absentDays, 1); assert.equal(line(r, 'RE').chargeableDays, 30);
});
test('legacy activeFrom (no periods) follows the same whole-month rule', () => {
  const r = computePoolingBills(base({ members: [{ memberId: 'A' }, { memberId: 'B', activeFrom: d(4) }], expenses: daily, orders: [...orders('A', range(1, 30)), ...orders('B', range(4, 30))] }));
  assert.equal(line(r, 'B').chargeableDays, 30);
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

test('special priced items are additive: pool shares unchanged, totals add member + guest specials, unknown member warned', () => {
  const o = [...orders('A', range(1, 30)), ...orders('B', range(1, 30))];
  const plain = computePoolingBills(base({ expenses: daily, orders: o }));
  const r = computePoolingBills(base({ expenses: daily, orders: o, specials: { A: { memberPaise: 7650, guestPaise: 2550 }, Z: { memberPaise: 100, guestPaise: 0 } } }));
  assert.deepEqual(r.lines.map((l: any) => l.sharePaise), plain.lines.map((l: any) => l.sharePaise)); // never deducted from the pool
  assert.equal(sum(r) + r.unallocatedPaise, 90000);
  assert.equal(line(r, 'A').totalPaise, line(r, 'A').sharePaise + 10200);
  assert.equal(line(r, 'A').specialGuestPaise, 2550); // guest special billed to the ordering member
  assert.equal(line(r, 'B').totalPaise, line(r, 'B').sharePaise);
  assert.equal(line(r, 'B').specialMemberPaise, 0);
  assert.ok(r.warnings.some((w: string) => /Special item charges for 1 member/.test(w)));
  assert.ok(r.issues.some((w: string) => /Special item charges for 1 member/.test(w))); // money problem stays visible
  // negative/fractional garbage is sanitised to integer paise >= 0
  const g = computePoolingBills(base({ expenses: daily, orders: o, specials: { A: { memberPaise: -5, guestPaise: 10.6 } } }));
  assert.equal(line(g, 'A').specialMemberPaise, 0); assert.equal(line(g, 'A').specialGuestPaise, 11);
});
