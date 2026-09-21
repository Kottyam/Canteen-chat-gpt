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

export interface AIPaymentTiming {
  submissionCount: number;
  completionCount: number;
  averageSubmissionDelayHours: number | null;
  averageVerificationDelayHours: number | null;
  averageCompletionDelayHours: number | null;
  medianSubmissionDelayHours: number | null;
  within24Submission: number;
  after24Submission: number;
  within24Completion: number;
  after24Completion: number;
}

export interface AIPaymentMonthSummary extends AIPaymentTiming {
  month: string;
  bills: number;
  paid: number;
  pendingVerification: number;
  unpaid: number;
  notReceived: number;
  outstandingAmount: number;
}

export interface AIPaymentPeriodSummary extends AIPaymentTiming {
  key: 'current' | 'previous' | 'last3' | 'last6' | 'last12' | 'all';
  label: string;
  fromMonth: string | null;
  toMonth: string | null;
  available: boolean;
  monthsAnalysed: number;
  bills: number;
  paid: number;
  pendingVerification: number;
  unpaid: number;
  notReceived: number;
  outstandingAmount: number;
}

export interface AIPaymentMemberMonth {
  month: string;
  bills: number;
  submissionCount: number;
  averageSubmissionDelayHours: number | null;
  within24Submission: number;
  after24Submission: number;
  completionCount: number;
  averageCompletionDelayHours: number | null;
  within24Completion: number;
  after24Completion: number;
}

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
  historicalAverageDelayHours: number | null;
  historicalAverageCompletionDelayHours: number | null;
  historicalSubmissionCount: number;
  historicalCompletionCount: number;
  fastestSubmissionHours: number | null;
  slowestSubmissionHours: number | null;
  fastestCompletionHours: number | null;
  slowestCompletionHours: number | null;
  within24Submission: number;
  after24Submission: number;
  within24Completion: number;
  after24Completion: number;
  historicalDelayDirection: 'Increasing' | 'Decreasing' | 'Stable' | null;
  recentVsEarlier: {
    recentMonths: number;
    earlierMonths: number;
    recentAverageSubmissionHours: number | null;
    earlierAverageSubmissionHours: number | null;
    recentAverageCompletionHours: number | null;
    earlierAverageCompletionHours: number | null;
    recentWithin24Submission: number;
    recentAfter24Submission: number;
    earlierWithin24Submission: number;
    earlierAfter24Submission: number;
    statement: string | null;
  };
  monthlyHistory: AIPaymentMemberMonth[];
}

export interface AIPaymentObservation {
  memberName: string;
  employeeId: string;
  billMonth: string;
  billPublishedAt: string;
  paymentAt: string;
  hours: number;
  type: 'submission' | 'completion';
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
  availableMonths: string[];
  historicalMonthsAvailable: number;
  availabilityStatement: string;
  periods: {
    current: AIPaymentPeriodSummary;
    previous: AIPaymentPeriodSummary;
    last3: AIPaymentPeriodSummary;
    last6: AIPaymentPeriodSummary;
    last12: AIPaymentPeriodSummary;
    all: AIPaymentPeriodSummary;
  };
  overview: AIPaymentTiming & {
    totalBills: number;
    paid: number;
    pendingVerification: number;
    unpaid: number;
    notReceived: number;
    outstandingAmount: number;
  };
  monthlyTrend: AIPaymentMonthSummary[];
  fastestSubmission: AIPaymentObservation | null;
  slowestSubmission: AIPaymentObservation | null;
  fastestCompletion: AIPaymentObservation | null;
  slowestCompletion: AIPaymentObservation | null;
  recentVsEarlier: {
    available: boolean;
    recentMonths: number;
    earlierMonths: number;
    recentAverageSubmissionHours: number | null;
    earlierAverageSubmissionHours: number | null;
    recentAverageCompletionHours: number | null;
    earlierAverageCompletionHours: number | null;
    recentWithin24Submission: number;
    recentAfter24Submission: number;
    earlierWithin24Submission: number;
    earlierAfter24Submission: number;
    statement: string | null;
  };
  reminder: AIPaymentReminderSummary;
  members: AIPaymentMemberRow[];
}

