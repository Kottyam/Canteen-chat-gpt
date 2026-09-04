import { supabase, supabaseEnabled } from '../supabase';
import { MonthlyBill, loadAdminBills } from './monthlyBills';

export type PaymentStatus = 'unpaid' | 'pending_verification' | 'paid' | 'not_received';
export interface BillPayment { id:string; bill_id:string; employee_id:string; amount:number; status:'pending_verification'|'paid'|'not_received'; confirmed_at?:string|null; approved_at?:string|null; approved_by?:string|null; created_at:string; updated_at:string; }
export interface BillPaymentSummary { current_total:number; confirmed_received:number; pending_amount:number; outstanding_balance:number; current_payment_id:string|null; }

export async function loadMyBillPayments(billIds:string[]) {
  if (!supabaseEnabled || !supabase || !billIds.length) return [] as BillPayment[];
  const { data, error } = await supabase.from('bill_payments').select('*').in('bill_id', billIds).order('created_at',{ascending:false});
  if (error) throw error;
  return (data || []).map((r:any)=>({...r, amount:Number(r.amount)}));
}

export async function loadBillPaymentSummary(billId:string):Promise<BillPaymentSummary> {
  if (!supabaseEnabled || !supabase) throw new Error('Supabase is not enabled.');
  const { data, error } = await supabase.rpc('get_bill_payment_summary',{p_bill_id:billId});
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return {
    current_total:Number(row?.current_total||0),
    confirmed_received:Number(row?.confirmed_received||0),
    pending_amount:Number(row?.pending_amount||0),
    outstanding_balance:Number(row?.outstanding_balance||0),
    current_payment_id:row?.current_payment_id||null
  };
}

export async function confirmBillPayment(bill:MonthlyBill) {
  if (!supabaseEnabled || !supabase) throw new Error('Supabase is not enabled.');
  const { data, error } = await supabase.rpc('confirm_bill_payment',{p_bill_id:bill.id});
  if (error) throw error;
  return data as BillPayment;
}

export async function loadPaymentsForMonth(month:number,year:number) {
  if (!supabaseEnabled || !supabase) return [] as any[];
  const bills = await loadAdminBills(month,year);
  if (!bills.length) return [];
  const ids = bills.map(b=>b.id);
  const { data, error } = await supabase.from('bill_payments').select('*').in('bill_id',ids).order('created_at',{ascending:false});
  if (error) throw error;
  const payments = data || [];
  return bills.map((b:any)=>{
    const rows = payments.filter((p:any)=>p.bill_id===b.id);
    const paid = rows.filter((p:any)=>p.status==='paid').reduce((sum:number,p:any)=>sum+Number(p.amount||0),0);
    const pending = rows.filter((p:any)=>p.status==='pending_verification').reduce((sum:number,p:any)=>sum+Number(p.amount||0),0);
    const balance = Math.max(Number(b.total||0)-paid,0);
    const pendingRow = rows.find((p:any)=>p.status==='pending_verification');
    const latest = pendingRow || rows.find((p:any)=>p.status==='not_received') || rows.find((p:any)=>p.status==='paid');
    const status:PaymentStatus = pendingRow ? 'pending_verification' : balance<=0 ? 'paid' : latest?.status==='not_received' ? 'not_received' : 'unpaid';
    return {
      ...(latest||{}), id:pendingRow?.id||latest?.id||`unpaid-${b.id}`, bill_id:b.id, employee_id:b.employee_id,
      amount:pendingRow ? Number(pendingRow.amount) : balance,
      status, monthly_bills:b, confirmed_received:paid, pending_amount:pending, outstanding_balance:balance,
      created_at:latest?.created_at||null, updated_at:latest?.updated_at||null
    };
  });
}

export async function approveBillPayment(paymentId:string) {
  if (!supabaseEnabled || !supabase) throw new Error('Supabase is not enabled.');
  const { data, error } = await supabase.rpc('approve_bill_payment',{p_payment_id:paymentId});
  if (error) throw error;
  return data;
}
export async function setBillPaymentStatus(paymentId:string,status:'paid'|'not_received') {
  if (!supabaseEnabled || !supabase) throw new Error('Supabase is not enabled.');
  const { data, error } = await supabase.rpc('set_bill_payment_status',{p_payment_id:paymentId,p_status:status});
  if (error) throw error;
  return data;
}

export function buildUpiIntent(bill:MonthlyBill, outstandingBalance?:number) {
  const payee=(bill.upi_id||'').trim();
  const name=(bill.upi_name||'GoCanteen').trim();
  const amount=Number(outstandingBalance ?? bill.total).toFixed(2);
  if (Number(amount)<=0) throw new Error('No additional payment is due for this bill.');
  const ref=`GoCanteen-${bill.bill_year}-${String(bill.bill_month).padStart(2,'0')}-${bill.id.slice(0,8)}`;
  if (!payee) throw new Error('UPI payment details are not configured for this bill.');
  return `upi://pay?pa=${encodeURIComponent(payee)}&pn=${encodeURIComponent(name)}&am=${encodeURIComponent(amount)}&cu=INR&tn=${encodeURIComponent(ref)}&tr=${encodeURIComponent(ref)}`;
}
