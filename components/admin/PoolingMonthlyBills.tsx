import React, { useCallback, useEffect, useRef, useState } from 'react';
import AsyncActionButton from '../common/AsyncActionButton';
import { useBillingSettings } from '../../hooks/useBillingSettings';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../supabase';
import { PoolingResult, SharedSpecialSummary, istBusinessDate, previousBillingPeriod, messCutAppliedLabel, MessCutMode, COMMON_BILL_LABEL, poolingExpenseSummaryPaise, sharedSpecialLineLabel } from '../../supabase/functions/_shared/poolingBilling';
import { loadPoolingRun, previewPoolingBills, publishPoolingBill, savePoolingRun } from '../../services/poolingBills';
import { parsePriceToPaise, savePoolingSpecialSharedCost } from '../../services/poolingSpecials';
import { buildPoolingDraftPdfModel, displayBusinessDate, monthLabel, poolingDraftPdfAdapter } from '../../utils/poolingDraftPdf';

/** Fired by in-app edits that change pooling inputs (e.g. Expenses add/edit/delete). */
export const POOLING_INPUTS_CHANGED = 'gocanteen:pooling-inputs-changed';
const DRAFT_TABLES = ['expenses', 'employee_adjustments', 'orders', 'order_items', 'holiday_dates', 'pooling_special_shared_costs'] as const;

const rs = (p: number) => `₹${(p / 100).toFixed(2)}`;

const PoolingExpenseSummary: React.FC<{ result: PoolingResult; className?: string }> = ({ result, className }) => {
  const s = poolingExpenseSummaryPaise(result);
  return <div className={className || 'grid gap-1 text-sm'} aria-label="Expense summary">
    <div className="flex justify-between"><span>Expenses</span><b>{rs(s.foodPaise)}</b></div>
    {s.commonPaise > 0 && <div className="flex justify-between"><span>Common bill</span><b>{rs(s.commonPaise)}</b></div>}
    {s.specialPaise > 0 && <div className="flex justify-between"><span>Special expenses</span><b>{rs(s.specialPaise)}</b></div>}
    <div className="flex justify-between font-semibold"><span>Total expenses</span><b>{rs(s.totalPaise)}</b></div>
  </div>;
};



const sortSharedSpecials = (summaries: SharedSpecialSummary[]) =>
  [...summaries].sort((a, b) => b.date.localeCompare(a.date) || a.itemCode.localeCompare(b.itemCode) || a.itemName.localeCompare(b.itemName));