const monthKey = (year: number, month: number) => `${year}-${String(month).padStart(2, '0')}`;
const monthParts = (key: string) => key.split('-').map(Number);
const monthOffset = (key: string, offset: number) => {
  const [year, month] = monthParts(key);
  const d = new Date(year, month - 1 + offset, 1);
  return monthKey(d.getFullYear(), d.getMonth() + 1);
};

const safeHours = (from: string | null | undefined, to: string | null | undefined): number | null => {
  if (!from || !to) return null;
  const a = new Date(from).getTime();
  const b = new Date(to).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  const hours = (b - a) / 3600000;
  return Number.isFinite(hours) && hours >= 0 ? hours : null;
};

const logAIPaymentBehaviourError = (stage: string, error: unknown) => {
  const value = error as { code?: string; message?: string; details?: string; hint?: string };
  console.error(`[AI Payment Behaviour] ${stage}`, {
    code: value?.code ?? null,
    message: value?.message ?? String(error),
    details: value?.details ?? null,
    hint: value?.hint ?? null,
  });
};

const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const median = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
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

const submissionDelay = (bill: BillRow, payment: PaymentRow) => safeHours(bill.published_at, payment.confirmed_at);
const completionDelay = (bill: BillRow, payment: PaymentRow) => safeHours(bill.published_at, payment.approved_at);
const verificationDelay = (payment: PaymentRow) => safeHours(payment.confirmed_at, payment.approved_at);

const classify24 = (hours: number | null) => hours === null ? null : hours <= 24 ? 'within' : 'after';

const emptyTiming = (): AIPaymentTiming => ({
  submissionCount: 0,
  completionCount: 0,
  averageSubmissionDelayHours: null,
  averageVerificationDelayHours: null,
  averageCompletionDelayHours: null,
  medianSubmissionDelayHours: null,
  within24Submission: 0,
  after24Submission: 0,
  within24Completion: 0,
  after24Completion: 0,
});

const emptyMonth = (month: string): AIPaymentMonthSummary => ({
  month, bills: 0, paid: 0, pendingVerification: 0, unpaid: 0, notReceived: 0, outstandingAmount: 0, ...emptyTiming()
});

const timingFrom = (submission: number[], verification: number[], completion: number[]): AIPaymentTiming => {
  const out = emptyTiming();
  out.submissionCount = submission.length;
  out.completionCount = completion.length;
  out.averageSubmissionDelayHours = average(submission);
  out.averageVerificationDelayHours = average(verification);
  out.averageCompletionDelayHours = average(completion);
  out.medianSubmissionDelayHours = median(submission);
  submission.forEach(hours => classify24(hours) === 'within' ? out.within24Submission++ : out.after24Submission++);
  completion.forEach(hours => classify24(hours) === 'within' ? out.within24Completion++ : out.after24Completion++);
  return out;
};

const addTiming = (target: AIPaymentTiming, source: AIPaymentTiming) => {
  target.submissionCount += source.submissionCount;
  target.completionCount += source.completionCount;
  target.within24Submission += source.within24Submission;
  target.after24Submission += source.after24Submission;
  target.within24Completion += source.within24Completion;
  target.after24Completion += source.after24Completion;
};

const summarizeTiming = (submission: number[], verification: number[], completion: number[]) => timingFrom(submission, verification, completion);

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

