import React, { useEffect, useState } from 'react';
import AsyncActionButton from '../common/AsyncActionButton';
import { useBillingSettings } from '../../hooks/useBillingSettings';
import { PoolingResult, previousBillingPeriod } from '../../supabase/functions/_shared/poolingBilling';
import { loadPoolingRun, previewPoolingBills, publishPoolingBill, savePoolingRun } from '../../services/poolingBills';

const rs = (p: number) => `₹${(p / 100).toFixed(2)}`;

/** Pooling-mode monthly bills: preview -> lock snapshot -> publish (existing bill format). */
const PoolingMonthlyBills: React.FC = () => {
  const { settings } = useBillingSettings();
  const { year, month } = previousBillingPeriod(new Date());
  const [result, setResult] = useState<PoolingResult | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [run, setRun] = useState<any>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const label = new Date(year, month - 1, 1).toLocaleString('en-IN', { month: 'long', year: 'numeric' });
  const refresh = async () => {
    setBusy('load'); setMessage('');
    try {
      const p = await previewPoolingBills(month, year, settings.messCutMinDays);
      setResult(p.result); setNames(p.memberNames); setRun(await loadPoolingRun(month, year));
    } catch (e: any) { setMessage(e?.message || 'Could not calculate pooling bills.'); }
    finally { setBusy(null); }
  };
  useEffect(() => { void refresh(); }, [settings.messCutMinDays]);
  // a published member shows the amount actually billed (saved snapshot), not the live recalculation
  const publishedTotal = (id: string): number | undefined => { const l = run?.pooling_bill_lines?.find((x: any) => x.employee_id === id); return l?.monthly_bill_id ? Number(l.total_paise) : undefined; };
  const sentFor = (id: string) => run?.pooling_bill_lines?.find((l: any) => l.employee_id === id)?.monthly_bill_id;
  const lock = async () => {
    if (!result || !window.confirm(`Save the ${label} pooling calculation? You can recalculate until bills are published.`)) return;
    setBusy('save');
    try { await savePoolingRun(result); setRun(await loadPoolingRun(month, year)); setMessage('Calculation saved.'); }
    catch (e: any) { setMessage(e?.message || 'Could not save.'); } finally { setBusy(null); }
  };
  const publishAll = async () => {
    if (!run || !result || !window.confirm(`Publish ${label} bills to members? Published bills cannot be recalculated.`)) return;
    setBusy('publish'); const errors: string[] = [];
    for (const l of result.lines) {
      if (sentFor(l.memberId) || l.totalPaise <= 0) continue;
      try { await publishPoolingBill(run.id, l.memberId); } catch (e: any) { errors.push(`${names[l.memberId] || l.memberId}: ${e?.message || e}`); }
    }
    setRun(await loadPoolingRun(month, year)); setBusy(null);
    setMessage(errors.length ? `Some bills failed: ${errors.join('; ')}` : 'Bills published.');
  };
  return <div className="min-w-0 space-y-4">
    <div><h3 className="text-2xl font-bold text-primary-900">Monthly Bills — Pooling</h3>
      <p className="mt-1 text-sm text-gray-600">{label}</p></div>
    {message && <div className="rounded-lg bg-gray-50 p-3 text-sm text-gray-700">{message}</div>}
    {busy === 'load' && !result && <div className="rounded-xl border bg-gray-50 p-4 text-sm text-gray-600">Calculating…</div>}
    {result && <>
      <div className="grid gap-2 rounded-2xl border bg-white p-4 text-sm shadow-sm sm:grid-cols-2">
        <div className="flex justify-between"><span>Total expenses</span><b>{rs(result.expenseTotalPaise)}</b></div>
        {result.unallocatedPaise > 0 && <div className="flex justify-between text-red-700 sm:col-span-2"><span>Unallocated (needs review)</span><b>{rs(result.unallocatedPaise)}</b></div>}
        {(result.issues || []).map(w => <div key={w} role="alert" className="text-sm text-red-700 sm:col-span-2">{w}</div>)}
      </div>
      <div className="space-y-2">{result.lines.map(l => <div key={l.memberId} className="grid gap-1 rounded-xl border bg-white p-3 text-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <div className="min-w-0"><div className="break-words font-semibold text-gray-800">{names[l.memberId] || 'Member'}</div>
          <div className="text-gray-600">Ate {l.attendedDays}/{l.windowDays} days · No-order {l.absentDays}{l.messCutApplied ? ` · Mess cut (${l.excludedDays} days not charged)` : ''} · Charged days {l.chargeableDays}{l.adminAddedPaise ? ` · Admin added ${rs(l.adminAddedPaise)}` : ''}{l.specialMemberPaise ? ` · Special items ${rs(l.specialMemberPaise)}` : ''}{l.specialGuestPaise ? ` · Guest special items ${rs(l.specialGuestPaise)}` : ''}</div></div>
        <div className="text-right"><div className="text-lg font-bold">{rs(publishedTotal(l.memberId) ?? l.totalPaise)}</div>{sentFor(l.memberId) && <div className="text-xs font-semibold text-primary-700">Published</div>}</div>
      </div>)}</div>
      <div className="flex flex-wrap gap-2">
        <AsyncActionButton type="button" loading={busy === 'load'} loadingLabel="Calculating…" disabled={Boolean(busy)} onClick={() => void refresh()} className="rounded-lg border px-4 py-2.5 text-sm font-medium">Recalculate</AsyncActionButton>
        {run?.status !== 'published' && <AsyncActionButton type="button" loading={busy === 'save'} loadingLabel="Saving…" disabled={Boolean(busy)} onClick={() => void lock()} className="rounded-lg border border-primary-600 px-4 py-2.5 text-sm font-semibold text-primary-700">Save Calculation</AsyncActionButton>}
        <AsyncActionButton type="button" loading={busy === 'publish'} loadingLabel="Publishing…" disabled={Boolean(busy) || !run} onClick={() => void publishAll()} className="rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm">Publish Bills</AsyncActionButton>
      </div>
    </>}
  </div>;
};
export default PoolingMonthlyBills;