const SharedSpecialCostsEditor: React.FC<{ summaries: SharedSpecialSummary[]; names?: Record<string, string>; onChanged: () => void; disabled?: boolean }> = ({ summaries, names = {}, onChanged, disabled }) => {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<Record<string, boolean>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState('');
  const list = sortSharedSpecials(summaries);
  if (!list.length) return null;
  const keyOf = (s: SharedSpecialSummary) => `${s.date}::${s.itemCode}`;
  const save = async (s: SharedSpecialSummary) => {
    const k = keyOf(s);
    if (disabled || busyKey) return;
    setBusyKey(k); setError('');
    try {
      const raw = draft[k];
      const paise = raw == null || raw === '' ? (s.pending ? null : s.totalPaise) : parsePriceToPaise(raw);
      if (paise == null) throw new Error('Enter the total cost.');
      await savePoolingSpecialSharedCost(s.date, s.itemCode, paise);
      setDraft(p => { const n = { ...p }; delete n[k]; return n; });
      setEditing(p => ({ ...p, [k]: false }));
      window.dispatchEvent(new Event(POOLING_INPUTS_CHANGED));
      onChanged();
    } catch (e: any) { setError(e?.message || 'Could not save the total.'); }
    finally { setBusyKey(null); }
  };
  const cancelEdit = (s: SharedSpecialSummary) => {
    const k = keyOf(s);
    setDraft(p => { const n = { ...p }; delete n[k]; return n; });
    setEditing(p => ({ ...p, [k]: false }));
  };
  const remove = async (s: SharedSpecialSummary) => {
    const k = keyOf(s);
    if (disabled || busyKey) return;
    if (!window.confirm(`Delete the saved total for ${sharedSpecialLineLabel(s.itemName, s.date)}? It will go back to amount pending.`)) return;
    setBusyKey(k); setError('');
    try {
      await savePoolingSpecialSharedCost(s.date, s.itemCode, null);
      setDraft(p => { const n = { ...p }; delete n[k]; return n; });
      setEditing(p => ({ ...p, [k]: false }));
      window.dispatchEvent(new Event(POOLING_INPUTS_CHANGED));
      onChanged();
    } catch (e: any) { setError(e?.message || 'Could not delete the total.'); }
    finally { setBusyKey(null); }
  };
  const membersOf = (s: SharedSpecialSummary) => {
    const rows = (s.shares && s.shares.length)
      ? s.shares.map(r => ({ name: names[r.memberId] || 'Member', paise: r.paise as number | null }))
      : (s.memberIds || []).map(id => ({ name: names[id] || 'Member', paise: null as number | null }));
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  };
  return <section aria-label="Shared cost specials" className="rounded-2xl border bg-white p-4 shadow-sm space-y-3">
    <div className="font-bold text-primary-900">Shared cost specials</div>
    <p className="text-xs text-gray-600">Enter the total after buying. It is split equally among the members who ordered that special (one share each, not by quantity).</p>
    {error && <div className="text-sm text-red-700">{error}</div>}
    <div className="space-y-3">{list.map(s => {
      const k = keyOf(s);
      const who = s.memberCount === 1 ? '1 member' : `${s.memberCount} members`;
      const isEditing = Boolean(editing[k]);
      const showField = s.pending || isEditing;
      const members = membersOf(s);
      return <div key={k} className="space-y-2 rounded-xl border p-3">
        <div className="font-semibold text-gray-800">{sharedSpecialLineLabel(s.itemName, s.date)}</div>
        {s.pending
          ? <div className="text-sm font-semibold text-amber-700">amount pending</div>
          : !isEditing && s.totalPaise != null
            ? <div className="text-lg font-bold text-gray-900" aria-label={`Saved total for ${s.itemName} on ${s.date}`}>{rs(s.totalPaise)}</div>
            : null}
        {showField && !disabled && <div className="flex flex-wrap items-center gap-2">
          <div className="flex min-w-[8rem] flex-1"><span className="flex min-h-11 items-center rounded-l-lg border border-r-0 bg-gray-50 px-2 text-gray-600">₹</span>
            <input type="text" inputMode="decimal" aria-label={`Total for ${s.itemName} on ${s.date}`} disabled={busyKey === k} value={draft[k] ?? (s.pending || s.totalPaise == null ? '' : String((s.totalPaise || 0) / 100))} onChange={e => setDraft(p => ({ ...p, [k]: e.target.value }))} placeholder="Total" className="min-h-11 w-full rounded-r-lg border px-3 text-sm text-right"/></div>
          <AsyncActionButton type="button" loading={busyKey === k} loadingLabel="Saving…" disabled={Boolean(busyKey && busyKey !== k)} onClick={() => void save(s)} className="min-h-11 rounded-lg border border-primary-600 px-3 text-sm font-semibold text-primary-700">{isEditing ? 'Save' : 'Save total'}</AsyncActionButton>
          {isEditing && <button type="button" disabled={Boolean(busyKey)} onClick={() => cancelEdit(s)} className="min-h-11 rounded-lg border px-3 text-sm font-semibold text-gray-700">Cancel</button>}
        </div>}
        {!s.pending && !isEditing && !disabled && <div className="flex flex-wrap gap-2">
          <button type="button" disabled={Boolean(busyKey)} onClick={() => setEditing(p => ({ ...p, [k]: true }))} className="min-h-11 rounded-lg border border-primary-600 px-3 text-sm font-semibold text-primary-700">Edit</button>
          <AsyncActionButton type="button" loading={busyKey === k} loadingLabel="Deleting…" disabled={Boolean(busyKey && busyKey !== k)} onClick={() => void remove(s)} className="min-h-11 rounded-lg border border-red-600 px-3 text-sm font-semibold text-red-700">Delete</AsyncActionButton>
        </div>}
        <div className="text-sm text-gray-600">{who}</div>
        {members.length > 0 && <ul className="space-y-1 text-sm text-gray-700" aria-label={`Members for ${s.itemName} on ${s.date}`}>
          {members.map((m, i) => <li key={`${k}-${m.name}-${i}`} className="flex justify-between gap-3"><span className="min-w-0 break-words">{m.name}</span><span className="shrink-0 font-semibold">{m.paise == null ? '—' : rs(m.paise)}</span></li>)}
        </ul>}
      </div>;
    })}</div>
  </section>;
};