const period = (
  key: AIPaymentPeriodSummary['key'],
  label: string,
  monthKeys: string[],
  monthMap: Map<string, AIPaymentMonthSummary>,
  billCount: number,
  allBills: BillRow[],
  paymentsByBill: Map<string, PaymentRow[]>
): AIPaymentPeriodSummary => {
  const months = monthKeys.filter(m => monthMap.has(m));
  const submission: number[] = [];
  const verification: number[] = [];
  const completion: number[] = [];
  let paid = 0, pendingVerification = 0, unpaid = 0, notReceived = 0, outstandingAmount = 0;
  allBills.forEach(bill => {
    const m = monthKey(Number(bill.bill_year), Number(bill.bill_month));
    if (!monthKeys.includes(m)) return;
    const payments = paymentsByBill.get(bill.id) || [];
    const status = statusForBill(bill, payments);
    const total = Math.max(0, Number(bill.total || 0));
    const paidAmount = payments.filter(p => p.status === 'paid').reduce((sum, p) => sum + Math.max(0, Number(p.amount || 0)), 0);
    outstandingAmount += Math.max(0, total - paidAmount);
    if (status === 'paid') paid++;
    else if (status === 'pending_verification') pendingVerification++;
    else if (status === 'not_received') notReceived++;
    else unpaid++;
    payments.forEach(payment => {
      const s = submissionDelay(bill, payment);
      const v = verificationDelay(payment);
      const c = completionDelay(bill, payment);
      if (s !== null) submission.push(s);
      if (v !== null) verification.push(v);
      if (c !== null) completion.push(c);
    });
  });
  const timing = summarizeTiming(submission, verification, completion);
  return {
    key, label,
    fromMonth: months[0] || null,
    toMonth: months[months.length - 1] || null,
    available: months.length === monthKeys.length && monthKeys.length > 0,
    monthsAnalysed: months.length,
    bills: billCount,
    paid, pendingVerification, unpaid, notReceived,
    outstandingAmount: Number(outstandingAmount.toFixed(2)),
    ...timing
  };
};

