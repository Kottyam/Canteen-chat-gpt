import React, { useEffect, useRef, useState } from 'react';
import AsyncActionButton from '../common/AsyncActionButton';
import { CanteenBillingSettings, parseMessCutDays } from '../../supabase/functions/_shared/poolingBilling';
import { MESS_CUT_RANGE_MESSAGE, saveBillingSettings } from '../../services/billingSettings';
import { publishBillingSettings, useBillingSettings } from '../../hooks/useBillingSettings';
import GuestOrdersToggle from './GuestOrdersToggle';

const BillingModeSettings: React.FC = () => {
  const { settings, loaded, error, pooling } = useBillingSettings();
  const [draft, setDraft] = useState<CanteenBillingSettings>(settings);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  // Days are edited as text: clearing / typing "31" is never coerced per keystroke; validated on Save only.
  const [daysText, setDaysText] = useState(String(settings.messCutMinDays));
  const daysDirty = useRef(false);
  useEffect(() => { setDraft(settings); }, [settings]);
  useEffect(() => { if (!daysDirty.current) setDaysText(String(settings.messCutMinDays)); }, [settings.messCutMinDays]);
  const save = async () => {
    const days = draft.billingModel === 'pooling' ? parseMessCutDays(daysText) : (parseMessCutDays(daysText) ?? settings.messCutMinDays);
    if (days === null) { setMessage(MESS_CUT_RANGE_MESSAGE); return; }
    if (draft.billingModel !== settings.billingModel && !window.confirm(draft.billingModel === 'pooling'
      ? 'Switch to Pooling? Menu prices will be hidden from members and monthly bills will share this canteen\'s expenses. Stored prices are kept.'
      : 'Switch back to Standard (menu price) billing? Stored menu prices will be used again.')) return;
    if (draft.billSendMode === 'automatic' && settings.billSendMode !== 'automatic' && !window.confirm('Enable Automatic bill sending? Each new month, last month\'s bills will be published to members automatically.')) return;
    setBusy(true); setMessage('');
    try { const saved = await saveBillingSettings({ ...draft, messCutMinDays: days }); daysDirty.current = false; setDaysText(String(saved.messCutMinDays)); publishBillingSettings(saved); setMessage('Billing settings saved.'); }
    catch (e: any) { setMessage(e?.message || 'Could not save billing settings.'); }
    finally { setBusy(false); }
  };
  const opt = (active: boolean) => `min-h-11 flex-1 rounded-lg px-3 py-2 text-sm font-semibold ${active ? 'bg-white text-primary-700 shadow-sm' : 'text-gray-600'}`;
  return <div className="space-y-4">
    {error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">Could not load billing settings: {error}</div>}
    <div className="rounded-2xl border bg-white p-4 shadow-sm">
      <h4 className="font-bold text-gray-800">Billing Model</h4>
      <p className="mt-1 text-sm text-gray-600">Standard uses menu prices (and company contribution, if set). Pooling shares the month's expenses among members.</p>
      <div className="mt-3 flex gap-2 rounded-xl bg-gray-100 p-1">
        <button type="button" disabled={busy || !loaded} className={opt(draft.billingModel === 'standard')} onClick={() => setDraft({ ...draft, billingModel: 'standard' })}>Standard</button>
        <button type="button" disabled={busy || !loaded} className={opt(draft.billingModel === 'pooling')} onClick={() => setDraft({ ...draft, billingModel: 'pooling' })}>Pooling</button>
      </div>
      {draft.billingModel === 'pooling' && <div className="mt-4 space-y-4">
        <label className="block text-sm font-medium text-gray-700">Mess cut: minimum no-order days in a month
          <input type="text" inputMode="numeric" pattern="[0-9]*" maxLength={2} aria-label="Mess cut days" disabled={busy || !loaded} value={daysText}
            onChange={e => { daysDirty.current = true; setDaysText(e.target.value); }}
            className="mt-1 block w-32 rounded-lg border p-2.5" />
          <span className="mt-1 block text-xs text-gray-500">0 to 31. 0: every no-order day is not charged.</span>
        </label>
        <div>
          <div className="text-sm font-medium text-gray-700">Mess cut applies to</div>
          <div className="mt-2 flex gap-2 rounded-xl bg-gray-100 p-1" role="group" aria-label="Mess cut mode">
            <button type="button" disabled={busy || !loaded} className={opt((draft.messCutMode || 'any') === 'consecutive')} onClick={() => setDraft({ ...draft, messCutMode: 'consecutive' })}>Consecutive</button>
            <button type="button" disabled={busy || !loaded} className={opt((draft.messCutMode || 'any') === 'any')} onClick={() => setDraft({ ...draft, messCutMode: 'any' })}>Any days</button>
          </div>
          <p className="mt-1 text-xs text-gray-500">{(draft.messCutMode || 'any') === 'consecutive'
            ? 'Only a run of this many no-order days in a row is not charged (longer runs are also not charged). Shorter or scattered days stay charged. Holidays and weekly offs are skipped and do not break the run.'
            : 'If a member has this many or more no-order days in the month, those days are not charged, even if they are scattered.'}</p>
        </div>
      </div>}
    </div>
    <div className="rounded-2xl border bg-white p-4 shadow-sm">
      <h4 className="font-bold text-gray-800">Monthly Bill Sending</h4>
      <p className="mt-1 text-sm text-gray-600">Manual: admin publishes bills as today. Automatic: when a new month starts, last month's bills are published to members.</p>
      <div className="mt-3 flex gap-2 rounded-xl bg-gray-100 p-1">
        <button type="button" disabled={busy || !loaded} className={opt(draft.billSendMode === 'manual')} onClick={() => setDraft({ ...draft, billSendMode: 'manual' })}>Manual</button>
        <button type="button" disabled={busy || !loaded} className={opt(draft.billSendMode === 'automatic')} onClick={() => setDraft({ ...draft, billSendMode: 'automatic' })}>Automatic</button>
      </div>
    </div>
    {pooling && loaded && <div className="rounded-2xl border bg-white p-4 shadow-sm"><GuestOrdersToggle/></div>}
    {message && <div className="rounded-lg bg-gray-50 p-3 text-sm text-gray-700">{message}</div>}
    <AsyncActionButton type="button" loading={busy} loadingLabel="Saving…" disabled={busy || !loaded || Boolean(error)} onClick={() => void save()} className="rounded-lg bg-primary-600 px-4 py-2.5 font-medium text-white shadow-sm">Save Billing Settings</AsyncActionButton>
  </div>;
};
export default BillingModeSettings;
