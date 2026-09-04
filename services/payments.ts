import { AppLauncher } from '@capacitor/app-launcher';
import { supabase, supabaseEnabled } from '../supabase';
import { MonthlyBill, loadAdminBills } from './monthlyBills';

export type PaymentStatus = 'unpaid' | 'pending_verification' | 'paid' | 'not_received' | 'rejected';

export interface BillPayment {
  id: string;
  bill_id: string;
  employee_id: string;
  amount: number;
  status: PaymentStatus;
  confirmed_at?: string | null;
  approved_at?: string | null;
  approved_by?: string | null;
  created_at: string;
  updated_at: string;
  payment_reference?: string | null;
  covered_through?: string | null;
  request_sequence?: number | null;
  upi_name?: string | null;
  upi_id?: string | null;
  upi_number?: string | null;
}

export interface BillPaymentSummary {
  current_total: number;
  confirmed_received: number;
  pending_amount: number;
  outstanding_balance: number;
  current_payment_id: string | null;
}

export async function loadMyBillPayments(billIds: string[]) {
  if (!supabaseEnabled || !supabase || !billIds.length) return [] as BillPayment[];
  const { data, error } = await supabase.from('bill_payments').select('*').in('bill_id', billIds).order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map((r: any) => ({ ...r, amount: Number(r.amount), request_sequence: r.request_sequence == null ? null : Number(r.request_sequence) }));
}

export async function loadBillPaymentSummary(billId: string): Promise<BillPaymentSummary> {
  if (!supabaseEnabled || !supabase) throw new Error('Supabase is not enabled.');
  const { data, error } = await supabase.rpc('get_bill_payment_summary', { p_bill_id: billId });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return { current_total: Number(row?.current_total || 0), confirmed_received: Number(row?.confirmed_received || 0), pending_amount: Number(row?.pending_amount || 0), outstanding_balance: Number(row?.outstanding_balance || 0), current_payment_id: row?.current_payment_id || null };
}

export async function confirmBillPayment(paymentId: string) {
  if (!supabaseEnabled || !supabase) throw new Error('Supabase is not enabled.');
  const { data, error } = await supabase.rpc('confirm_bill_payment', { p_payment_id: paymentId });
  if (error) throw error;
  return data as BillPayment;
}

export async function loadPaymentsForMonth(month: number, year: number) {
  if (!supabaseEnabled || !supabase) return [] as any[];
  const bills = await loadAdminBills(month, year);
  if (!bills.length) return [];
  const ids = bills.map(b => b.id);
  const { data, error } = await supabase.from('bill_payments').select('*').in('bill_id', ids).order('created_at', { ascending: false });
  if (error) throw error;
  const payments = (data || []).map((p: any) => ({ ...p, amount: Number(p.amount), request_sequence: p.request_sequence == null ? null : Number(p.request_sequence) }));
  return bills.flatMap((b: any) => payments.filter((p: any) => p.bill_id === b.id).map((p: any) => ({ ...p, monthly_bills: b })));
}

export async function approveBillPayment(paymentId: string) { return setBillPaymentStatus(paymentId, 'paid'); }

export async function setBillPaymentStatus(paymentId: string, status: 'paid' | 'not_received') {
  if (!supabaseEnabled || !supabase) throw new Error('Supabase is not enabled.');
  const { data, error } = await supabase.rpc('set_bill_payment_status', { p_payment_id: paymentId, p_status: status });
  if (error) throw error;
  return data;
}

function buildUpiTransactionReference(bill: MonthlyBill, payment: BillPayment) {
  const existing = (payment.payment_reference || '').replace(/[^A-Za-z0-9]/g, '');
  if (existing.length > 0 && existing.length <= 35) return existing;
  const month = String(bill.bill_month).padStart(2, '0');
  const paymentId = payment.id.replace(/[^A-Fa-f0-9]/g, '').slice(0, 27);
  return `GC${bill.bill_year}${month}${paymentId}`;
}

