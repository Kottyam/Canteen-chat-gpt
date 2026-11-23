import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeOrderCutoffBanner,
  findNextHolidayNotice,
  formatClock12h,
  formatOrderDayDate,
  getMemberGreeting,
  holidayNoticeForOrderDay,
  summarizeMemberBill,
} from '../utils/memberHome.ts';

test('getMemberGreeting uses Asia/Kolkata hour buckets', () => {
  // 09:30 IST = 04:00 UTC
  assert.equal(getMemberGreeting('Arjun', new Date('2026-11-23T04:00:00Z')), 'Good morning, Arjun');
  // 14:00 IST = 08:30 UTC
  assert.equal(getMemberGreeting('Arjun', new Date('2026-11-23T08:30:00Z')), 'Good afternoon, Arjun');
  // 19:00 IST = 13:30 UTC
  assert.equal(getMemberGreeting('Arjun', new Date('2026-11-23T13:30:00Z')), 'Good evening, Arjun');
});

test('formatClock12h formats 24h strings cleanly', () => {
  assert.equal(formatClock12h('11:30'), '11:30 am');
  assert.equal(formatClock12h('00:05'), '12:05 am');
  assert.equal(formatClock12h('12:00'), '12:00 pm');
  assert.equal(formatClock12h('17:45'), '5:45 pm');
});

test('computeOrderCutoffBanner renders green countdown when open, amber when closed or holiday', () => {
  // 09:50 IST = 04:20 UTC, closes at 11:30 IST -> 1 hr 40 min left
  const openBanner = computeOrderCutoffBanner(
    { enabled: true, start_time: '06:00', end_time: '11:30', order_for: 'today' },
    { holiday: false, windowOpen: true },
    'today',
    'today',
    new Date('2026-11-23T04:20:00Z')
  );
  assert.equal(openBanner.tone, 'green');
  assert.equal(openBanner.title, 'Today’s orders close at 11:30 am');
  assert.equal(openBanner.subtitle, '1 hr 40 min left to change or cancel');

  const closedBanner = computeOrderCutoffBanner(
    { enabled: true, start_time: '06:00', end_time: '11:30', order_for: 'today' },
    { holiday: false, windowOpen: false },
    'today',
    'today',
    new Date('2026-11-23T07:00:00Z')
  );
  assert.equal(closedBanner.tone, 'amber');
  assert.equal(closedBanner.title, 'Today’s orders are closed');

  const holidayBanner = computeOrderCutoffBanner(
    { enabled: true, start_time: '06:00', end_time: '11:30', order_for: 'tomorrow' },
    { holiday: true, windowOpen: false },
    'tomorrow',
    'tomorrow',
    new Date('2026-11-23T04:20:00Z')
  );
  assert.equal(holidayBanner.tone, 'amber');
  assert.equal(holidayBanner.title, 'Tomorrow is a holiday');
});

test('summarizeMemberBill computes due, pending, and paid states from published bills and payments', () => {
  const bill: any = {
    id: 'b1',
    bill_month: 11,
    bill_year: 2026,
    total: 1240,
    published: true,
  };

  const unpaid = summarizeMemberBill([bill], [{ id: 'p1', bill_id: 'b1', amount: 1240, status: 'unpaid' } as any]);
  assert.equal(unpaid.displayAmount, 1240);
  assert.equal(unpaid.canPayNow, true);
  assert.match(unpaid.statusText, /Amount due/);

  const pending = summarizeMemberBill(
    [bill],
    [{ id: 'p1', bill_id: 'b1', amount: 1240, status: 'pending_verification' } as any]
  );
  assert.equal(pending.canPayNow, false);
  assert.match(pending.statusText, /waiting verification/i);

  const paid = summarizeMemberBill([bill], [{ id: 'p1', bill_id: 'b1', amount: 1240, status: 'paid' } as any]);
  assert.equal(paid.canPayNow, false);
  assert.match(paid.statusText, /Paid and verified/);
});

test('findNextHolidayNotice surfaces today or upcoming holiday', () => {
  const now = new Date('2026-11-23T04:20:00Z'); // 2026-11-23 IST
  const tmr = findNextHolidayNotice(['2026-11-24'], false, true, now);
  assert.ok(tmr);
  assert.match(tmr!.title, /Holiday tomorrow/);

  const today = findNextHolidayNotice([], true, false, now);
  assert.ok(today);
  assert.equal(today!.title, 'Holiday today');

  assert.equal(findNextHolidayNotice(['2026-11-20'], false, false, now), null);
});

test('formatOrderDayDate formats the IST business date compactly', () => {
  assert.equal(formatOrderDayDate('2026-11-23'), 'Mon, 23 Nov');
  assert.equal(formatOrderDayDate('2026-11-24'), 'Tue, 24 Nov');
});

test('holidayNoticeForOrderDay only describes the active order-for day', () => {
  assert.equal(holidayNoticeForOrderDay('today', false, '2026-11-23'), null);
  assert.equal(holidayNoticeForOrderDay('today', true, '2026-11-23')!.title, 'Holiday today');
  const tmr = holidayNoticeForOrderDay('tomorrow', true, '2026-11-24');
  assert.ok(tmr);
  assert.match(tmr!.title, /Holiday tomorrow \(Tuesday, 24 Nov\)/);
  assert.equal(holidayNoticeForOrderDay('tomorrow', false, '2026-11-24'), null);
});
