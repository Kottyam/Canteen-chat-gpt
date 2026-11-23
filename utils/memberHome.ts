import { BUSINESS_TIME_ZONE, formatDate } from './helpers.ts';
import type { MonthlyBill } from '../services/monthlyBills';
import type { BillPayment } from '../services/payments';
import type { OrderFor } from './orderTargetDate';

export interface OrderWindowSettingsRow {
  enabled: boolean;
  start_time: string | null;
  end_time: string | null;
  order_for: OrderFor;
}

export interface CutoffBannerModel {
  tone: 'green' | 'amber' | 'neutral';
  title: string;
  subtitle: string;
}

export interface MemberBillSummaryModel {
  bill: MonthlyBill | null;
  monthTitle: string;
  displayAmount: number;
  due: number;
  pending: number;
  paid: number;
  statusText: string;
  statusTone: 'amber' | 'green' | 'neutral';
  canPayNow: boolean;
}

export interface HolidayNoticeModel {
  date: string;
  title: string;
  subtitle: string;
}

export function getIstClockParts(now: Date = new Date()): {
  date: string;
  hour: number;
  minute: number;
  second: number;
} {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const map = Object.fromEntries(parts.filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
  const rawHour = Number(map.hour || 0);
  return {
    date: `${map.year}-${map.month}-${map.day}`,
    hour: rawHour === 24 ? 0 : rawHour,
    minute: Number(map.minute || 0),
    second: Number(map.second || 0),
  };
}

export function getMemberGreeting(name: string, now: Date = new Date()): string {
  const { hour } = getIstClockParts(now);
  const salutation = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const cleanName = (name || 'Member').trim() || 'Member';
  return `${salutation}, ${cleanName}`;
}

export function formatBusinessDayHeading(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: BUSINESS_TIME_ZONE,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(now);
}

export function formatClock12h(hhmm?: string | null): string {
  if (!hhmm) return '';
  const [hStr, mStr] = String(hhmm).split(':');
  const h24 = Number(hStr);
  const m = Number(mStr);
  if (!Number.isFinite(h24) || !Number.isFinite(m)) return String(hhmm);
  const period = h24 >= 12 ? 'pm' : 'am';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

const toMinutes = (hhmm?: string | null): number | null => {
  if (!hhmm) return null;
  const [hStr, mStr] = String(hhmm).split(':');
  const h = Number(hStr);
  const m = Number(mStr);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
};

const formatRemaining = (mins: number): string => {
  if (mins <= 0) return 'Less than 1 min left to change or cancel';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h > 0 && m > 0) return `${h} hr ${m} min left to change or cancel`;
  if (h > 0) return `${h} hr left to change or cancel`;
  return `${m} min left to change or cancel`;
};

export function computeOrderCutoffBanner(
  settings: OrderWindowSettingsRow | null,
  status: { holiday: boolean; windowOpen: boolean },
  viewDay: OrderFor,
  activeOrderFor: OrderFor,
  now: Date = new Date()
): CutoffBannerModel {
  const dayCap = viewDay === 'tomorrow' ? 'Tomorrow' : 'Today';

  if (status.holiday) {
    return {
      tone: 'amber',
      title: `${dayCap} is a holiday`,
      subtitle: 'The kitchen is closed. Orders are not available.',
    };
  }

  if (viewDay !== activeOrderFor) {
    const windowRange =
      settings?.enabled && settings.start_time && settings.end_time
        ? `Order window: ${formatClock12h(settings.start_time)} – ${formatClock12h(settings.end_time)}`
        : 'Switch tab to place or cancel your active order';
    return {
      tone: 'neutral',
      title: activeOrderFor === 'tomorrow' ? 'Ordering is currently open for tomorrow' : 'Ordering is currently set for today',
      subtitle: windowRange,
    };
  }

  if (!status.windowOpen) {
    const rangeText =
      settings?.enabled && settings.start_time && settings.end_time
        ? `Order window is ${formatClock12h(settings.start_time)} – ${formatClock12h(settings.end_time)}`
        : `${dayCap}’s order window is currently closed`;
    return {
      tone: 'amber',
      title: `${dayCap}’s orders are closed`,
      subtitle: rangeText,
    };
  }

  if (settings?.enabled && settings.end_time) {
    const endMins = toMinutes(settings.end_time);
    const ist = getIstClockParts(now);
    const nowMins = ist.hour * 60 + ist.minute;
    const closeText = formatClock12h(settings.end_time);
    if (endMins !== null) {
      const remaining = endMins - nowMins;
      return {
        tone: 'green',
        title: `${dayCap}’s orders close at ${closeText}`,
        subtitle: remaining >= 0 ? formatRemaining(remaining) : 'Order window open',
      };
    }
    return {
      tone: 'green',
      title: `${dayCap}’s orders close at ${closeText}`,
      subtitle: 'You can place, change, or cancel your order before cut-off',
    };
  }

  return {
    tone: 'green',
    title: `${dayCap}’s orders are open`,
    subtitle: 'You can place, view, or cancel your order anytime',
  };
}

export function summarizeMemberBill(bills: MonthlyBill[], payments: BillPayment[]): MemberBillSummaryModel {
  if (!bills.length) {
    return {
      bill: null,
      monthTitle: 'Monthly bill',
      displayAmount: 0,
      due: 0,
      pending: 0,
      paid: 0,
      statusText: 'No bill published yet',
      statusTone: 'neutral',
      canPayNow: false,
    };
  }

  const sorted = [...bills].sort(
    (a, b) => b.bill_year - a.bill_year || b.bill_month - a.bill_month
  );

  const metrics = (b: MonthlyBill) => {
    const ps = payments.filter(p => p.bill_id === b.id);
    const due = ps
      .filter(p => p.status === 'unpaid' || p.status === 'not_received' || p.status === 'rejected')
      .reduce((s, p) => s + Number(p.amount || 0), 0);
    const pending = ps
      .filter(p => p.status === 'pending_verification' || p.status === 'not_received')
      .reduce((s, p) => s + Number(p.amount || 0), 0);
    const paid = ps
      .filter(p => p.status === 'paid')
      .reduce((s, p) => s + Number(p.amount || 0), 0);
    const hasNotReceived = ps.some(p => p.status === 'not_received');
    return { b, ps, due, pending, paid, hasNotReceived };
  };

  const withMetrics = sorted.map(metrics);
  const chosen =
    withMetrics.find(x => x.due > 0) ||
    withMetrics.find(x => x.pending > 0) ||
    withMetrics[0];

  const monthName = new Date(chosen.b.bill_year, chosen.b.bill_month - 1, 1).toLocaleString('en-IN', {
    month: 'long',
  });
  const monthTitle = `${monthName} bill`;

  if (chosen.due > 0) {
    return {
      bill: chosen.b,
      monthTitle,
      displayAmount: chosen.due,
      due: chosen.due,
      pending: chosen.pending,
      paid: chosen.paid,
      statusText: chosen.hasNotReceived
        ? 'Payment not received · pay again'
        : 'Amount due · not paid yet',
      statusTone: 'amber',
      canPayNow: true,
    };
  }

  if (chosen.pending > 0) {
    return {
      bill: chosen.b,
      monthTitle,
      displayAmount: chosen.pending,
      due: 0,
      pending: chosen.pending,
      paid: chosen.paid,
      statusText: 'Payment submitted · waiting verification',
      statusTone: 'amber',
      canPayNow: false,
    };
  }

  if (chosen.paid > 0 || (chosen.ps.length > 0 && chosen.b.total <= chosen.paid)) {
    return {
      bill: chosen.b,
      monthTitle,
      displayAmount: chosen.b.total,
      due: 0,
      pending: 0,
      paid: chosen.paid,
      statusText: 'Paid and verified',
      statusTone: 'green',
      canPayNow: false,
    };
  }

  return {
    bill: chosen.b,
    monthTitle,
    displayAmount: chosen.b.total,
    due: 0,
    pending: 0,
    paid: 0,
    statusText: 'Bill published · view details',
    statusTone: 'neutral',
    canPayNow: false,
  };
}

export function findNextHolidayNotice(
  declaredHolidays: string[],
  todayHoliday: boolean,
  tomorrowHoliday: boolean,
  now: Date = new Date()
): HolidayNoticeModel | null {
  const today = formatDate(now);
  const [y, m, d] = today.split('-').map(Number);
  const tomorrow = formatDate(new Date(Date.UTC(y, m - 1, d + 1, 12)));

  if (todayHoliday) {
    return {
      date: today,
      title: 'Holiday today',
      subtitle: 'The kitchen is closed today. Orders are not available.',
    };
  }

  const upcoming = [...new Set(declaredHolidays.map(x => String(x).slice(0, 10)).filter(x => x >= today))].sort();
  const nextDate = tomorrowHoliday ? tomorrow : upcoming[0] || null;
  if (!nextDate) return null;

  const [hy, hm, hd] = nextDate.split('-').map(Number);
  const formatted = new Intl.DateTimeFormat('en-IN', {
    timeZone: BUSINESS_TIME_ZONE,
    weekday: 'long',
    day: 'numeric',
    month: 'short',
  }).format(new Date(Date.UTC(hy, hm - 1, hd, 12)));

  return {
    date: nextDate,
    title: nextDate === tomorrow ? `Holiday tomorrow (${formatted})` : `Holiday on ${formatted}`,
    subtitle: 'The kitchen is closed that day. No orders will be taken.',
  };
}
