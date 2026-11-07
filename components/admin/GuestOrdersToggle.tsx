import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { publishGuestOrdersEnabled, useGuestOrdersEnabled } from '../../hooks/usePoolingSpecials';
import { saveGuestOrdersEnabled } from '../../services/poolingSpecials';

/** One canteen-wide "Guest orders" On/Off (all billing modes). Server enforces it; payments admins only. */
const GuestOrdersToggle: React.FC = () => {
  const { hasPermission } = useAuth();
  const enabled = useGuestOrdersEnabled();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const canEdit = hasPermission('payments');
  const set = async (next: boolean) => {
    if (busy || next === enabled) return;
    setBusy(true); setMsg('');
    try { publishGuestOrdersEnabled(await saveGuestOrdersEnabled(next)); setMsg(next ? 'Guest orders turned on.' : 'Guest orders turned off. Existing guest orders stay in history and bills.'); }
    catch (e: any) { setMsg(e?.message || 'Could not update guest orders.'); }
    finally { setBusy(false); }
  };
  const btn = (on: boolean) => `min-h-11 flex-1 rounded-lg px-4 text-sm font-semibold ${enabled === on ? 'bg-white text-primary-700 shadow-sm' : 'text-gray-600'}`;
  return <div className="mt-4 rounded-xl border bg-gray-50 p-3">
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div><div className="text-sm font-semibold text-gray-800">Guest orders</div><p className="text-xs text-gray-600">When off, members and admins cannot add new guest orders. Cancelling and history still work.</p></div>
      <div className="flex gap-1 rounded-lg bg-gray-200 p-1 sm:w-48" role="group" aria-label="Guest orders">
        <button type="button" disabled={!canEdit || busy} aria-pressed={enabled} onClick={() => void set(true)} className={btn(true)}>On</button>
        <button type="button" disabled={!canEdit || busy} aria-pressed={!enabled} onClick={() => void set(false)} className={btn(false)}>Off</button>
      </div>
    </div>
    {!canEdit && <p className="mt-2 text-xs text-gray-500">Only admins with payments permission can change this.</p>}
    {msg && <p className="mt-2 text-xs text-gray-700">{msg}</p>}
  </div>;
};
export default GuestOrdersToggle;