export async function loadAIPaymentBehaviour(): Promise<AIPaymentBehaviour> {
  if (!supabaseEnabled || !supabase) throw new Error('Supabase is not enabled.');

  let paymentSource: {
    business_date: string;
    bills: Array<BillRow & { payments: PaymentRow[]; reminders: ReminderRow[] }>;
  };

  try {
    const { data, error } = await supabase.rpc('get_ai_payment_behaviour_data');
    if (error) {
      logAIPaymentBehaviourError('secure read RPC failed', error);
      throw error;
    }
    if (!data || typeof data !== 'object') {
      throw new Error('AI payment behaviour read returned an empty response.');
    }
    paymentSource = data as typeof paymentSource;
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error)) {
      logAIPaymentBehaviourError('secure read RPC failed', error);
    }
    throw error;
  }

  const dateText = String(paymentSource.business_date || '').slice(0, 10);
  if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(dateText)) {
    throw new Error('Could not determine the application business date.');
  }

  const business = new Date(`${dateText}T00:00:00`);
  const currentMonth = monthKey(business.getFullYear(), business.getMonth() + 1);
  const previousMonth = monthOffset(currentMonth, -1);

  const bills = (paymentSource.bills || []).map(({ payments: _payments, reminders: _reminders, ...bill }) => bill as BillRow);
  const payments = (paymentSource.bills || []).flatMap(bill => bill.payments || []) as PaymentRow[];
  const reminders = (paymentSource.bills || []).flatMap(bill => bill.reminders || []) as ReminderRow[];
  const availableMonths = [...new Set(bills.map(b => monthKey(Number(b.bill_year), Number(b.bill_month))))].sort();
  const historicalFromMonth = availableMonths[0] || currentMonth;
  const historicalToMonth = availableMonths[availableMonths.length - 1] || currentMonth;
  const availabilityStatement = `Payment behaviour analysis based on ${availableMonths.length} available month${availableMonths.length === 1 ? '' : 's'} of payment history.`;

  const emptyBehaviour = (): AIPaymentBehaviour => {
    const current = emptyMonth(currentMonth);
    const previous = emptyMonth(previousMonth);
    const emptyPeriod = (key: AIPaymentPeriodSummary['key'], label: string): AIPaymentPeriodSummary => ({
      key, label, fromMonth: null, toMonth: null, available: false, monthsAnalysed: 0, bills: 0, paid: 0, pendingVerification: 0, unpaid: 0, notReceived: 0, outstandingAmount: 0, ...emptyTiming()
    });
    return {
      currentMonth, previousMonth, historicalFromMonth, historicalToMonth, availableMonths, historicalMonthsAvailable: availableMonths.length, availabilityStatement,
      periods: {
        current: emptyPeriod('current','Current Month'), previous: emptyPeriod('previous','Previous Month'),
        last3: emptyPeriod('last3','Last 3 Months'), last6: emptyPeriod('last6','Last 6 Months'),
        last12: emptyPeriod('last12','Last 12 Months'), all: emptyPeriod('all','All Available History')
      },
      overview: { totalBills:0, paid:0, pendingVerification:0, unpaid:0, notReceived:0, outstandingAmount:0, ...emptyTiming() },
      monthlyTrend: [], fastestSubmission:null, slowestSubmission:null, fastestCompletion:null, slowestCompletion:null,
      recentVsEarlier: { available:false,recentMonths:0,earlierMonths:0,recentAverageSubmissionHours:null,earlierAverageSubmissionHours:null,recentAverageCompletionHours:null,earlierAverageCompletionHours:null,recentWithin24Submission:0,recentAfter24Submission:0,earlierWithin24Submission:0,earlierAfter24Submission:0,statement:null },
      reminder:{remindersSent:0,membersReceivedReminders:0,billsWithReminders:0,remindersFollowedBySubmission:0,remindersFollowedByVerification:0}, members:[]
    };
  };
  if (!bills.length) return emptyBehaviour();

  const paymentsByBill = new Map<string, PaymentRow[]>();
  payments.forEach(payment => {
    const rows = paymentsByBill.get(payment.bill_id) || [];
    rows.push(payment);
    paymentsByBill.set(payment.bill_id, rows);
  });

  const monthMap = new Map<string,AIPaymentMonthSummary>();
  const monthTimingValues = new Map<string,{submission:number[];verification:number[];completion:number[]}>();
  bills.forEach(bill => {
    const month = monthKey(Number(bill.bill_year),Number(bill.bill_month));
    const summary = monthMap.get(month) || emptyMonth(month);
    const billPayments = paymentsByBill.get(bill.id) || [];
    const status = statusForBill(bill,billPayments);
    const paidAmount = billPayments.filter(p=>p.status==='paid').reduce((sum,p)=>sum+Math.max(0,Number(p.amount||0)),0);
    summary.bills++;
    summary.outstandingAmount += Math.max(0,Number(bill.total||0)-paidAmount);
    if(status==='paid')summary.paid++; else if(status==='pending_verification')summary.pendingVerification++; else if(status==='not_received')summary.notReceived++; else summary.unpaid++;
    const values=monthTimingValues.get(month)||{submission:[],verification:[],completion:[]};
    billPayments.forEach(payment=>{
      const s=submissionDelay(bill,payment); const v=verificationDelay(payment); const c=completionDelay(bill,payment);
      if(s!==null)values.submission.push(s); if(v!==null)values.verification.push(v); if(c!==null)values.completion.push(c);
    });
    monthTimingValues.set(month,values); monthMap.set(month,summary);
  });
  const monthlyTrend=availableMonths.map(month=>{
    const base=monthMap.get(month)||emptyMonth(month); const v=monthTimingValues.get(month)||{submission:[],verification:[],completion:[]};
    return {...base,outstandingAmount:Number(base.outstandingAmount.toFixed(2)),...timingFrom(v.submission,v.verification,v.completion)};
  });

  const allMonthKeys = availableMonths;
  const countBills = (keys:string[]) => bills.filter(b=>keys.includes(monthKey(Number(b.bill_year),Number(b.bill_month)))).length;
  const windowKeys = (count:number) => availableMonths.length>=count ? availableMonths.slice(-count) : [];
  const currentKeys = availableMonths.includes(currentMonth)?[currentMonth]:[];
  const previousKeys = availableMonths.includes(previousMonth)?[previousMonth]:[];
  const periods = {
    current: period('current','Current Month',currentKeys,monthMap,countBills(currentKeys),bills,paymentsByBill),
    previous: period('previous','Previous Month',previousKeys,monthMap,countBills(previousKeys),bills,paymentsByBill),
    last3: period('last3','Last 3 Months',windowKeys(3),monthMap,countBills(windowKeys(3)),bills,paymentsByBill),
    last6: period('last6','Last 6 Months',windowKeys(6),monthMap,countBills(windowKeys(6)),bills,paymentsByBill),
    last12: period('last12','Last 12 Months',windowKeys(12),monthMap,countBills(windowKeys(12)),bills,paymentsByBill),
    all: period('all','All Available History',allMonthKeys,monthMap,bills.length,bills,paymentsByBill)
  };

  const allTiming = (() => {
    const submission:number[]=[]; const verification:number[]=[]; const completion:number[]=[];
    bills.forEach(bill=>(paymentsByBill.get(bill.id)||[]).forEach(payment=>{
      const s=submissionDelay(bill,payment); const v=verificationDelay(payment); const c=completionDelay(bill,payment);
      if(s!==null)submission.push(s); if(v!==null)verification.push(v); if(c!==null)completion.push(c);
    }));
    return timingFrom(submission,verification,completion);
  })();

  const observations:{submissions:AIPaymentObservation[];completions:AIPaymentObservation[]}={submissions:[],completions:[]};
  bills.forEach(bill=>{
    const memberName=bill.member_name_snapshot||'Member';
    const billMonth=monthKey(Number(bill.bill_year),Number(bill.bill_month));
    (paymentsByBill.get(bill.id)||[]).forEach(payment=>{
      const s=submissionDelay(bill,payment); const c=completionDelay(bill,payment);
      if(s!==null)observations.submissions.push({memberName,employeeId:bill.employee_id,billMonth,billPublishedAt:bill.published_at!,paymentAt:payment.confirmed_at!,hours:s,type:'submission'});
      if(c!==null)observations.completions.push({memberName,employeeId:bill.employee_id,billMonth,billPublishedAt:bill.published_at!,paymentAt:payment.approved_at!,hours:c,type:'completion'});
    });
  });
  const fastest=(rows:AIPaymentObservation[])=>rows.length?[...rows].sort((a,b)=>a.hours-b.hours)[0]:null;
  const slowest=(rows:AIPaymentObservation[])=>rows.length?[...rows].sort((a,b)=>b.hours-a.hours)[0]:null;

  const recentKeys=availableMonths.length>=6?availableMonths.slice(-3):[];
  const earlierKeys=availableMonths.length>=6?availableMonths.slice(-6,-3):[];
  const recentValues=(keys:string[])=>{
    const sub:number[]=[];const comp:number[]=[];let within=0;let after=0;
    keys.forEach(k=>{const v=monthTimingValues.get(k)||{submission:[],verification:[],completion:[]};sub.push(...v.submission);comp.push(...v.completion);v.submission.forEach(h=>classify24(h)==='within'?within++:after++)});
    return {sub,comp,within,after};
  };
  const recent=recentValues(recentKeys), earlier=recentValues(earlierKeys);
  const recentVsEarlierAvailable=recentKeys.length===3&&earlierKeys.length===3;
  const direction=(r:number|null,e:number|null):'Increasing'|'Decreasing'|'Stable'|null=>r===null||e===null?null:r>e*1.15?'Increasing':r<e*.85?'Decreasing':'Stable';
  const recentVsEarlier={
    available:recentVsEarlierAvailable,recentMonths:recentKeys.length,earlierMonths:earlierKeys.length,
    recentAverageSubmissionHours:average(recent.sub),earlierAverageSubmissionHours:average(earlier.sub),
    recentAverageCompletionHours:average(recent.comp),earlierAverageCompletionHours:average(earlier.comp),
    recentWithin24Submission:recent.within,recentAfter24Submission:recent.after,earlierWithin24Submission:earlier.within,earlierAfter24Submission:earlier.after,
    statement: recentVsEarlierAvailable
      ? `Recent 3 observed months: ${average(recent.sub)==null?'no valid submission timing':average(recent.sub)!.toFixed(1)+'h average submission'}; earlier 3 observed months: ${average(earlier.sub)==null?'no valid submission timing':average(earlier.sub)!.toFixed(1)+'h average submission'}.`
      : null
  };

  const memberMap=new Map<string,AIPaymentMemberRow>();
  const ensureMember=(employeeId:string,name:string)=>{
    const existing=memberMap.get(employeeId); if(existing)return existing;
    const row:AIPaymentMemberRow={
      employeeId,name:name||'Member',
      currentBills:0,currentPaid:0,currentPending:0,currentUnpaid:0,currentNotReceived:0,currentOutstanding:0,
      previousBills:0,previousPaid:0,previousPending:0,previousUnpaid:0,previousNotReceived:0,previousOutstanding:0,
      currentAverageDelayHours:null,previousAverageDelayHours:null,currentLatestStatus:null,previousLatestStatus:null,currentLatestPaymentAt:null,previousLatestPaymentAt:null,
      historicalBills:0,historicalUnpaid:0,historicalReminderFollowedSubmissions:0,historicalReminderFollowedVerifications:0,
      historicalAverageDelayHours:null,historicalAverageCompletionDelayHours:null,historicalSubmissionCount:0,historicalCompletionCount:0,
      fastestSubmissionHours:null,slowestSubmissionHours:null,fastestCompletionHours:null,slowestCompletionHours:null,
      within24Submission:0,after24Submission:0,within24Completion:0,after24Completion:0,historicalDelayDirection:null,
      recentVsEarlier:{recentMonths:recentKeys.length,earlierMonths:earlierKeys.length,recentAverageSubmissionHours:null,earlierAverageSubmissionHours:null,recentAverageCompletionHours:null,earlierAverageCompletionHours:null,recentWithin24Submission:0,recentAfter24Submission:0,earlierWithin24Submission:0,earlierAfter24Submission:0,statement:null},
      monthlyHistory:[]
    };
    memberMap.set(employeeId,row);return row;
  };

  bills.forEach(bill=>{
    const row=ensureMember(bill.employee_id,bill.member_name_snapshot||'Member');
    const key=monthKey(Number(bill.bill_year),Number(bill.bill_month));
    const billPayments=paymentsByBill.get(bill.id)||[];
    const status=statusForBill(bill,billPayments);
    const paidAmount=billPayments.filter(p=>p.status==='paid').reduce((sum,p)=>sum+Math.max(0,Number(p.amount||0)),0);
    const outstanding=Math.max(0,Number(bill.total||0)-paidAmount);
    row.historicalBills++;
    row.historicalUnpaid+=status==='unpaid'||status==='not_received'?1:0;
    row.currentBills+=key===currentMonth?1:0; row.previousBills+=key===previousMonth?1:0;
    if(key===currentMonth){row.currentOutstanding+=outstanding;row.currentPaid+=status==='paid'?1:0;row.currentPending+=status==='pending_verification'?1:0;row.currentUnpaid+=status==='unpaid'?1:0;row.currentNotReceived+=status==='not_received'?1:0;row.currentLatestStatus=status;row.currentLatestPaymentAt=latestPaymentEvent(billPayments)||row.currentLatestPaymentAt;}
    if(key===previousMonth){row.previousOutstanding+=outstanding;row.previousPaid+=status==='paid'?1:0;row.previousPending+=status==='pending_verification'?1:0;row.previousUnpaid+=status==='unpaid'?1:0;row.previousNotReceived+=status==='not_received'?1:0;row.previousLatestStatus=status;row.previousLatestPaymentAt=latestPaymentEvent(billPayments)||row.previousLatestPaymentAt;}
    const sub:number[]=[];const comp:number[]=[];
    billPayments.forEach(payment=>{
      const s=submissionDelay(bill,payment);const c=completionDelay(bill,payment);
      if(s!==null){sub.push(s);row.historicalSubmissionCount++;row.within24Submission+=s<=24?1:0;row.after24Submission+=s>24?1:0;}
      if(c!==null){comp.push(c);row.historicalCompletionCount++;row.within24Completion+=c<=24?1:0;row.after24Completion+=c>24?1:0;}
    });
    const existing=row.monthlyHistory.find(x=>x.month===key);
    const monthSummary=existing||{month:key,bills:0,submissionCount:0,averageSubmissionDelayHours:null,within24Submission:0,after24Submission:0,completionCount:0,averageCompletionDelayHours:null,within24Completion:0,after24Completion:0};
    monthSummary.bills++;
    const monthSubs=[...sub].filter(Number.isFinite); const monthComps=[...comp].filter(Number.isFinite);
    monthSummary.submissionCount+=monthSubs.length; monthSummary.completionCount+=monthComps.length;
    monthSummary.averageSubmissionDelayHours=monthSubs.length?average([...(existing?.averageSubmissionDelayHours==null?[]:[existing.averageSubmissionDelayHours]),...monthSubs]):monthSummary.averageSubmissionDelayHours;
    monthSummary.averageCompletionDelayHours=monthComps.length?average([...(existing?.averageCompletionDelayHours==null?[]:[existing.averageCompletionDelayHours]),...monthComps]):monthSummary.averageCompletionDelayHours;
    monthSummary.within24Submission+=monthSubs.filter(h=>h<=24).length;monthSummary.after24Submission+=monthSubs.filter(h=>h>24).length;
    monthSummary.within24Completion+=monthComps.filter(h=>h<=24).length;monthSummary.after24Completion+=monthComps.filter(h=>h>24).length;
    if(!existing)row.monthlyHistory.push(monthSummary);
  });

  const memberTimingValues=new Map<string,{sub:number[];comp:number[];recentSub:number[];earlierSub:number[];recentComp:number[];earlierComp:number[]}>();
  bills.forEach(bill=>{
    const key=monthKey(Number(bill.bill_year),Number(bill.bill_month));const row=memberMap.get(bill.employee_id)!;
    const v=memberTimingValues.get(bill.employee_id)||{sub:[],comp:[],recentSub:[],earlierSub:[],recentComp:[],earlierComp:[]};
    (paymentsByBill.get(bill.id)||[]).forEach(payment=>{
      const s=submissionDelay(bill,payment);const c=completionDelay(bill,payment);
      if(s!==null){v.sub.push(s);if(recentKeys.includes(key))v.recentSub.push(s);if(earlierKeys.includes(key))v.earlierSub.push(s);}
      if(c!==null){v.comp.push(c);if(recentKeys.includes(key))v.recentComp.push(c);if(earlierKeys.includes(key))v.earlierComp.push(c);}
    });
    memberTimingValues.set(row.employeeId,v);
  });

  const reminderByMember=new Map<string,{submitted:number;verified:number}>();
  reminders.forEach(reminder=>{
    const counts=reminderByMember.get(reminder.employee_id)||{submitted:0,verified:0};
    const billPayments=paymentsByBill.get(reminder.bill_id)||[];
    if(firstPaymentAfter(billPayments,reminder.sent_at,'confirmed_at'))counts.submitted++;
    if(firstPaymentAfter(billPayments,reminder.sent_at,'approved_at'))counts.verified++;
    reminderByMember.set(reminder.employee_id,counts);
  });

  memberMap.forEach(row=>{
    const v=memberTimingValues.get(row.employeeId)||{sub:[],comp:[],recentSub:[],earlierSub:[],recentComp:[],earlierComp:[]};
    const currentSub:number[]=[];const previousSub:number[]=[];
    bills.filter(b=>b.employee_id===row.employeeId).forEach(b=>{const k=monthKey(Number(b.bill_year),Number(b.bill_month));(paymentsByBill.get(b.id)||[]).forEach(p=>{const s=submissionDelay(b,p);if(s!==null&&(k===currentMonth))currentSub.push(s);if(s!==null&&(k===previousMonth))previousSub.push(s);});});
    row.currentAverageDelayHours=average(currentSub);row.previousAverageDelayHours=average(previousSub);
    const monthlyGroups=new Map<string,{bills:number;sub:number[];comp:number[]}>();
    bills.filter(b=>b.employee_id===row.employeeId).forEach(b=>{
      const k=monthKey(Number(b.bill_year),Number(b.bill_month));
      const g=monthlyGroups.get(k)||{bills:0,sub:[],comp:[]};
      g.bills++;
      (paymentsByBill.get(b.id)||[]).forEach(p=>{
        const s=submissionDelay(b,p);const c=completionDelay(b,p);
        if(s!==null)g.sub.push(s);if(c!==null)g.comp.push(c);
      });
      monthlyGroups.set(k,g);
    });
    row.monthlyHistory=[...monthlyGroups.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([month,g])=>({
      month,bills:g.bills,submissionCount:g.sub.length,averageSubmissionDelayHours:average(g.sub),
      within24Submission:g.sub.filter(h=>h<=24).length,after24Submission:g.sub.filter(h=>h>24).length,
      completionCount:g.comp.length,averageCompletionDelayHours:average(g.comp),
      within24Completion:g.comp.filter(h=>h<=24).length,after24Completion:g.comp.filter(h=>h>24).length
    }));
    row.historicalAverageDelayHours=average(v.sub);row.historicalAverageCompletionDelayHours=average(v.comp);
    row.fastestSubmissionHours=v.sub.length?Math.min(...v.sub):null;row.slowestSubmissionHours=v.sub.length?Math.max(...v.sub):null;
    row.fastestCompletionHours=v.comp.length?Math.min(...v.comp):null;row.slowestCompletionHours=v.comp.length?Math.max(...v.comp):null;
    row.recentVsEarlier={
      recentMonths:recentKeys.length,earlierMonths:earlierKeys.length,recentAverageSubmissionHours:average(v.recentSub),earlierAverageSubmissionHours:average(v.earlierSub),recentAverageCompletionHours:average(v.recentComp),earlierAverageCompletionHours:average(v.earlierComp),
      recentWithin24Submission:row.monthlyHistory.filter(x=>recentKeys.includes(x.month)).reduce((s,x)=>s+x.within24Submission,0),
      recentAfter24Submission:row.monthlyHistory.filter(x=>recentKeys.includes(x.month)).reduce((s,x)=>s+x.after24Submission,0),
      earlierWithin24Submission:row.monthlyHistory.filter(x=>earlierKeys.includes(x.month)).reduce((s,x)=>s+x.within24Submission,0),
      earlierAfter24Submission:row.monthlyHistory.filter(x=>earlierKeys.includes(x.month)).reduce((s,x)=>s+x.after24Submission,0),
      statement:recentVsEarlierAvailable?(`Recent observed submissions average ${average(v.recentSub)==null?'not available':average(v.recentSub)!.toFixed(1)+'h'} versus ${average(v.earlierSub)==null?'not available':average(v.earlierSub)!.toFixed(1)+'h'} in the earlier observed period.`):null
    };
    row.historicalDelayDirection=direction(average(v.recentSub),average(v.earlierSub));
    const reminderCounts=reminderByMember.get(row.employeeId);row.historicalReminderFollowedSubmissions=reminderCounts?.submitted||0;row.historicalReminderFollowedVerifications=reminderCounts?.verified||0;
    row.monthlyHistory.sort((a,b)=>a.month.localeCompare(b.month));
  });

  const overview={totalBills:periods.all.bills,paid:periods.all.paid,pendingVerification:periods.all.pendingVerification,unpaid:periods.all.unpaid,notReceived:periods.all.notReceived,outstandingAmount:periods.all.outstandingAmount,...allTiming};
  const remindersSent=reminders.length;
  const reminder={
    remindersSent,
    membersReceivedReminders:new Set(reminders.map(r=>r.employee_id)).size,
    billsWithReminders:new Set(reminders.map(r=>r.bill_id)).size,
    remindersFollowedBySubmission:reminders.filter(r=>firstPaymentAfter(paymentsByBill.get(r.bill_id)||[],r.sent_at,'confirmed_at')).length,
    remindersFollowedByVerification:reminders.filter(r=>firstPaymentAfter(paymentsByBill.get(r.bill_id)||[],r.sent_at,'approved_at')).length
  };

  return {
    currentMonth,previousMonth,historicalFromMonth,historicalToMonth,availableMonths,historicalMonthsAvailable:availableMonths.length,availabilityStatement,
    periods,overview,monthlyTrend,
    fastestSubmission:fastest(observations.submissions),slowestSubmission:slowest(observations.submissions),
    fastestCompletion:fastest(observations.completions),slowestCompletion:slowest(observations.completions),
    recentVsEarlier,reminder,members:[...memberMap.values()].sort((a,b)=>a.name.localeCompare(b.name))
  };
}
