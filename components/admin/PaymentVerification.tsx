import React, { useEffect, useMemo, useState } from 'react';
import { loadPaymentsForMonth, setBillPaymentStatus } from '../../services/payments';
import { billMemberDisplayName, billMemberDisplayMobile } from '../../services/monthlyBills';
import { loadPaymentReminderCounts, sendPaymentReminder } from '../../services/paymentReminders';
import { supabase } from '../../supabase';
import AsyncActionButton from '../common/AsyncActionButton';

const reminderLabel = (count: number) => {
  if (count === 1) return 'One Reminder Sent';
  if (count === 2) return 'Two Reminders Sent';
  if (count === 3) return 'Three Reminders Sent';
  return `${count} Reminders Sent`;
};

const PaymentVerification: React.FC = () => {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [rows, setRows] = useState<any[]>([]);
  const [reminderCounts, setReminderCounts] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    try {
      const payments = await loadPaymentsForMonth(month, year);
      setRows(payments);
      setReminderCounts(await loadPaymentReminderCounts([...new Set(payments.map((p: any) => p.bill_id).filter(Boolean))]));
    } catch (e) {
      console.warn('Could not load payment verification.', e);
      setRows([]);
      setReminderCounts({});
    }
  };

  useEffect(() => {
    void load();
    const refresh = () => void load();
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    let channel: any = null;
    if (supabase) {
      channel = supabase
        .channel('gocanteen-payment-verification-sync')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'bill_payments' }, refresh)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'payment_reminders' }, refresh)
        .subscribe();
    }
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
      if (channel) supabase?.removeChannel(channel);
    };
  }, [month, year]);

  const months = useMemo(
    () =>
      Array.from({ length: 12 }, (_, i) => {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        return { month: d.getMonth() + 1, year: d.getFullYear(), label: d.toLocaleString('en-IN', { month: 'long', year: 'numeric' }) };
      }),
    [],
  );

  const setStatus = async (id: string, status: 'paid' | 'not_received') => {
    if (busy || !window.confirm(status === 'paid' ? 'Mark this payment as paid?' : 'Confirm that this payment was not received?')) return;
    setBusy(id);
    try {
      const updated = await setBillPaymentStatus(id, status);
      setRows(prev => prev.map(row => (row.id === id ? { ...row, ...updated } : row)));
    } catch (e: any) {
      alert(e?.message || 'Could not update payment status.');
    } finally {
      setBusy(null);
    }
  };

  const sendReminder = async (bill: any, payment: any, pendingAmount: number) => {
    if (busy || pendingAmount <= 0) return;
    setBusy(`reminder:${bill.id}`);
    try {
      await sendPaymentReminder(bill.id, payment.id, bill.employee_id, bill.canteen_id, billMemberDisplayName(bill), pendingAmount);
      setReminderCounts(prev => ({ ...prev, [bill.id]: (prev[bill.id] || 0) + 1 }));
    } catch (e: any) {
      alert(e?.message || 'Could not send payment reminder. The reminder count was not changed.');
    } finally {
      setBusy(null);
    }
  };

  const groups = useMemo(() => {
    const m = new Map<string, any[]>();
    rows.forEach(r => {
      const a = m.get(r.bill_id) || [];
      a.push(r);
      m.set(r.bill_id, a);
    });
    return Array.from(m.values());
  }, [rows]);

  return (
    <section className="mt-6 rounded-xl border bg-white p-4">
      <div>
        <h4 className="text-xl font-bold text-gray-800">Payment Verification</h4>
        <p className="mt-1 text-sm text-gray-500">Each Publish/Re-Publish payment request is shown as a separate batch.</p>
      </div>
      <div className="mt-4">
        <select
          value={`${year}-${month}`}
          onChange={e => {
            const [y, m] = e.target.value.split('-').map(Number);
            setYear(y);
            setMonth(m);
          }}
          className="w-full rounded-lg border px-3 py-2.5"
        >
          <option value={`${now.getFullYear()}-${now.getMonth() + 1}`}>{now.toLocaleString('en-IN', { month: 'long', year: 'numeric' })}</option>
          {months.filter(m => !(m.month === now.getMonth() + 1 && m.year === now.getFullYear())).map(m => (
            <option key={`${m.year}-${m.month}`} value={`${m.year}-${m.month}`}>{m.label}</option>
          ))}
        </select>
      </div>
      {!groups.length ? (
        <p className="mt-4 rounded-lg bg-gray-50 p-4 text-sm text-gray-500">No payment batches for this month.</p>
      ) : (
        <div className="mt-4 space-y-5">
          {groups.map(batchRows => {
            const sortedRows = [...batchRows].sort((x: any, y: any) => (x.request_sequence || 0) - (y.request_sequence || 0) || new Date(x.created_at).getTime() - new Date(y.created_at).getTime());
            const b = sortedRows[0].monthly_bills || {};
            const received = sortedRows.filter((p: any) => p.status === 'paid').reduce((s: number, p: any) => s + Number(p.amount || 0), 0);
            const pending = Math.max(Number(b.total || 0) - received, 0);
            const fullyPaid = Number(b.total || 0) > 0 && pending <= 0;
            const latest = sortedRows[sortedRows.length - 1];
            const currentPaymentAwaitingVerification = latest?.status === 'pending_verification';
            const reminderEligible = !fullyPaid && !currentPaymentAwaitingVerification && ['unpaid', 'not_received', 'rejected'].includes(latest?.status);
            const name = billMemberDisplayName(b);
            const mobile = billMemberDisplayMobile(b);
            const reminderCount = reminderCounts[b.id] || 0;

            return (
              <div key={b.id} className="rounded-xl border p-4">
                <div className="flex flex-wrap justify-between gap-3">
                  <div>
                    <div className="font-bold text-gray-800">{name}</div>
                    {mobile && <div className="text-sm text-gray-500">Mobile: {mobile}</div>}
                    <div className="text-sm text-gray-500">{new Date(b.bill_year, b.bill_month - 1, 1).toLocaleString('en-IN', { month: 'long', year: 'numeric' })}</div>
                    {reminderCount > 0 && <div className="mt-2 text-xs font-semibold text-primary-700">{reminderLabel(reminderCount)}</div>}
                  </div>
                  <div className="text-right">
                    <div className="text-xs font-semibold text-gray-500">Bill Amount</div>
                    <div className="text-lg font-bold">₹{Number(b.total || 0).toFixed(2)}</div>
                    <div className="text-sm">Received ₹{received.toFixed(2)} · Pending ₹{pending.toFixed(2)}</div>
                    <div className={`text-xs font-semibold ${fullyPaid ? 'text-green-700' : 'text-amber-700'}`}>{fullyPaid ? 'Paid' : 'Pending'}</div>
                  </div>
                </div>

                <div className="mt-4 space-y-3">
                  {sortedRows.map((p: any, i: number) => {
                    const isLatest = p.id === latest.id;
                    const showReminder = isLatest && reminderEligible && pending > 0;
                    return (
                      <div key={p.id} className="rounded-xl bg-gray-50 p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="font-bold">Payment Batch #{p.request_sequence || i + 1}</div>
                            <div className="text-xs text-gray-500">{p.covered_through ? `Covered through ${new Date(`${p.covered_through}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}` : ''}</div>
                            {p.payment_reference && <div className="mt-1 break-all text-xs text-gray-500">Ref: {p.payment_reference}</div>}
                          </div>
                          <div className="text-right">
                            <div className="text-lg font-bold">₹{Number(p.amount || 0).toFixed(2)}</div>
                            <div className={`text-sm font-semibold ${p.status === 'paid' ? 'text-green-700' : p.status === 'pending_verification' || p.status === 'not_received' ? 'text-amber-700' : 'text-gray-700'}`}>
                              {p.status === 'pending_verification' ? 'Pending Verification' : p.status === 'not_received' ? 'Not Received' : p.status === 'paid' ? 'Paid' : 'Unpaid'}
                            </div>
                          </div>
                        </div>

                        {(p.status === 'unpaid' || p.status === 'pending_verification') && (
                          <AsyncActionButton type="button" loading={busy === p.id} loadingLabel="Updating Payment…" disabled={busy !== null && busy !== p.id} onClick={() => void setStatus(p.id, 'paid')} className="mt-3 w-full min-h-11 rounded-lg bg-primary-600 px-4 font-semibold text-white">Mark as Paid</AsyncActionButton>
                        )}
                        {p.status === 'pending_verification' && (
                          <AsyncActionButton type="button" loading={busy === p.id} loadingLabel="Updating Payment…" disabled={busy !== null && busy !== p.id} onClick={() => void setStatus(p.id, 'not_received')} className="mt-2 w-full min-h-11 rounded-lg border border-gray-300 px-4 font-semibold text-gray-700">Not Received</AsyncActionButton>
                        )}
                        {showReminder && (
                          <div className="mt-3">
                            <AsyncActionButton type="button" loading={busy === `reminder:${b.id}`} loadingLabel="Sending Reminder…" disabled={busy !== null} onClick={() => void sendReminder(b, p, pending)} className="w-full min-h-11 rounded-lg border border-primary-600 px-4 font-semibold text-primary-700">Send Reminder</AsyncActionButton>
                            {reminderCount > 0 && <p className="mt-2 text-center text-xs font-semibold text-gray-500">{reminderLabel(reminderCount)}</p>}
                          </div>
                        )}
                        {p.status === 'not_received' && <div className="mt-3 rounded-lg bg-amber-50 p-3 text-sm font-semibold text-amber-800">Not received. The payment request can be paid again.</div>}
                        {p.status === 'unpaid' && <p className="mt-3 rounded-lg border p-3 text-sm font-semibold text-gray-700">New payment request — ₹{Number(p.amount || 0).toFixed(2)}.</p>}
                        {p.status === 'paid' && <p className="mt-3 rounded-lg bg-green-50 p-3 text-sm font-semibold text-green-800">Paid. No further payment action is required.</p>}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};

export default PaymentVerification;
