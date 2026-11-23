// Presentational admin landing (Overview top). Read-only: uses existing data loaders; quick actions only navigate.
import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import { getOrderTargetDate, loadOrderForSetting, OrderFor } from '../../utils/orderTargetDate';
import { loadPaymentsForMonth } from '../../services/payments';
import { loadAdminBills } from '../../services/monthlyBills';
import { previousBillingPeriod, istBusinessDate } from '../../supabase/functions/_shared/poolingBilling';
import { formatBusinessDayHeading, formatOrderDayDate, getMemberGreeting } from '../../utils/memberHome';

export type AdminHomeAction = 'place-order' | 'kitchen' | 'expense' | 'bills' | 'payments';

interface Props {
  onAction: (action: AdminHomeAction) => void;
  available: Record<AdminHomeAction, boolean>;
}

const monthName = (year: number, month: number) =>
  new Date(year, month - 1, 1).toLocaleString('en-IN', { month: 'long' });

const AdminHome: React.FC<Props> = ({ onAction, available }) => {
  const { user } = useAuth();
  const { orders, users, menuItems } = useData();
  const [orderFor, setOrderFor] = useState<OrderFor>('today');
  const [pendingPayments, setPendingPayments] = useState<number | null>(null);
  const [billState, setBillState] = useState<{ published: number; total: number } | null>(null);
  const now = useMemo(() => new Date(), []);
  const period = useMemo(() => previousBillingPeriod(now), [now]);
  const [curY, curM] = istBusinessDate(now).split('-').map(Number);

  useEffect(() => {
    let alive = true;
    void loadOrderForSetting().then(v => { if (alive) setOrderFor(v); }).catch(() => {});
    if (available.payments) {
      void loadPaymentsForMonth(curM, curY)
        .then(rows => { if (alive) setPendingPayments(rows.filter((r: any) => r.status === 'pending_verification').length); })
        .catch(() => { if (alive) setPendingPayments(null); });
    }
    if (available.bills) {
      void loadAdminBills(period.month, period.year)
        .then(rows => { if (alive) setBillState({ published: rows.filter(b => b.published).length, total: rows.length }); })
        .catch(() => { if (alive) setBillState(null); });
    }
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const targetDate = getOrderTargetDate(orderFor, now);
  const dayLabel = orderFor === 'tomorrow' ? 'Tomorrow’s' : 'Today’s';
  const dayOrders = useMemo(
    () => (orders || []).filter((o: any) => o.date === targetDate && o.status !== 'cancelled'),
    [orders, targetDate]
  );
  const memberOrderCount = useMemo(
    () => new Set(
      dayOrders
        .filter((o: any) => Object.keys(o.items || {}).some(c => o.items[c]))
        .map((o: any) => o.memberIdentityId || o.employeeId)
    ).size,
    [dayOrders]
  );
  const activeMembers = useMemo(
    () => (users || []).filter((u: any) => u.role === 'employee' && u.status === 'active').length,
    [users]
  );
  const kitchenRows = useMemo(() => {
    const names = new Map<string, string>();
    (menuItems || []).forEach((m: any) => names.set(m.itemCode, m.itemName));
    const totals = new Map<string, { name: string; qty: number }>();
    const add = (items: any, qtys: any, snap: any) => {
      Object.keys(items || {}).filter(c => items[c]).forEach(code => {
        const qty = Number(qtys?.[code] ?? 1) || 1;
        const name = snap?.[code] || names.get(code) || code;
        const cur = totals.get(code) || { name, qty: 0 };
        cur.qty += qty;
        totals.set(code, cur);
      });
    };
    dayOrders.forEach((o: any) => {
      add(o.items, o.itemQuantities, o.itemNames);
      add(o.guestItems, o.guestItemQuantities, o.guestItemNames);
    });
    return [...totals.values()].sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name));
  }, [dayOrders, menuItems]);
  const kitchenTotal = kitchenRows.reduce((s, r) => s + r.qty, 0);
  const firstName = (user?.name || 'Admin').trim().split(/\s+/)[0];

  const billMonth = monthName(period.year, period.month);
  const billValue = !billState ? '—' : billState.published > 0 ? 'Published' : 'Draft';
  const billSub = !billState
    ? 'Open Monthly Reports'
    : billState.published > 0
      ? `${billState.published} member bill${billState.published === 1 ? '' : 's'} published`
      : 'not published yet';

  const Stat: React.FC<{ testId: string; title: string; value: React.ReactNode; sub: string; tone?: 'amber' | 'green'; onClick?: () => void }> = ({ testId, title, value, sub, tone, onClick }) => {
    const toneCls = tone === 'amber'
      ? 'border-amber-200 bg-amber-50 text-amber-900'
      : tone === 'green'
        ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
        : 'border-gray-100 bg-white text-gray-900';
    const Tag: any = onClick ? 'button' : 'div';
    return (
      <Tag type={onClick ? 'button' : undefined} onClick={onClick} data-testid={testId}
        className={`w-full rounded-2xl border p-4 text-left shadow-sm ${toneCls} ${onClick ? 'hover:shadow-md' : ''}`}>
        <p className="text-xs font-semibold opacity-80">{title}</p>
        <p className="mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">{value}</p>
        <p className="mt-0.5 text-xs opacity-80">{sub}</p>
      </Tag>
    );
  };

  const actions: { key: AdminHomeAction; label: string; icon: string; primary?: boolean }[] = [
    { key: 'place-order', label: 'Place an order', icon: '+', primary: true },
    { key: 'kitchen', label: 'Kitchen list', icon: '🍲' },
    { key: 'expense', label: 'Add an expense', icon: '₹' },
    { key: 'bills', label: `${billMonth} bills`, icon: '📄' },
    { key: 'payments', label: pendingPayments ? `Review ${pendingPayments} payment${pendingPayments === 1 ? '' : 's'}` : 'Payment checks', icon: '✓' },
  ];
  const visibleActions = actions.filter(a => available[a.key]);

  return (
    <div data-testid="admin-home" className="space-y-5">
      <section>
        <p className="text-[11px] font-bold uppercase tracking-wider text-gray-500">{formatBusinessDayHeading(now)}</p>
        <h2 className="mt-0.5 text-2xl font-extrabold tracking-tight text-gray-900 sm:text-3xl">{getMemberGreeting(firstName, now)}</h2>
        <p data-testid="admin-home-day" className="mt-1 text-sm font-semibold text-primary-700">
          Showing {orderFor === 'tomorrow' ? 'tomorrow' : 'today'} · {formatOrderDayDate(targetDate)}
        </p>
      </section>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat testId="admin-home-orders" title={`${dayLabel} orders`}
          value={<>{memberOrderCount}{activeMembers > 0 && <span className="text-base font-bold text-gray-400"> / {activeMembers}</span>}</>}
          sub="members ordered" />
        <Stat testId="admin-home-kitchen" title={orderFor === 'tomorrow' ? 'Kitchen tomorrow' : 'Kitchen today'} value={kitchenTotal} sub="items to prepare" />
        {available.payments && (
          <Stat testId="admin-home-payments" title="Payments to check" value={pendingPayments ?? '—'} sub="waiting confirmation" tone="amber"
            onClick={() => onAction('payments')} />
        )}
        {available.bills && (
          <Stat testId="admin-home-bills" title={`${billMonth} bills`} value={billValue} sub={billSub} tone="green"
            onClick={() => onAction('bills')} />
        )}
      </section>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {visibleActions.length > 0 && (
          <section className="lg:order-2">
            <p className="mb-2 text-xs font-bold uppercase tracking-wider text-gray-500">Quick actions</p>
            <div data-testid="admin-home-actions" className="grid grid-cols-2 gap-3 lg:grid-cols-1">
              {visibleActions.map(a => (
                <button key={a.key} type="button" onClick={() => onAction(a.key)}
                  className={`flex min-h-14 items-center gap-3 rounded-2xl border px-4 py-3 text-left text-sm font-bold shadow-sm ${a.primary ? 'border-primary-600 bg-primary-600 text-white hover:bg-primary-700' : 'border-gray-100 bg-white text-gray-900 hover:bg-gray-50'}`}>
                  <span aria-hidden="true" className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${a.primary ? 'bg-white/20' : 'bg-primary-50 text-primary-700'}`}>{a.icon}</span>
                  <span>{a.label}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        <section data-testid="admin-home-kitchen-list" className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm lg:col-span-2 lg:order-1">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-base font-extrabold text-gray-900">{orderFor === 'tomorrow' ? 'Tomorrow in the kitchen' : 'Today in the kitchen'}</h3>
            {available.kitchen && (
              <button type="button" onClick={() => onAction('kitchen')} className="text-xs font-bold text-primary-700 hover:text-primary-800">Open kitchen list</button>
            )}
          </div>
          {kitchenRows.length === 0 ? (
            <p className="mt-3 text-sm text-gray-500">No food orders yet for {orderFor === 'tomorrow' ? 'tomorrow' : 'today'}.</p>
          ) : (
            <ul className="mt-3 grid grid-cols-1 gap-x-8 sm:grid-cols-2">
              {kitchenRows.map(r => (
                <li key={r.name} className="flex items-center justify-between border-b border-gray-100 py-2 text-sm">
                  <span className="text-gray-800">{r.name}</span>
                  <span className="font-bold tabular-nums text-gray-900">{r.qty}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
};

export default AdminHome;
