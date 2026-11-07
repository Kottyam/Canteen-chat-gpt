import React, { useEffect, useState } from 'react';
import AsyncActionButton from '../common/AsyncActionButton';
import { CanteenBillingSettings } from '../../supabase/functions/_shared/poolingBilling';
import { saveBillingSettings } from '../../services/billingSettings';
import { publishBillingSettings, useBillingSettings } from '../../hooks/useBillingSettings';

const BillingModeSettings: React.FC = () => {
  const { settings, loaded } = useBillingSettings();
  const [draft, setDraft] = useState<CanteenBillingSettings>(settings);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => { setDraft(settings); }, [settings]);
  const save = async () => {
    if (draft.billingModel !== settings.billingModel && !window.confirm(draft.billingModel === 'pooling'
      ? 'Switch to Pooling? Menu prices will be hidden from members and monthly bills will share this canteen\'s expenses. Stored prices are kept.'
      : 'Switch back to Standard (menu price) billing? Stored menu prices will be used again.')) return;
    if (draft.billSendMode === 'automatic' && settings.billSendMode !== 'automatic' && !window.confirm('Enable Automatic bill sending? Each new month, last month\'s bills will be published to members automatically.')) return;
    setBusy(true); setMessage('');
    try { const saved = await saveBillingSettings(draft); publishBillingSettings(saved); setMessage('Billing settings saved.'); }
    catch (e: any) { setMessage(e?.message || 'Could not save billing settings.'); }
    finally { setBusy(false); }
  };
  const opt = (active: boolean) => `min-h-11 flex-1 rounded-lg px-3 py-2 text-sm font-semibold ${active ? 'bg-white text-primary-700 shadow-sm' : 'text-gray-600'}`;
  return <div className="space-y-4">
    <div className="rounded-2xl border bg-white p-4 shadow-sm">
      <h4 className="font-bold text-gray-800">Billing Model</h4>
      <p className="mt-1 text-sm text-gray-600">Standard uses menu prices (and company contribution, if set). Pooling shares the month's expenses among members.</p>
      <div className="mt-3 flex gap-2 rounded-xl bg-gray-100 p-1">
        <button type="button" disabled={busy || !loaded} className={opt(draft.billingModel === 'standard')} onClick={() => setDraft({ ...draft, billingModel: 'standard' })}>Standard</button>
        <button type="button" disabled={busy || !loaded} className={opt(draft.billingModel === 'pooling')} onClick={() => setDraft({ ...draft, billingModel: 'pooling' })}>Pooling</button>
      </div>
      {draft.billingModel === 'pooling' && <label className="mt-4 block text-sm font-medium text-gray-700">Mess cut: minimum no-order days in a month
        <input type="number" min={1} max={31} step={1} disabled={busy} value={draft.messCutMinDays}
          onChange={e => setDraft({ ...draft, messCutMinDays: Math.min(31, Math.max(1, Math.floor(Number(e.target.value) || 1))) })}
          className="mt-1 block w-32 rounded-lg border p-2.5" />
        <span className="mt-1 block text-xs text-gray-500">Counted automatically from orders (days need not be continuous). If a member has this many or more no-order days, those days are not charged and are shared by the others. Fewer days: full share.</span>
      </label>}
    </div>
    <div className="rounded-2xl border bg-white p-4 shadow-sm">
      <h4 className="font-bold text-gray-800">Monthly Bill Sending</h4>
      <p className="mt-1 text-sm text-gray-600">Manual: admin publishes bills as today. Automatic: when a new month starts, last month's bills are published to members.</p>
      <div className="mt-3 flex gap-2 rounded-xl bg-gray-100 p-1">
        <button type="button" disabled={busy || !loaded} className={opt(draft.billSendMode === 'manual')} onClick={() => setDraft({ ...draft, billSendMode: 'manual' })}>Manual</button>
        <button type="button" disabled={busy || !loaded} className={opt(draft.billSendMode === 'automatic')} onClick={() => setDraft({ ...draft, billSendMode: 'automatic' })}>Automatic</button>
      </div>
    </div>
    {message && <div className="rounded-lg bg-gray-50 p-3 text-sm text-gray-700">{message}</div>}
    <AsyncActionButton type="button" loading={busy} loadingLabel="Saving…" disabled={busy || !loaded} onClick={() => void save()} className="rounded-lg bg-primary-600 px-4 py-2.5 font-medium text-white shadow-sm">Save Billing Settings</AsyncActionButton>
  </div>;
};
export default BillingModeSettings;
