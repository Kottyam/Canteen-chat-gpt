import React, { useState } from 'react';
import {
  loadSuperAdminCanteenMembers, loadSuperAdminCanteenMenu,
  SuperAdminCanteenMember, SuperAdminCanteenMenu,
} from '../../services/superAdminCanteenSummary';

const rs = (n: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(n) || 0);
const day = (v?: string | null) => v ? new Date(v).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const roleLabel = (m: SuperAdminCanteenMember) => m.role === 'admin' ? `Admin${m.admin_role ? ` (${m.admin_role.replace(/_/g, ' ')})` : ''}` : 'Member';
const Pill: React.FC<{ on: boolean; yes?: string; no?: string }> = ({ on, yes = 'Active', no = 'Inactive' }) =>
  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${on ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>{on ? yes : no}</span>;

/** Super Admin → Canteens → Details: Members / Menu, each loaded only when opened. Read-only. */
const SuperAdminCanteenLists: React.FC<{ canteenId: string }> = ({ canteenId }) => {
  const [view, setView] = useState<'none' | 'members' | 'menu'>('none');
  const [members, setMembers] = useState<SuperAdminCanteenMember[] | null>(null);
  const [menu, setMenu] = useState<SuperAdminCanteenMenu | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showDeleted, setShowDeleted] = useState(false);

  const open = async (next: 'members' | 'menu') => {
    if (view === next) { setView('none'); return; }
    setView(next); setError('');
    if ((next === 'members' && members) || (next === 'menu' && menu)) return;
    setLoading(true);
    try {
      if (next === 'members') setMembers(await loadSuperAdminCanteenMembers(canteenId));
      else setMenu(await loadSuperAdminCanteenMenu(canteenId));
    } catch (e: any) { setError(e?.message || 'Could not load.'); }
    finally { setLoading(false); }
  };

  const btn = (key: 'members' | 'menu', label: string) => (
    <button type="button" data-testid={`sa-view-${key}`} onClick={() => void open(key)}
      className={`rounded-lg px-3 py-2 text-sm font-bold ${view === key ? 'bg-primary-600 text-white' : 'border border-primary-200 bg-primary-50 text-primary-700'}`}>{label}</button>
  );

  const visibleMembers = (members || []).filter(m => showDeleted || m.status !== 'deleted');
  const deletedCount = (members || []).filter(m => m.status === 'deleted').length;
  const weeklyByDay = (menu?.weekly || []).reduce<Record<number, SuperAdminCanteenMenu['weekly']>>((acc, w) => { (acc[w.weekday] ||= []).push(w); return acc; }, {});

  return (
    <div className="mt-5" data-testid="sa-canteen-lists">
      <div className="flex flex-wrap gap-2">{btn('members', 'View Members')}{btn('menu', 'View Menu')}</div>
      {error && <p className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>}
      {loading && <p className="mt-3 text-sm text-gray-600">Loading…</p>}

      {view === 'members' && members && !loading && (
        <div className="mt-3" data-testid="sa-members">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm">
            <b>{visibleMembers.length} {visibleMembers.length === 1 ? 'person' : 'people'}</b>
            {deletedCount > 0 && <label className="flex items-center gap-2 text-xs text-gray-600"><input type="checkbox" checked={showDeleted} onChange={e => setShowDeleted(e.target.checked)} /> Show deleted ({deletedCount})</label>}
          </div>
          <div className="overflow-x-auto rounded-xl border">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-gray-50 text-xs text-gray-600"><tr>{['Name', 'Code', 'Phone', 'Email', 'Role', 'Status', 'Joined'].map(h => <th key={h} className="p-2">{h}</th>)}</tr></thead>
              <tbody>{visibleMembers.map(m => (
                <tr key={m.id} className="border-t">
                  <td className="p-2 font-semibold">{m.name || '—'}</td>
                  <td className="p-2 text-xs">{m.sr_number || (m.employee_code && !m.employee_code.startsWith('GOOGLE-') ? m.employee_code : '—')}</td>
                  <td className="p-2">{m.mobile || '—'}</td>
                  <td className="p-2">{m.email && !/@gocanteen\.local$/i.test(m.email) ? m.email : '—'}</td>
                  <td className="p-2">{roleLabel(m)}</td>
                  <td className="p-2">{m.status === 'deleted' ? <span className="text-xs font-semibold text-red-600">Deleted</span> : <Pill on={m.status === 'active'} />}</td>
                  <td className="p-2">{day(m.joined_at)}</td>
                </tr>))}
                {!visibleMembers.length && <tr><td className="p-4 text-gray-500" colSpan={7}>No members.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {view === 'menu' && menu && !loading && (
        <div className="mt-3 space-y-4" data-testid="sa-menu">
          <div>
            <div className="mb-2 text-sm font-bold">Menu items &amp; prices</div>
            <div className="overflow-x-auto rounded-xl border">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-gray-50 text-xs text-gray-600"><tr>{['Item', 'Category', 'Price', 'Availability'].map(h => <th key={h} className="p-2">{h}</th>)}</tr></thead>
                <tbody>{menu.items.map(i => (
                  <tr key={i.item_code} className="border-t">
                    <td className="p-2 font-semibold">{i.item_name}</td><td className="p-2">{i.category || '—'}</td><td className="p-2">{rs(i.unit_price)}</td>
                    <td className="p-2">{i.archived ? <span className="text-xs font-semibold text-gray-500">Archived</span> : <Pill on={i.active} yes="Available" no="Unavailable" />}</td>
                  </tr>))}
                  {!menu.items.length && <tr><td className="p-4 text-gray-500" colSpan={4}>No menu items in the price list.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
          <div>
            <div className="mb-2 text-sm font-bold">Today's menu ({day(menu.today)})</div>
            {menu.today_menu.length ? <div className="flex flex-wrap gap-2">{menu.today_menu.map(i => <span key={i.item_code} className={`rounded-lg border px-2 py-1 text-xs ${i.active ? '' : 'opacity-50 line-through'}`}>{i.item_name} · {rs(i.unit_price)}{i.pooling_special ? ' · special' : ''}</span>)}</div> : <p className="text-sm text-gray-500">No menu set for today.</p>}
          </div>
          <div>
            <div className="mb-2 text-sm font-bold">Weekly menu</div>
            {Object.keys(weeklyByDay).length ? <div className="grid gap-2 sm:grid-cols-2">{Object.keys(weeklyByDay).map(Number).sort((a, b) => a - b).map(d => (
              <div key={d} className="rounded-lg border p-2">
                <div className="text-xs font-bold text-gray-700">{WEEKDAYS[d] || `Day ${d}`}</div>
                <ul className="mt-1 space-y-0.5 text-sm">{weeklyByDay[d].map(w => <li key={w.item_code} className={w.active ? '' : 'opacity-50 line-through'}>{w.item_name} — {rs(w.unit_price)}</li>)}</ul>
              </div>))}</div> : <p className="text-sm text-gray-500">No weekly menu.</p>}
          </div>
        </div>
      )}
    </div>
  );
};

export default SuperAdminCanteenLists;
