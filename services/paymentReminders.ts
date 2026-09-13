import { supabase, supabaseEnabled } from '../supabase';
import { notifyEmployee } from './notifications';

export interface PaymentReminderRow {
  id: string;
  bill_id: string;
  payment_id: string | null;
  employee_id: string;
  canteen_id: string;
  sent_at: string;
}

export async function loadPaymentReminderCounts(billIds: string[]): Promise<Record<string, number>> {
  if (!supabaseEnabled || !supabase || !billIds.length) return {};
  const { data, error } = await supabase
    .from('payment_reminders')
    .select('bill_id')
    .in('bill_id', billIds);
  if (error) throw error;
  return (data || []).reduce<Record<string, number>>((counts, row: any) => {
    counts[row.bill_id] = (counts[row.bill_id] || 0) + 1;
    return counts;
  }, {});
}

export async function sendPaymentReminder(
  billId: string,
  paymentId: string,
  employeeId: string,
  memberName: string,
  amount: number,
) {
  if (!supabaseEnabled || !supabase) throw new Error('Supabase is not enabled.');

  const eventKey = `payment_reminder:${billId}:${paymentId}:${crypto.randomUUID()}`;
  await notifyEmployee(
    employeeId,
    'Payment Reminder',
    `Your GoCanteen bill has a pending payment of ₹${Number(amount).toFixed(2)}. Please complete the payment when convenient.`,
    'payment_reminder',
    { bill_id: billId, payment_id: paymentId, event_key: eventKey },
  );

  const { data, error } = await supabase
    .from('payment_reminders')
    .insert({
      bill_id: billId,
      payment_id: paymentId,
      employee_id: employeeId,
      canteen_id: (await supabase.from('bill_payments').select('canteen_id').eq('id', paymentId).single()).data?.canteen_id,
    })
    .select('id,bill_id,payment_id,employee_id,canteen_id,sent_at')
    .single();
  if (error || !data) throw error || new Error(`Could not persist the reminder for ${memberName || 'this member'}.`);
  return data as PaymentReminderRow;
}
