import { supabase, supabaseEnabled } from '../supabase';

export type AIPaymentStatus = 'paid' | 'pending_verification' | 'not_received' | 'unpaid';

type BillRow = {
  id: string;
  employee_id: string;
  bill_month: number;
  bill_year: number;
  total: number;
  published: boolean;
  published_at: string | null;
  member_name_snapshot?: string | null;
};

type PaymentRow = {
  id: string;
  bill_id: string;
  employee_id: string;
  amount: number;
  status: 'unpaid' | 'pending_verification' | 'paid' | 'not_received' | 'rejected';
  confirmed_at: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
  request_sequence: number | null;
};

type ReminderRow = {
  id: string;
  bill_id: string;
  payment_id: string | null;
  employee_id: string;
  sent_at: string;
};

export interface AIPaymentMemberRow {
  employeeId: string;
  name: string;
  currentBills: number;
  currentPaid: number;
  currentPending: number;
  currentUnpaid: number;
  currentNotReceived: number;
  currentOutstanding: number;
  previousBills: number;
  previousPaid: number;
  previousPending: number;
  previousUnpaid: number;
  previousNotReceived: number;
  previousOutstanding: number;
  currentAverageDelayHours: number | null;
  previousAverageDelayHours: number | null;
  currentLatestStatus: AIPaymentStatus | null;
  previousLatestStatus: AIPaymentStatus | null;
  currentLatestPaymentAt: string | null;
  previousLatestPaymentAt: string | null;
  historicalBills: number;
  historicalUnpaid: number;
  historicalReminderFollowedSubmissions: number;
  historicalReminderFollowedVerifications: number;
  historicalPending: number;
  historicalAverageDelayHours: number | null;
  historicalDelayDirection: 'Increasing' | 'Decreasing' | 'Stable' | null;
}

export interface AIPaymentMonthSummary {
  month: string;
  bills: number;
  paid: number;
  pendingVerification: number;
  unpaid: number;
  notReceived: number;
  outstandingAmount: number;
  averageSubmissionDelayHours: number | null;
  averageVerificationDelayHours: number | null;
  averageCompletionDelayHours: number | null;
}

export interface AIPaymentReminderSummary {
  remindersSent: number;
  membersReceivedReminders: number;
  billsWithReminders: number;
  remindersFollowedBySubmission: number;
  remindersFollowedByVerification: number;
}

export interface AIPaymentBehaviour {
  currentMonth: string;
  previousMonth: string;
  historicalFromMonth: string;
  historicalToMonth: string;
  overview: {
    totalBills: number;
    paid: number;
    pendingVerification: number;
    unpaid: number;
    notReceived: number;
    outstandingAmount: number;
  };
  current: AIPaymentMonthSummary;
  previous: AIPaymentMonthSummary;
  reminder: AIPaymentReminderSummary;
  members: AIPaymentMemberRow[];
}

const monthKey = (year: number, month: number) => `${year}-${String(month).padStart(2, '0')}`;

const safeHours = (from: string | null | undefined, to: string | null | undefined): number | null => {
  if (!from || !to) return null;
  const a = new Date(from).getTime();
  const b = new Date(to).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  const hours = (b - a) / 3600000;
  return Number.isFinite(hours) && hours >= 0 ? hours : null;
};

const average = (values: number[]) => {
  const valid = values.filter(Number.isFinite);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
};