/** Running month, 1st..today (IST): admin-only, read-only. Never saves, publishes or notifies. */
const CurrentMonthDraft: React.FC<{ threshold: number; mode?: MessCutMode; canteenName: string }> = ({ threshold, mode, canteenName }) => {
  const [draft, setDraft] = useState<{ asOf: string; result: PoolingResult; names: Record<string, string> } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [pdfBusy, setPdfBusy] = useState(false);
  const gen = useRef(0);
  const load = useCallback(async () => {
    const g = ++gen.current; const asOf = istBusinessDate(new Date()); const [y, m] = asOf.split('-').map(Number);
    setLoading(true);
    try {
      const p = await previewPoolingBills(m, y, threshold, asOf, mode);
      if (g === gen.current) { setDraft({ asOf, result: p.result, names: p.memberNames }); setError(''); }
    } catch (e: any) { if (g === gen.current) setError(e?.message || 'Could not calculate.'); }
    finally { if (g === gen.current) setLoading(false); }
  }, [threshold, mode]);
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
      <PoolingExpenseSummary result={r} className="grid gap-1 rounded-2xl border bg-white p-4 text-sm shadow-sm"/>
      {(r.issues || []).map(w => <div key={w} role="alert" className="text-sm text-red-700">{w}</div>)}
      <div className="divide-y text-sm">{r.lines.map(l => <div key={l.memberId} data-draft-member={l.memberId} className="grid gap-1 py-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <div className="min-w-0"><div className="break-words font-semibold text-gray-800">{draft!.names[l.memberId] || 'Member'}</div>
          <div className="text-gray-600">Ate {l.attendedDays}/{l.windowDays} · Pool {rs(l.sharePaise)}{l.messCutApplied ? ` · ${messCutAppliedLabel(l.excludedDays, r.messCutMode || 'any', 'short')}` : ''}{(l.allMembersSharePaise || 0) ? ` · ${COMMON_BILL_LABEL} ${rs(l.allMembersSharePaise)}` : ''}{l.adminAddedPaise ? ` · Admin added ${rs(l.adminAddedPaise)}` : ''}{(l.specialMemberPaise || 0) + (l.specialGuestPaise || 0) ? ` · Special ${rs((l.specialMemberPaise || 0) + (l.specialGuestPaise || 0))}` : ''}{(l.specialLines || []).map(s => ` · ${s.label} ${rs(s.paise)}`).join('')}{l.specialPending ? ' · amount pending' : ''}</div></div>
        <div className="text-right font-bold">{rs(l.totalPaise)}</div>
      </div>)}</div>
      <SharedSpecialCostsEditor summaries={r.sharedSpecialSummaries || []} names={draft!.names} onChanged={() => void load()} disabled={loading}/>
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
  const [view, setView] = useState<'current' | 'previous'>('current');
  const [pdfBusy, setPdfBusy] = useState(false);
  const label = new Date(year, month - 1, 1).toLocaleString('en-IN', { month: 'long', year: 'numeric' });
  const refresh = async () => {
    setBusy('load'); setMessage('');
    try {
      const p = await previewPoolingBills(month, year, settings.messCutMinDays, undefined, settings.messCutMode);
      setResult(p.result); setNames(p.memberNames); setRun(await loadPoolingRun(month, year));
    } catch (e: any) { setMessage(e?.message || 'Could not calculate pooling bills.'); }
    finally { setBusy(null); }
  };
  useEffect(() => { void refresh(); }, [settings.messCutMinDays, settings.messCutMode]);
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
      if (l.specialPending) { errors.push(`${names[l.memberId] || l.memberId}: Shared cost amount pending. Enter the total before publishing this bill.`); continue; }
      try { await publishPoolingBill(run.id, l.memberId); } catch (e: any) { errors.push(`${names[l.memberId] || l.memberId}: ${e?.message || e}`); }
    }
    setRun(await loadPoolingRun(month, year)); setBusy(null);
    setMessage(errors.length ? `Some bills failed: ${errors.join('; ')}` : 'Bills published.');
  };
  const downloadPdf = async () => {
    if (!result || pdfBusy) return;
    setPdfBusy(true);
    try {
      const asOf = result.periodEnd || `${year}-${String(month).padStart(2, '0')}-01`;
      await poolingDraftPdfAdapter.download(buildPoolingDraftPdfModel(result, names, user?.canteenName || '', asOf));
    } catch (e: any) { setMessage(e?.message || 'Could not generate the PDF.'); }
    finally { setPdfBusy(false); }
  };
  return <div className="min-w-0 space-y-4">
    <div><h3 className="text-2xl font-bold text-primary-900">Monthly Bills — Pooling</h3></div>
    <div className="mb-2 flex gap-2 rounded-xl bg-gray-100 p-1">
      <button type="button" onClick={() => setView('current')} className={`flex-1 rounded-lg px-4 py-2 text-sm font-semibold ${view === 'current' ? 'bg-white text-primary-700 shadow-sm' : 'text-gray-600'}`}>Current Month</button>
      <button type="button" onClick={() => setView('previous')} className={`flex-1 rounded-lg px-4 py-2 text-sm font-semibold ${view === 'previous' ? 'bg-white text-primary-700 shadow-sm' : 'text-gray-600'}`}>Previous Month</button>
    </div>
    {view === 'current' && isAdmin && <CurrentMonthDraft threshold={settings.messCutMinDays} mode={settings.messCutMode} canteenName={user?.canteenName || ''} />}
    {view === 'previous' && <>
    <p className="text-sm font-semibold text-gray-700">{label}</p>
    {message && <div className="rounded-lg bg-gray-50 p-3 text-sm text-gray-700">{message}</div>}
    {busy === 'load' && !result && <div className="rounded-xl border bg-gray-50 p-4 text-sm text-gray-600">Calculating…</div>}
    {result && <>
      <div className="grid gap-2 rounded-2xl border bg-white p-4 text-sm shadow-sm sm:grid-cols-2">
        <div className="sm:col-span-2"><PoolingExpenseSummary result={result}/></div>
        {result.unallocatedPaise > 0 && <div className="flex justify-between text-red-700 sm:col-span-2"><span>Unallocated (needs review)</span><b>{rs(result.unallocatedPaise)}</b></div>}
        {(result.issues || []).map(w => <div key={w} role="alert" className="text-sm text-red-700 sm:col-span-2">{w}</div>)}
      </div>
      <SharedSpecialCostsEditor summaries={result.sharedSpecialSummaries || []} names={names} onChanged={() => void refresh()} disabled={Boolean(busy) || run?.status === 'published'}/>
      <div className="space-y-2">{result.lines.map(l => <div key={l.memberId} className="grid gap-1 rounded-xl border bg-white p-3 text-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <div className="min-w-0"><div className="break-words font-semibold text-gray-800">{names[l.memberId] || 'Member'}</div>
          <div className="text-gray-600">Ate {l.attendedDays}/{l.windowDays} days · No-order {l.absentDays}{l.messCutApplied ? ` · ${messCutAppliedLabel(l.excludedDays, result.messCutMode || 'any', 'long')}` : ''} · Charged days {l.chargeableDays}{(l.allMembersSharePaise || 0) ? ` · ${COMMON_BILL_LABEL} ${rs(l.allMembersSharePaise)}` : ''}{l.adminAddedPaise ? ` · Admin added ${rs(l.adminAddedPaise)}` : ''}{l.specialMemberPaise ? ` · Special items ${rs(l.specialMemberPaise)}` : ''}{l.specialGuestPaise ? ` · Guest special items ${rs(l.specialGuestPaise)}` : ''}{(l.specialLines || []).map(s => ` · ${s.label} ${rs(s.paise)}`).join('')}{l.specialPending ? ' · amount pending' : ''}</div></div>
        <div className="text-right"><div className="text-lg font-bold">{rs(publishedTotal(l.memberId) ?? l.totalPaise)}</div>{sentFor(l.memberId) && <div className="text-xs font-semibold text-primary-700">Published</div>}</div>
      </div>)}</div>
      <div className="flex flex-wrap gap-2">
        <AsyncActionButton type="button" loading={busy === 'load'} loadingLabel="Calculating…" disabled={Boolean(busy)} onClick={() => void refresh()} className="rounded-lg border px-4 py-2.5 text-sm font-medium">Recalculate</AsyncActionButton>
        {run?.status !== 'published' && <AsyncActionButton type="button" loading={busy === 'save'} loadingLabel="Saving…" disabled={Boolean(busy)} onClick={() => void lock()} className="rounded-lg border border-primary-600 px-4 py-2.5 text-sm font-semibold text-primary-700">Save Calculation</AsyncActionButton>}
        <AsyncActionButton type="button" loading={busy === 'publish'} loadingLabel="Publishing…" disabled={Boolean(busy) || !run || Boolean((result.pendingSharedSpecials || []).length)} onClick={() => void publishAll()} className="rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm">Publish Bills</AsyncActionButton>
        <AsyncActionButton type="button" loading={pdfBusy} loadingLabel="Generating PDF…" disabled={!result || Boolean(busy) || pdfBusy} onClick={() => void downloadPdf()} className="rounded-lg border px-4 py-2.5 text-sm font-medium">Download PDF</AsyncActionButton>
      </div>
    </>}
    </>}
  </div>;
};
export default PoolingMonthlyBills;
