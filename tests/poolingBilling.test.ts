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
  assert.equal(normalizeBillingSettings({ mess_cut_min_days: 0 }).messCutMinDays, 0); // 0 = no minimum (valid)
  for (const bad of [-1, 32, 1.5, null, '', 'x', undefined]) assert.equal(normalizeBillingSettings({ billing_model: 'pooling', mess_cut_min_days: bad }).messCutMinDays, 6, String(bad));
  for (const ok of [0, 1, 2, 3, 10, 31]) assert.equal(normalizeBillingSettings({ mess_cut_min_days: ok }).messCutMinDays, ok);
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
  // monthly 2000 / 30 days; B (cut) is not charged on days 1-2, A takes those days alone
  assert.equal(line(r, 'A').sharePaise, 1067); assert.equal(line(r, 'B').sharePaise, 933); assert.equal(sum(r), 2000);
});

test('closure is NOT inferred from no orders: a day nobody ordered is a no-order day for everyone', () => {
  const r = computePoolingBills(base({ messCutMinDays: 1, expenses: [{ date: d(15), amountPaise: 600 }],
    orders: [...orders('A', range(1, 30).filter(n => n !== 15)), ...orders('B', range(1, 30).filter(n => n !== 15))] }));
  assert.equal(r.operatingDays.length, 30);
  assert.equal(line(r, 'A').absentDays, 1); assert.equal(line(r, 'A').messCutApplied, true);
  // monthly 600 / 30 = 20 per day; nobody chargeable on d15 -> that day's 20 is unallocated (never moved to cut members)
  assert.equal(line(r, 'A').sharePaise, 290); assert.equal(line(r, 'B').sharePaise, 290); assert.equal(r.unallocatedPaise, 20);
  assert.ok(r.warnings.some(w => /No orders on 1 day \(15\)/.test(w)));
  assert.equal(r.warnings.filter(w => /No orders/.test(w)).length, 1); // one grouped note, not one per day
  assert.deepEqual(r.issues, []); // diagnostics only: nothing shown to the admin as an error
});

test('declared holidays / weekly offs are not operating or no-order days; an expense dated on a holiday is part of the monthly total', () => {
  const sundays = [6, 13, 20, 27];
  const work = range(1, 30).filter(n => n !== 3 && !sundays.includes(n));
  const r = computePoolingBills(base({ messCutMinDays: 1, holidayDates: [d(3)], recurringWeekdays: [0], expenses: [{ date: d(3), amountPaise: 900 }],
    orders: [...orders('A', work), ...orders('B', work)] }));
  assert.equal(r.operatingDays.length, 25);
  assert.equal(line(r, 'A').absentDays, 0); assert.equal(line(r, 'A').messCutApplied, false);
  assert.equal(r.overheadExpensePaise, 0); assert.equal(r.expenseTotalPaise, 900);
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
  // sole member cut: the 6 absent days have nobody chargeable -> 6/30 of the month is unallocated (not charged)
  assert.equal(line(mk(6), 'A').sharePaise, 72000); assert.equal(mk(6).unallocatedPaise, 18000);
});