function buildUpiTransactionNote(bill: MonthlyBill, payment: BillPayment) {
  const monthName = new Date(bill.bill_year, bill.bill_month - 1, 1).toLocaleString('en-IN', { month: 'short' });
  const batch = payment.request_sequence ? ` B${payment.request_sequence}` : '';
  return `GoCanteen ${monthName} ${bill.bill_year} Bill${batch}`.slice(0, 50);
}

function encodeUpiQueryValue(value: string) { return encodeURIComponent(value); }

function validateUpiPayee(payee: string) {
  if (!payee) throw new Error('UPI payment details are not configured for this bill.');
  if (/%(?:25|40|2B|26|3D|3F|23)/i.test(payee)) throw new Error('The published UPI ID contains encoded characters and cannot be used safely. Please publish a new payment request with the correct UPI ID.');
  if (/[?#&=\s]/.test(payee) || !payee.includes('@')) throw new Error('The published UPI ID is malformed and cannot be used for payment.');
}

function validateUpiIntent(url: string, payee: string, name: string, amount: number, reference: string, note: string) {
  if (!url.startsWith('upi://pay?')) throw new Error('Invalid UPI payment URI.');
  if (url.includes('upi%3A%2F%2F') || url.includes('%2540') || url.includes('%2520')) throw new Error('The UPI payment URI is double-encoded and was blocked.');
  if (url.includes('pa=' + encodeURIComponent(payee))) throw new Error('The UPI payee ID was encoded as a query value instead of being preserved in UPI URI form.');
  if (!url.includes(`pn=${encodeUpiQueryValue(name)}`)) throw new Error('The UPI payee name was not encoded correctly.');
  if (!url.includes(`am=${amount.toFixed(2)}`)) throw new Error('The UPI payment amount is not encoded correctly.');
  if (!url.includes('cu=INR')) throw new Error('The UPI currency is invalid.');
  if (!url.includes(`tr=${reference}`)) throw new Error('The UPI transaction reference is invalid.');
  if (!url.includes(`tn=${encodeUpiQueryValue(note)}`)) throw new Error('The UPI payment note was not encoded correctly.');
}

function logUpiDiagnostics(url: string, payee: string, name: string, amount: number, reference: string, note: string) {
  if (!import.meta.env.DEV) return;
  console.debug('[GoCanteen] UPI diagnostics', { scheme: 'upi', pa: payee, pn: name, am: amount.toFixed(2), cu: 'INR', tr: reference, tn: note, uri: url, suspicious: { doubleEncodedPercent: /%25/i.test(url), encodedAt: /%40/i.test(url), plusCharacter: url.includes('+'), encodedEntireUri: /upi%3A%2F%2F/i.test(url) } });
}

export function buildUpiIntent(bill: MonthlyBill, payment: BillPayment) {
  const payee = (bill.upi_id || '').trim();
  const name = (bill.upi_name || '').trim();
  const amount = Number(payment.amount);
  validateUpiPayee(payee);
  if (!name) throw new Error('UPI payee name is not configured for this bill.');
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('No payment amount is available for this request.');
  const ref = buildUpiTransactionReference(bill, payment);
  const note = buildUpiTransactionNote(bill, payment);
  const url = `upi://pay?pa=${encodeURI(payee)}&pn=${encodeUpiQueryValue(name)}&am=${amount.toFixed(2)}&cu=INR&tr=${encodeUpiQueryValue(ref)}&tn=${encodeUpiQueryValue(note)}`;
  validateUpiIntent(url, payee, name, amount, ref, note);
  logUpiDiagnostics(url, payee, name, amount, ref, note);
  return url;
}

export async function openUpiPayment(bill: MonthlyBill, payment: BillPayment) {
  const url = buildUpiIntent(bill, payment);
  try {
    const result = await AppLauncher.openUrl({ url });
    if (result?.completed === false) throw new Error('No compatible UPI app is installed on this device.');
    return true;
  } catch (error: any) {
    if (error?.message?.includes('No compatible')) throw error;
    if (error?.message?.includes('double-encoded') || error?.message?.includes('malformed') || error?.message?.includes('encoded')) throw error;
    throw new Error('Could not open a compatible UPI payment app. Please install Google Pay, PhonePe, BHIM, or another UPI app and try again.');
  }
}
