import React, { useCallback, useEffect, useRef, useState } from 'react';
import AsyncActionButton from '../common/AsyncActionButton';
import { useBillingSettings } from '../../hooks/useBillingSettings';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../supabase';
import { PoolingResult, istBusinessDate, previousBillingPeriod } from '../../supabase/functions/_shared/poolingBilling';
import { loadPoolingRun, previewPoolingBills, publishPoolingBill, savePoolingRun } from '../../services/poolingBills';
import { buildPoolingDraftPdfModel, displayBusinessDate, monthLabel, poolingDraftPdfAdapter } from '../../utils/poolingDraftPdf';

/** Fired by in-app edits that change pooling inputs (e.g. Expenses add/edit/delete). */
export const POOLING_INPUTS_CHANGED = 'gocanteen:pooling-inputs-changed';
const DRAFT_TABLES = ['expenses', 'employee_adjustments', 'orders', 'order_items', 'holiday_dates'] as const;

const rs = (p: number) => `₹${(p / 100).toFixed(2)}`;

/** Running month, 1st..today (IST): admin-only, read-only. Never saves, publishes or notifies. */
const CurrentMonthDraft: React.FC<{ threshold: number; canteenName: string }> = ({ threshold, canteenName }) => {
  const [draft, setDraft] = useState<{ asOf: string; result: PoolingResult; names: Record<string, string> } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [pdfBusy, setPdfBusy] = useState(false);
  const gen = useRef(0);
  const load = useCallback(async () => {
    const g = ++gen.current; const asOf = istBusinessDate(new Date()); const [y, m] = asOf.split('-').map(Number);
    setLoading(true);
    try {
      const p = await previewPoolingBills(m, y, threshold, asOf);
      if (g === gen.current) { setDraft({ asOf, result: p.result, names: p.memberNames }); setError(''); }
    } catch (e: any) { if (g === gen.current) setError(e?.message || 'Could not calculate.'); }
    finally { if (g === gen.current) setLoading(false); }
  }, [threshold]);
  useEffect(() => {
    let timer: number | undefined;
    const schedule = () => { window.clearTimeout(timer); timer = window.setTimeout(() => void load(), 300); }; // coalesce bursts
    const onVisible = () => { if (document.visibilityState === 'visible') schedule(); };
    void load();
    window.addEventListener(POOLING_INPUTS_CHANGED, schedule); window.addEventListener('focus', schedule); document.addEventListener('visibilitychange', onVisible);
    let channel: any = null;
    if (supabase?.channel) { channel = supabase.channel('gocanteen-pooling-draft-sync'); for (const t of DRAFT_TABLES) channel = channel.on('postgres_changes', { event: '*', schema: 'public', table: t }, schedule); channel = channel.subscribe(); }
    return () => {
      gen.current++; window.clearTimeout(timer);
      window.removeEventListener(POOLING_INPUTS_CHANGED, schedule); window.removeEventListener('focus', schedule); document.removeEventListener('visibilitychange', onVisible);
      if (channel) void channel.unsubscribe();
    };
  }, [load]);
  const download = async () => {
    if (!draft || pdfBusy) return; setPdfBusy(true);
    try { await poolingDraftPdfAdapter.download(buildPoolingDraftPdfModel(draft.result, draft.names, canteenName, draft.asOf)); }
    catch (e: any) { setError(e?.message || 'Could not generate the PDF.'); } finally { setPdfBusy(false); }
  };
  const r = draft?.result;
  return <section aria-label="Current month" className="min-w-0 space-y-2 rounded-2xl border bg-white p-4 shadow-sm">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><div className="font-bold text-primary-900">{r ? monthLabel(r.year, r.month) : 'Current month'}</div>{draft && <div className="text-xs font-semibold text-amber-700">Draft as of {displayBusinessDate(draft.asOf)}</div>}</div>
      <AsyncActionButton type="button" loading={pdfBusy} loadingLabel="Generating PDF…" disabled={!draft || loading || pdfBusy} onClick={() => void download()} className="rounded-lg border px-3 py-2 text-sm font-medium">Download PDF</AsyncActionButton>
    </div>
    {error && <div className="text-sm text-red-700">{error}</div>}
    {!r && loading && <div className="text-sm text-gray-600">Calculating…</div>}
    {r && <>
      <div className="flex justify-between text-sm"><span>Expenses so far</span><b>{rs(r.expenseTotalPaise)}</b></div>
      <div className="divide-y text-sm">{r.lines.map(l => <div key={l.memberId} data-draft-member={l.memberId} className="grid gap-1 py-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <div className="min-w-0"><div className="break-words font-semibold text-gray-800">{draft!.names[l.memberId] || 'Member'}</div>
          <div className="text-gray-600">Ate {l.attendedDays}/{l.windowDays} · Pool {rs(l.sharePaise)}{l.messCutApplied ? ` · Mess cut (${l.excludedDays})` : ''}{(l.specialMemberPaise || 0) + (l.specialGuestPaise || 0) ? ` · Special ${rs((l.specialMemberPaise || 0) + (l.specialGuestPaise || 0))}` : ''}{l.adminAddedPaise ? ` · Admin added ${rs(l.adminAddedPaise)}` : ''}</div></div>
        <div className="text-right font-bold">{rs(l.totalPaise)}</div>
      </div>)}</div>
    </>}
  </section>;
};

/** Pooling-mode monthly bills: preview -> lock snapshot -> publish (existing bill format). */
const PoolingMonthlyBills: React.FC = () => {
  const { settings } = useBillingSettings();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
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
    <div><h3 className="text-2xl font-bold text-primary-900">Monthly Bills — Pooling</h3></div>
    {isAdmin && <CurrentMonthDraft threshold={settings.messCutMinDays} canteenName={user?.canteenName || ''} />}
    <p className="text-sm font-semibold text-gray-700">{label}</p>
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
