import React, { useEffect, useState } from 'react';
import { loadSuperAdminCanteenSummary, SuperAdminCanteenSummary as Summary } from '../../services/superAdminCanteenSummary';

const rs = (n: number | null | undefined) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(n) || 0);
const when = (v?: string | null) => v ? new Date(v).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
const monthName = (y: number, m: number) => new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const istNow = () => { const d = new Date(Date.now() + 5.5 * 3600e3); return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 }; };

const Stat: React.FC<{ label: string; value: React.ReactNode; tone?: string; testId?: string }> = ({ label, value, tone, testId }) => (
  <div className="rounded-xl border border-gray-100 bg-gray-50 p-3" data-testid={testId}>
    <div className="text-xs font-semibold text-gray-600">{label}</div>
    <div className={`mt-1 text-base font-extrabold ${tone || 'text-gray-900'}`}>{value}</div>
  </div>
);

/** Super Admin → Canteens → Details: read-only billing and activity summary for one canteen. */
const SuperAdminCanteenSummary: React.FC<{ canteenId: string }> = ({ canteenId }) => {
  const now = istNow();
  const [ym, setYm] = useState(`${now.y}-${String(now.m).padStart(2, '0')}`);
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    const [y, m] = ym.split('-').map(Number);
    setLoading(true); setError('');
    loadSuperAdminCanteenSummary(canteenId, y, m)
      .then(d => { if (alive) setData(d); })
      .catch(e => { if (alive) setError(e?.message || 'Could not load canteen summary.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [canteenId, ym]);

  const options = (() => {
    const keys = new Set<string>([`${now.y}-${String(now.m).padStart(2, '0')}`]);
    for (let i = 1; i <= 11; i++) { const d = new Date(Date.UTC(now.y, now.m - 1 - i, 1)); keys.add(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`); }
    for (const m of data?.months || []) keys.add(m.key);
    return [...keys].sort().reverse();
  })();

  const pooling = data?.settings.billing_model === 'pooling';
  const mo = data?.month;
  const at = data?.all_time;
  return (
    <div className="mt-5 space-y-4" data-testid="super-admin-canteen-summary">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-extrabold">Canteen Summary</h4>
        <label className="flex items-center gap-2 text-sm">
          <span className="font-semibold text-gray-600">Month</span>
          <select value={ym} onChange={e => setYm(e.target.value)} className="rounded-lg border px-2 py-1.5 text-sm" data-testid="summary-month">
            {options.map(k => { const [y, m] = k.split('-').map(Number); return <option key={k} value={k}>{monthName(y, m)}</option>; })}
          </select>
        </label>
      </div>
      {error && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>}
      {loading && !data && <p className="text-sm text-gray-600">Loading summary…</p>}
      {data && mo && at && <>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Billing mode" value={pooling ? 'Pooling' : 'Standard'} testId="summary-billing-mode" />
          <Stat label="Bill send mode" value={data.settings.bill_send_mode === 'automatic' ? 'Automatic' : 'Manual'} testId="summary-send-mode" />
          <Stat label="Members (active / total)" value={`${data.members.active} / ${data.members.total}`} testId="summary-members" />
          <Stat label="Admins" value={data.members.admins} />
          {pooling && <Stat label="Mess cut min days" value={data.settings.mess_cut_min_days ?? '—'} />}
          <Stat label="Member login" value={data.canteen.member_login_mode || '—'} />
          <Stat label="Created" value={when(data.canteen.created_at)} />
        </div>

        <div>
          <div className="mb-2 text-sm font-bold text-gray-800">{monthName(data.period.year, data.period.month)}{data.period.is_current ? ' (current month)' : ''}</div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Total billed (published)" value={rs(mo.billed_total)} testId="summary-month-billed" />
            <Stat label="Paid" value={rs(mo.paid)} tone="text-green-700" testId="summary-month-paid" />
            <Stat label="Pending (outstanding)" value={rs(mo.outstanding)} tone="text-amber-700" testId="summary-month-outstanding" />
            <Stat label="Awaiting verification" value={rs(mo.pending_verification)} />
            <Stat label="Published bills" value={`${mo.published_bills}${mo.published_bills ? ` (${mo.fully_paid_bills} fully paid)` : ''}`} testId="summary-month-bills" />
            <Stat label="Last publish" value={when(mo.last_published_at)} />
            <Stat label="Orders" value={`${mo.orders}${mo.cancelled_orders ? ` (+${mo.cancelled_orders} cancelled)` : ''}`} testId="summary-month-orders" />
            <Stat label="Members who ordered" value={mo.members_ordered} />
            <Stat label="Admin-placed orders" value={mo.admin_orders} />
            <Stat label="Admin added / deducted" value={rs(mo.admin_added)} />
            {pooling && <Stat label="Expenses" value={rs(mo.expenses)} />}
            <Stat label="Unbilled so far" value={mo.unbilled == null ? '—' : rs(mo.unbilled)} tone="text-blue-700" testId="summary-month-unbilled" />
          </div>
          {mo.unbilled == null && <p className="mt-1 text-xs text-gray-500">Unbilled amount is shown for the current month only.</p>}
        </div>

        <div>
          <div className="mb-2 text-sm font-bold text-gray-800">All time</div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Total billed (published)" value={rs(at.billed_total)} testId="summary-all-billed" />
            <Stat label="Paid" value={rs(at.paid)} tone="text-green-700" />
            <Stat label="Pending (outstanding)" value={rs(at.outstanding)} tone="text-amber-700" />
            <Stat label="Published bills" value={at.published_bills} />
            <Stat label="Last publish" value={when(at.last_published_at)} />
            <Stat label="Total orders" value={at.orders} />
          </div>
        </div>

        {data.months.length > 0 && (
          <div className="overflow-x-auto rounded-xl border">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-gray-50 text-xs text-gray-600"><tr>{['Month', 'Bills', 'Billed', 'Paid', 'Pending', 'Last publish'].map(h => <th key={h} className="p-2">{h}</th>)}</tr></thead>
              <tbody>{data.months.map(m => (
                <tr key={m.key} className={`border-t ${m.key === ym ? 'bg-primary-50' : ''}`}>
                  <td className="p-2 font-semibold"><button type="button" className="text-primary-700 underline" onClick={() => setYm(m.key)}>{monthName(m.year, m.month)}</button></td>
                  <td className="p-2">{m.bills}</td><td className="p-2">{rs(m.billed_total)}</td><td className="p-2">{rs(m.paid)}</td><td className="p-2">{rs(m.outstanding)}</td><td className="p-2">{when(m.last_published_at)}</td>
                </tr>))}</tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-gray-500">Read-only. Totals use published bills; the published amount is authoritative.</p>
      </>}
    </div>
  );
};

export default SuperAdminCanteenSummary;