const statusForBill = (bill: BillRow, payments: PaymentRow[]): AIPaymentStatus => {
  const total = Math.max(0, Number(bill.total || 0));
  const paid = payments.filter(p => p.status === 'paid').reduce((sum, p) => sum + Math.max(0, Number(p.amount || 0)), 0);
  if (total <= paid + 0.000001) return 'paid';
  const sorted = [...payments].sort((a, b) => {
    const seq = Number(a.request_sequence || 0) - Number(b.request_sequence || 0);
    return seq || new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
  const latest = sorted[sorted.length - 1];
  if (payments.some(p => p.status === 'pending_verification')) return 'pending_verification';
  if (latest?.status === 'not_received') return 'not_received';
  return 'unpaid';
};

const latestPaymentEvent = (payments: PaymentRow[]) => {
  const timestamps = payments.flatMap(p => [p.approved_at, p.confirmed_at].filter(Boolean) as string[]);
  return timestamps.sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] || null;
};

const completionDelay = (bill: BillRow, payment: PaymentRow): number | null =>
  safeHours(bill.published_at, payment.confirmed_at && payment.approved_at ? payment.approved_at : null);

const submissionDelay = (bill: BillRow, payment: PaymentRow): number | null =>
  safeHours(bill.published_at, payment.confirmed_at);

const verificationDelay = (payment: PaymentRow): number | null =>
  safeHours(payment.confirmed_at, payment.approved_at);

const firstPaymentAfter = (billPayments: PaymentRow[], reminderAt: string, field: 'confirmed_at' | 'approved_at') => {
  const reminderMs = new Date(reminderAt).getTime();
  if (!Number.isFinite(reminderMs)) return false;
  return billPayments.some(p => {
    const value = p[field];
    if (!value) return false;
    const ms = new Date(value).getTime();
    return Number.isFinite(ms) && ms > reminderMs;
  });
};

export async function loadAIPaymentBehaviour(): Promise<AIPaymentBehaviour> {
  if (!supabaseEnabled || !supabase) throw new Error('Supabase is not enabled.');

  const { data: businessDate, error: businessDateError } = await supabase.rpc('gocanteen_business_timestamp');
  if (businessDateError) throw businessDateError;
  const dateText = String(businessDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText)) throw new Error('Could not determine the application business date.');

  const business = new Date(`${dateText}T00:00:00`);
  const currentMonth = monthKey(business.getFullYear(), business.getMonth() + 1);
  const previousDate = new Date(business.getFullYear(), business.getMonth() - 1, 1);
  const previousMonth = monthKey(previousDate.getFullYear(), previousDate.getMonth() + 1);
  const historicalStart = new Date(business.getFullYear(), business.getMonth() - 5, 1);
  const historicalFromMonth = monthKey(historicalStart.getFullYear(), historicalStart.getMonth() + 1);

  const { data: billsData, error: billsError } = await supabase
    .from('monthly_bills')
    .select('id,employee_id,bill_month,bill_year,total,published,published_at,member_name_snapshot')
    .gte('bill_year', historicalStart.getFullYear())
    .lte('bill_year', business.getFullYear());
  if (billsError) throw billsError;

  const bills = ((billsData || []) as BillRow[]).filter(b => {
    if (!b.published || !b.published_at) return false;
    const key = monthKey(Number(b.bill_year), Number(b.bill_month));
    return key >= historicalFromMonth && key <= currentMonth;
  });

  if (!bills.length) {
    const empty = (month: string): AIPaymentMonthSummary => ({
      month,
      bills: 0,
      paid: 0,
      pendingVerification: 0,
      unpaid: 0,
      notReceived: 0,
      outstandingAmount: 0,
      averageSubmissionDelayHours: null,
      averageVerificationDelayHours: null,
      averageCompletionDelayHours: null,
    });
    return {
      currentMonth,
      previousMonth,
      historicalFromMonth,
      historicalToMonth: currentMonth,
      overview: { totalBills: 0, paid: 0, pendingVerification: 0, unpaid: 0, notReceived: 0, outstandingAmount: 0 },
      current: empty(currentMonth),
      previous: empty(previousMonth),
      reminder: { remindersSent: 0, membersReceivedReminders: 0, billsWithReminders: 0, remindersFollowedBySubmission: 0, remindersFollowedByVerification: 0 },
      members: [],
    };
  }

  const billIds = bills.map(b => b.id);
  const { data: paymentsData, error: paymentsError } = await supabase
    .from('bill_payments')
    .select('id,bill_id,employee_id,amount,status,confirmed_at,approved_at,created_at,updated_at,request_sequence')
    .in('bill_id', billIds)
    .order('created_at', { ascending: true });
  if (paymentsError) throw paymentsError;

  const { data: remindersData, error: remindersError } = await supabase
    .from('payment_reminders')
    .select('id,bill_id,payment_id,employee_id,sent_at')
    .in('bill_id', billIds)
    .order('sent_at', { ascending: true });
  if (remindersError) throw remindersError;

  const payments = (paymentsData || []) as PaymentRow[];
  const reminders = (remindersData || []) as ReminderRow[];
  const paymentsByBill = new Map<string, PaymentRow[]>();
  payments.forEach(payment => {
    const rows = paymentsByBill.get(payment.bill_id) || [];
    rows.push(payment);
    paymentsByBill.set(payment.bill_id, rows);
  });
  const billsById = new Map(bills.map(b => [b.id, b]));

  const classify = (bill: BillRow) => {
    const billPayments = paymentsByBill.get(bill.id) || [];
    const status = statusForBill(bill, billPayments);
    const outstanding = Math.max(0, Number(bill.total || 0) - billPayments.filter(p => p.status === 'paid').reduce((sum, p) => sum + Math.max(0, Number(p.amount || 0)), 0));
    return { billPayments, status, outstanding };
  };

  const summaries = new Map<string, AIPaymentMonthSummary>();
  const makeSummary = (month: string): AIPaymentMonthSummary => ({
    month,
    bills: 0,
    paid: 0,
    pendingVerification: 0,
    unpaid: 0,
    notReceived: 0,
    outstandingAmount: 0,
    averageSubmissionDelayHours: null,
    averageVerificationDelayHours: null,
    averageCompletionDelayHours: null,
  });

  const delayBuckets = new Map<string, { submission: number[]; verification: number[]; completion: number[] }>();
  const getDelayBucket = (month: string) => {
    const existing = delayBuckets.get(month);
    if (existing) return existing;
    const created = { submission: [] as number[], verification: [] as number[], completion: [] as number[] };
    delayBuckets.set(month, created);
    return created;
  };

  bills.forEach(bill => {
    const month = monthKey(Number(bill.bill_year), Number(bill.bill_month));
    const summary = summaries.get(month) || makeSummary(month);
    const { billPayments, status, outstanding } = classify(bill);
    summary.bills += 1;
    summary.outstandingAmount += outstanding;
    if (status === 'paid') summary.paid += 1;
    else if (status === 'pending_verification') summary.pendingVerification += 1;
    else if (status === 'not_received') summary.notReceived += 1;
    else summary.unpaid += 1;

    const bucket = getDelayBucket(month);
    billPayments.forEach(payment => {
      const submission = submissionDelay(bill, payment);
      const verification = verificationDelay(payment);
      const completion = completionDelay(bill, payment);
      if (submission !== null) bucket.submission.push(submission);
      if (verification !== null) bucket.verification.push(verification);
      if (completion !== null) bucket.completion.push(completion);
    });
    summaries.set(month, summary);
  });

  const finalizeSummary = (month: string): AIPaymentMonthSummary => {
    const summary = summaries.get(month) || makeSummary(month);
    const bucket = delayBuckets.get(month);
    return {
      ...summary,
      outstandingAmount: Number(summary.outstandingAmount.toFixed(2)),
      averageSubmissionDelayHours: average(bucket?.submission || []),
      averageVerificationDelayHours: average(bucket?.verification || []),
      averageCompletionDelayHours: average(bucket?.completion || []),
    };
  };

  const current = finalizeSummary(currentMonth);
  const previous = finalizeSummary(previousMonth);

  const memberMap = new Map<string, AIPaymentMemberRow>();
  const ensureMember = (employeeId: string, name: string) => {
    const existing = memberMap.get(employeeId);
    if (existing) return existing;
    const row: AIPaymentMemberRow = {
      employeeId,
      name: name || 'Member',
      currentBills: 0, currentPaid: 0, currentPending: 0, currentUnpaid: 0, currentNotReceived: 0, currentOutstanding: 0,
      previousBills: 0, previousPaid: 0, previousPending: 0, previousUnpaid: 0, previousNotReceived: 0, previousOutstanding: 0,
      currentAverageDelayHours: null, previousAverageDelayHours: null,
      currentLatestStatus: null, previousLatestStatus: null,
      currentLatestPaymentAt: null, previousLatestPaymentAt: null,
      historicalBills: 0, historicalUnpaid: 0, historicalReminderFollowedSubmissions: 0, historicalReminderFollowedVerifications: 0,
      historicalPending: 0, historicalAverageDelayHours: null, historicalDelayDirection: null,
    };
    memberMap.set(employeeId, row);
    return row;
  };

  const memberDelayValues = new Map<string, { current: number[]; previous: number[]; historicalRecent: number[]; historicalEarlier: number[] }>();

  bills.forEach(bill => {
    const key = monthKey(Number(bill.bill_year), Number(bill.bill_month));
    const { billPayments, status, outstanding } = classify(bill);
    const row = ensureMember(bill.employee_id, bill.member_name_snapshot || 'Member');
    row.historicalBills += 1;
    row.historicalUnpaid += status === 'unpaid' || status === 'not_received' ? 1 : 0;
    row.historicalPending += status === 'pending_verification' ? 1 : 0;

    if (key === currentMonth) {
      row.currentBills += 1;
      row.currentOutstanding += outstanding;
      row.currentPaid += status === 'paid' ? 1 : 0;
      row.currentPending += status === 'pending_verification' ? 1 : 0;
      row.currentUnpaid += status === 'unpaid' ? 1 : 0;
      row.currentNotReceived += status === 'not_received' ? 1 : 0;
      row.currentLatestStatus = status;
      row.currentLatestPaymentAt = latestPaymentEvent(billPayments) || row.currentLatestPaymentAt;
    } else if (key === previousMonth) {
      row.previousBills += 1;
      row.previousOutstanding += outstanding;
      row.previousPaid += status === 'paid' ? 1 : 0;
      row.previousPending += status === 'pending_verification' ? 1 : 0;
      row.previousUnpaid += status === 'unpaid' ? 1 : 0;
      row.previousNotReceived += status === 'not_received' ? 1 : 0;
      row.previousLatestStatus = status;
      row.previousLatestPaymentAt = latestPaymentEvent(billPayments) || row.previousLatestPaymentAt;
    }

    const delays: number[] = [];
    billPayments.forEach(payment => {
      const delay = completionDelay(bill, payment);
      if (delay !== null) delays.push(delay);
    });
    const memberDelay = memberDelayValues.get(bill.employee_id) || { current: [], previous: [], historicalRecent: [], historicalEarlier: [] };
    if (key === currentMonth) memberDelay.current.push(...delays);
    if (key === previousMonth) memberDelay.previous.push(...delays);
    const historicalCut = monthKey(previousDate.getFullYear(), previousDate.getMonth() - 1 + 1);
    if (key >= historicalCut) memberDelay.historicalRecent.push(...delays);
    else memberDelay.historicalEarlier.push(...delays);
    memberDelayValues.set(bill.employee_id, memberDelay);
  });

  const reminderByMember = new Map<string, { submitted: number; verified: number }>();
  const remindersByBill = new Map<string, ReminderRow[]>();
  reminders.forEach(reminder => {
    const list = remindersByBill.get(reminder.bill_id) || [];
    list.push(reminder);
    remindersByBill.set(reminder.bill_id, list);
    const billPayments = paymentsByBill.get(reminder.bill_id) || [];
    const submitted = firstPaymentAfter(billPayments, reminder.sent_at, 'confirmed_at');
    const verified = firstPaymentAfter(billPayments, reminder.sent_at, 'approved_at');
    const counts = reminderByMember.get(reminder.employee_id) || { submitted: 0, verified: 0 };
    if (submitted) counts.submitted += 1;
    if (verified) counts.verified += 1;
    reminderByMember.set(reminder.employee_id, counts);
  });

  const historicalCutoff = new Date(business.getFullYear(), business.getMonth() - 2, 1);
  const historicalCutMonth = monthKey(historicalCutoff.getFullYear(), historicalCutoff.getMonth() + 1);
  memberMap.forEach(row => {
    const delays = memberDelayValues.get(row.employeeId);
    row.currentAverageDelayHours = average(delays?.current || []);
    row.previousAverageDelayHours = average(delays?.previous || []);
    row.historicalAverageDelayHours = average([...(delays?.historicalRecent || []), ...(delays?.historicalEarlier || [])]);
    const recentAverage = average(delays?.historicalRecent || []);
    const earlierAverage = average(delays?.historicalEarlier || []);
    row.historicalDelayDirection = recentAverage === null || earlierAverage === null
      ? null
      : recentAverage > earlierAverage * 1.15
        ? 'Increasing'
        : recentAverage < earlierAverage * 0.85
          ? 'Decreasing'
          : 'Stable';
    const reminderCounts = reminderByMember.get(row.employeeId);
    row.historicalReminderFollowedSubmissions = reminderCounts?.submitted || 0;
    row.historicalReminderFollowedVerifications = reminderCounts?.verified || 0;
  });

  const overview = bills.reduce((acc, bill) => {
    const { status, outstanding } = classify(bill);
    acc.totalBills += 1;
    acc.outstandingAmount += outstanding;
    if (status === 'paid') acc.paid += 1;
    else if (status === 'pending_verification') acc.pendingVerification += 1;
    else if (status === 'not_received') acc.notReceived += 1;
    else acc.unpaid += 1;
    return acc;
  }, { totalBills: 0, paid: 0, pendingVerification: 0, unpaid: 0, notReceived: 0, outstandingAmount: 0 });

  const membersReceived = new Set(reminders.map(r => r.employee_id)).size;
  const billsWithReminders = new Set(reminders.map(r => r.bill_id)).size;
  const reminder = {
    remindersSent: reminders.length,
    membersReceivedReminders: membersReceived,
    billsWithReminders,
    remindersFollowedBySubmission: reminders.filter(r => firstPaymentAfter(paymentsByBill.get(r.bill_id) || [], r.sent_at, 'confirmed_at')).length,
    remindersFollowedByVerification: reminders.filter(r => firstPaymentAfter(paymentsByBill.get(r.bill_id) || [], r.sent_at, 'approved_at')).length,
  };

  const historicalStartLabel = historicalFromMonth;
  void historicalCutMonth;
  void billsById;
  void remindersByBill;

  return {
    currentMonth,
    previousMonth,
    historicalFromMonth: historicalStartLabel,
    historicalToMonth: currentMonth,
    overview: { ...overview, outstandingAmount: Number(overview.outstandingAmount.toFixed(2)) },
    current,
    previous,
    reminder,
    members: [...memberMap.values()].sort((a, b) => a.name.localeCompare(b.name)),
  };
}