test('rounding: total distributed exactly with stable largest remainder', () => {
  const r = computePoolingBills({ ...base({ members: [{ memberId: 'A' }, { memberId: 'B' }, { memberId: 'C' }] }), expenses: [{ date: d(1), amountPaise: 1000 }], orders: [...orders('A', range(1, 30)), ...orders('B', range(1, 30)), ...orders('C', range(1, 30))] });
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
  const r = computePoolingBills(base({ members: [{ memberId: 'A', adminAddedPaise: 250 }, { memberId: 'B' }], expenses: [{ date: d(1), amountPaise: 1000 }], orders: [...orders('A', range(1, 30)), ...orders('B', range(1, 30))] }));
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

// ---- running-month draft (asOf) ----
test('asOf day 7: the 23 future days are never operating / no-order / mess-cut days', () => {
  // B ate nothing after day 7 in the full month view would be cut; as of day 7 B ate 1..5 only (2 absent < 6).
  const inp = base({ expenses: daily, orders: [...orders('A', range(1, 30)), ...orders('B', range(1, 5))] });
  const r = computePoolingBills({ ...inp, asOf: d(7) });
  assert.equal(r.periodEnd, d(7)); assert.equal(r.operatingDays.length, 7);
  assert.equal(line(r, 'B').windowDays, 7); assert.equal(line(r, 'B').absentDays, 2); assert.equal(line(r, 'B').messCutApplied, false);
  assert.equal(r.expenseTotalPaise, 7 * 3000); assert.equal(sum(r), 21000); // future expenses/orders excluded
  assert.equal(line(r, 'A').attendedDays, 7);
  const full = computePoolingBills(inp); assert.equal(line(full, 'B').messCutApplied, true); assert.equal(full.operatingDays.length, 30);
});
test('asOf: pre-join elapsed days count toward the threshold; later joiners / post-asOf exits are not counted', () => {
  const r = computePoolingBills(base({ asOf: d(10), messCutMinDays: 6, expenses: daily, orders: [...orders('A', range(1, 10)), ...orders('C', range(7, 10)), ...orders('D', range(1, 10))],
    members: [{ memberId: 'A' }, { memberId: 'C', periods: [{ from: d(7) }] }, { memberId: 'D', periods: [{ from: d(1), to: d(20) }] }, { memberId: 'F', periods: [{ from: d(15) }] }] }));
  assert.equal(line(r, 'C').absentDays, 6); assert.equal(line(r, 'C').messCutApplied, true); // 6 elapsed pre-join days
  assert.equal(line(r, 'D').absentDays, 0); // leaves on day 20: no post-exit days yet
  assert.equal(line(r, 'F'), undefined); // joins after the cutoff
  const x = computePoolingBills(base({ asOf: d(25), expenses: [], orders: orders('D', range(1, 20)), members: [{ memberId: 'D', periods: [{ from: d(1), to: d(20) }] }] }));
  assert.equal(line(x, 'D').absentDays, 5); // elapsed post-exit days 21..25 only
});
test('asOf omitted or >= month end: identical to the completed-month result', () => {
  const inp = base({ expenses: [...daily, { date: d(31 - 1), amountPaise: 777 }], orders: [...orders('A', range(1, 30)), ...orders('B', range(1, 20))], holidayDates: [d(3)], recurringWeekdays: [0] });
  const full = computePoolingBills(inp);
  assert.deepEqual(computePoolingBills({ ...inp, asOf: d(30) }), full);
  assert.deepEqual(computePoolingBills({ ...inp, asOf: '2026-10-05' }), full);
  assert.throws(() => computePoolingBills({ ...inp, asOf: '2026-08-31' }), /as-of/); assert.throws(() => computePoolingBills({ ...inp, asOf: 'x' as any }), /as-of/);
});

// ---- Approved method B (t74s334): monthly total / operating days, each day shared by members chargeable that day ----
const R3000 = 300000;
test('method B: Rs3000/30 days, A ate 1 day, B 30 -> A Rs50, B Rs2950, whatever the expense dates', () => {
  const ord = [...orders('A', [1]), ...orders('B', range(1, 30))];
  for (const expenses of [[{ date: d(1), amountPaise: R3000 }], [{ date: d(2), amountPaise: R3000 }], range(1, 30).map(n => ({ date: d(n), amountPaise: 10000 }))]) {
    const r = computePoolingBills(base({ expenses, orders: ord }));
    assert.equal(line(r, 'A').chargeableDays, 1); assert.equal(line(r, 'A').messCutApplied, true);
    assert.equal(line(r, 'A').sharePaise, 5000); assert.equal(line(r, 'B').sharePaise, 295000); assert.equal(r.unallocatedPaise, 0);
  }
});
test('method B: A ate 10 days, B 30 -> A Rs500, B Rs2500; identical monthly totals give identical shares for any dates', () => {
  const ord = [...orders('A', range(1, 10)), ...orders('B', range(1, 30))];
  const a = computePoolingBills(base({ expenses: [{ date: d(30), amountPaise: R3000 }], orders: ord }));
  assert.equal(line(a, 'A').sharePaise, 50000); assert.equal(line(a, 'B').sharePaise, 250000);
  const b = computePoolingBills(base({ expenses: [{ date: d(5), amountPaise: 100000 }, { date: d(20), amountPaise: 200000 }], orders: ord }));
  assert.deepEqual(b.lines.map((l: any) => l.sharePaise), a.lines.map((l: any) => l.sharePaise));
});
test('method B: holidays / weekly offs are excluded from the operating-day denominator', () => {
  const work = range(1, 30).filter(n => ![6, 13, 20, 27, 3].includes(n)); // 25 operating days
  const r = computePoolingBills(base({ holidayDates: [d(3)], recurringWeekdays: [0], expenses: [{ date: d(3), amountPaise: 250000 }], orders: [...orders('A', work.slice(0, 5)), ...orders('B', work)] }));
  assert.equal(r.operatingDays.length, 25); // 10000/day: A 5 days shared (5000 each), B alone on the other 20 days
  assert.equal(line(r, 'A').sharePaise, 25000); assert.equal(line(r, 'B').sharePaise, 225000);
});
test('method B: no operating days / days with nobody chargeable -> unallocated for review, never divided by zero or shifted', () => {
  const all = computePoolingBills(base({ recurringWeekdays: [0, 1, 2, 3, 4, 5, 6], expenses: [{ date: d(4), amountPaise: 777 }], orders: orders('A', [4]) }));
  assert.equal(all.operatingDays.length, 0); assert.equal(all.unallocatedPaise, 777); assert.equal(sum(all), 0);
  const gap = computePoolingBills(base({ expenses: [{ date: d(1), amountPaise: R3000 }], orders: [...orders('A', range(1, 10)), ...orders('B', range(1, 10))] }));
  assert.equal(sum(gap) + gap.unallocatedPaise, R3000); assert.equal(gap.unallocatedPaise, 200000); assert.equal(line(gap, 'A').sharePaise, 50000);
});
test('method B: odd paise are distributed exactly and deterministically (repeatable)', () => {
  const inp = base({ members: [{ memberId: 'A' }, { memberId: 'B' }, { memberId: 'C' }], expenses: [{ date: d(9), amountPaise: 100001 }], orders: [...orders('A', range(1, 30)), ...orders('B', range(1, 30)), ...orders('C', range(3, 30))] });
  const r1 = computePoolingBills(inp), r2 = computePoolingBills(JSON.parse(JSON.stringify(inp)));
  assert.equal(sum(r1) + r1.unallocatedPaise, 100001); assert.deepEqual(r1.lines, r2.lines);
  for (const l of r1.lines) assert.ok(Number.isInteger(l.sharePaise));
});
test('threshold 0 / 6 / 31: 0 cuts any actual no-order day, 31 keeps a full share with 29 absences, 6 unchanged', () => {
  const ord = [...orders('A', [1]), ...orders('B', range(1, 30))];
  const t = (n: number) => computePoolingBills(base({ messCutMinDays: n, expenses: [{ date: d(1), amountPaise: R3000 }], orders: ord }));
  assert.equal(line(t(0), 'A').messCutApplied, true); assert.equal(line(t(0), 'A').sharePaise, 5000);
  assert.equal(line(t(0), 'B').messCutApplied, false); assert.equal(line(t(0), 'B').excludedDays, 0); // nobody absent: nothing to cut
  assert.equal(line(t(6), 'A').sharePaise, 5000);
  assert.equal(line(t(31), 'A').absentDays, 29); assert.equal(line(t(31), 'A').messCutApplied, false); assert.equal(line(t(31), 'A').sharePaise, 150000);
  const one = computePoolingBills(base({ messCutMinDays: 0, expenses: [{ date: d(1), amountPaise: R3000 }], orders: [...orders('A', range(2, 30)), ...orders('B', range(1, 30))] }));
  assert.equal(line(one, 'A').excludedDays, 1); assert.equal(line(one, 'A').sharePaise, 145000);
});
test('method B with asOf: denominator = elapsed operating days, only expenses <= asOf; pre-join elapsed days count', () => {
  const r = computePoolingBills(base({ asOf: d(10), expenses: [{ date: d(2), amountPaise: 100000 }, { date: d(25), amountPaise: 999999 }],
    orders: [...orders('A', range(1, 10)), ...orders('C', range(7, 30))], members: [{ memberId: 'A' }, { memberId: 'C', periods: [{ from: d(7) }] }, { memberId: 'F', periods: [{ from: d(15) }] }] }));
  assert.equal(r.operatingDays.length, 10); assert.equal(r.expenseTotalPaise, 100000);
  assert.equal(line(r, 'C').absentDays, 6); assert.equal(line(r, 'C').chargeableDays, 4); // 6 pre-join days -> cut
  assert.equal(line(r, 'A').sharePaise, 80000); assert.equal(line(r, 'C').sharePaise, 20000); assert.equal(line(r, 'F'), undefined);
});
test('specials + admin added stay additive on top of the pool share (never deducted from expenses)', () => {
  const r = computePoolingBills(base({ members: [{ memberId: 'A', adminAddedPaise: 700 }, { memberId: 'B' }], specials: { A: { memberPaise: 300, guestPaise: 200 } },
    expenses: [{ date: d(1), amountPaise: R3000 }], orders: [...orders('A', range(1, 30)), ...orders('B', range(1, 30))] }));
  assert.equal(line(r, 'A').sharePaise, 150000); assert.equal(line(r, 'A').totalPaise, 151200); assert.equal(sum(r), R3000);
});

// ---- t73: attendance from orders made by the member OR by an admin on their behalf (real loader) ----
import { loadPoolingInput } from '../supabase/functions/_shared/poolingInputs.ts';
function fakeDb(tables: Record<string, any[]>) {
  return { from(t: string) { const q: any = { select: () => q, eq: () => q, gte: () => q, lte: () => q, then: (res: any) => res({ data: tables[t] || [], error: null }) }; return q; } };
}
const prof = (id: string) => ({ id, full_name: id, role: 'employee', status: 'active', created_at: '2026-01-01T00:00:00Z' });
async function load(orders: any[]) {
  const db = fakeDb({ expenses: [{ id: 'e', expense_date: d(1), amount: 3000 }], orders, profiles: [prof('A'), prof('B')], holiday_dates: [], holiday_settings: [], employee_adjustments: [],
    pooling_member_periods: [{ employee_id: 'A', joined_on: '2026-01-01', left_on: null }, { employee_id: 'B', joined_on: '2026-01-01', left_on: null }] });
  const inp = await loadPoolingInput(db, { canteenId: 'c', year: 2026, month: 9, messCutMinDays: 6 }); return { inp, r: computePoolingBills(inp) };
}
const bFull = range(1, 30).map(n => ({ id: `b${n}`, employee_id: 'B', ordered_for: d(n), status: 'active', order_items: [{ item_source: 'employee', quantity: 1 }] }));
test('attendance: an admin-placed order counts exactly like the member\'s own order', async () => {
  const self = await load([...bFull, { id: 'a', employee_id: 'A', ordered_for: d(3), status: 'active', order_source: 'employee', order_items: [{ item_source: 'employee', quantity: 1 }] }]);
  const admin = await load([...bFull, { id: 'a', employee_id: 'A', ordered_for: d(3), status: 'active', order_source: 'admin', order_items: [{ item_source: 'admin', quantity: 1 }] }]);
  assert.equal(line(admin.r, 'A').attendedDays, 1); assert.deepEqual(admin.r.lines, self.r.lines); assert.equal(line(admin.r, 'A').sharePaise, 5000);
});
test('attendance: a cancelled order is no attendance and no charge', async () => {
  const { r } = await load([...bFull, { id: 'a', employee_id: 'A', ordered_for: d(3), status: 'cancelled', order_items: [{ item_source: 'admin', quantity: 1, pooling_special: true, pooling_special_unit_paise: 900 }] }]);
  assert.equal(line(r, 'A').attendedDays, 0); assert.equal(line(r, 'A').sharePaise, 0); assert.equal(line(r, 'A').specialMemberPaise, 0);
});
test('attendance: guest-only order is not member attendance; guest specials charged to the ordering member', async () => {
  const { r } = await load([...bFull, { id: 'a', employee_id: 'A', ordered_for: d(3), status: 'active', order_items: [{ item_source: 'guest', quantity: 2, pooling_special: true, pooling_special_unit_paise: 500 }] }]);
  assert.equal(line(r, 'A').attendedDays, 0); assert.equal(line(r, 'A').specialGuestPaise, 1000); assert.equal(line(r, 'A').totalPaise, 1000);
});
test('attendance: mixed member+guest items = 1 day; member and guest specials both billed to the member (not the admin)', async () => {
  const { r } = await load([...bFull, { id: 'a', employee_id: 'A', ordered_for: d(3), status: 'active', order_source: 'admin', order_items: [{ item_source: 'admin', quantity: 1, pooling_special: true, pooling_special_unit_paise: 300 }, { item_source: 'guest', quantity: 1, pooling_special: true, pooling_special_unit_paise: 400 }] }, { id: 'a2', employee_id: 'A', ordered_for: d(3), status: 'active', order_items: [{ item_source: 'employee', quantity: 1 }] }]);
  assert.equal(line(r, 'A').attendedDays, 1); assert.equal(line(r, 'A').specialMemberPaise, 300); assert.equal(line(r, 'A').specialGuestPaise, 400);
  assert.deepEqual(r.lines.map((l: any) => l.memberId).sort(), ['A', 'B']);
});
test('attendance: an order with no items is excluded', async () => {
  const { r } = await load([...bFull, { id: 'a', employee_id: 'A', ordered_for: d(3), status: 'active', order_items: [] }]);
  assert.equal(line(r, 'A').attendedDays, 0); assert.equal(line(r, 'A').sharePaise, 0);
});

test('negative admin-added deducts only that member by exactly 20; others unchanged', () => {
  const r = computePoolingBills(base({
    expenses: [{ date: d(1), amountPaise: 10000 }],
    orders: [...orders('A', [1]), ...orders('B', [1])],
    members: [{ memberId: 'A', adminAddedPaise: -2000 }, { memberId: 'B' }],
  }));
  assert.equal(line(r, 'A').sharePaise, 5000);
  assert.equal(line(r, 'A').adminAddedPaise, -2000);
  assert.equal(line(r, 'A').totalPaise, 3000);
  assert.equal(line(r, 'B').adminAddedPaise, 0);
  assert.equal(line(r, 'B').totalPaise, line(r, 'B').sharePaise);
});

test('positive admin-added still increases only that member', () => {
  const r = computePoolingBills(base({
    expenses: [{ date: d(1), amountPaise: 10000 }],
    orders: [...orders('A', [1]), ...orders('B', [1])],
    members: [{ memberId: 'A', adminAddedPaise: 2000 }, { memberId: 'B' }],
  }));
  assert.equal(line(r, 'A').totalPaise, line(r, 'A').sharePaise + 2000);
  assert.equal(line(r, 'B').totalPaise, line(r, 'B').sharePaise);
});

test('admin deduction larger than the member share clamps the bill total at 0', () => {
  const r = computePoolingBills(base({
    expenses: [{ date: d(1), amountPaise: 10000 }],
    orders: [...orders('A', [1]), ...orders('B', [1])],
    members: [{ memberId: 'A', adminAddedPaise: -99999 }, { memberId: 'B' }],
  }));
  assert.equal(line(r, 'A').totalPaise, 0);
  assert.ok(r.warnings.some((w: string) => /clamped/i.test(w)));
  assert.equal(line(r, 'B').totalPaise, line(r, 'B').sharePaise);
});

