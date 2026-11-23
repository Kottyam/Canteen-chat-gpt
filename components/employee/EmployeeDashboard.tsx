import React, { useCallback, useEffect, useMemo, useState } from 'react';
import CanteenHeader from '../shared/CanteenHeader';
import OrderForm from './OrderForm';
import GuestMealForm from './GuestMealForm';
import OrderCalendar from './OrderCalendar';
import OrderModeTabs from './OrderModeTabs';
import MemberPoll from './MemberPoll';
import Bills from './Bills';
import Notifications from './Notifications';
import ChangePasswordModal from '../auth/ChangePasswordModal';
import InstallPrompt from '../common/InstallPrompt';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import { MenuItem, Order } from '../../types';
import { loadEmployeeAdjustments, EmployeeAdjustment } from '../../services/employeeAdjustments';
import { getOrderTargetDate, loadOrderForSetting, OrderFor } from '../../utils/orderTargetDate';
import { loadOrderWindowStatus, OrderWindowStatus } from '../../utils/orderWindowStatus';
import { consumePendingPushAction } from '../../services/memberPushNotifications';
import { cancelOrder, getWeeklyMenuForDate } from '../../services/supabaseSync';
import { supabase, supabaseEnabled } from '../../supabase';
import { loadPublishedBills, MonthlyBill } from '../../services/monthlyBills';
import { BillPayment, loadMyBillPayments } from '../../services/payments';
import { useBillingSettings } from '../../hooks/useBillingSettings';
import {
  menuSpecialLabel,
  useGuestOrdersEnabled,
  useMenuSpecialsForDate,
} from '../../hooks/usePoolingSpecials';
import { useActivePoll } from '../../hooks/usePoll';
import { formatDate } from '../../utils/helpers';
import {
  computeOrderCutoffBanner,
  findNextHolidayNotice,
  formatBusinessDayHeading,
  getMemberGreeting,
  OrderWindowSettingsRow,
  summarizeMemberBill,
} from '../../utils/memberHome';

const formatRupeesCompact = (value: number): string => {
  const rounded = Math.round((Number(value) || 0) * 100) / 100;
  if (Math.abs(rounded - Math.round(rounded)) < 0.001) {
    return Math.round(rounded).toLocaleString('en-IN');
  }
  return rounded.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const summarizeOrderLines = (
  items: Record<string, boolean> | undefined,
  quantities: Record<string, number> | undefined,
  snapshotNames: Record<string, string> | undefined,
  nameByCode: Map<string, string>
): string[] => {
  if (!items) return [];
  return Object.keys(items)
    .filter(code => Boolean(items[code]))
    .map(code => {
      const label = snapshotNames?.[code] || nameByCode.get(code) || code;
      const n = Number(quantities?.[code] ?? 1);
      return n > 1 ? `${label} × ${n}` : label;
    });
};

const EmployeeDashboard: React.FC = () => {
  const { user, logout } = useAuth();
  const { orders, setOrders, refreshOrders, menuItems, holidays } = useData();
  const { pooling } = useBillingSettings();
  const guestOrdersOn = useGuestOrdersEnabled();
  const { poll: activePoll, open: activePollOpen } = useActivePoll();

  const [activeTab, setActiveTab] = useState<'home' | 'orders' | 'bills' | 'profile'>('home');
  const [orderMode, setOrderMode] = useState<'me' | 'guest'>('me');
  const [showNotifications, setShowNotifications] = useState(false);
  const [openBillId, setOpenBillId] = useState<string | null>(null);
  const [isPasswordModalOpen, setPasswordModalOpen] = useState(false);

  const [orderFor, setOrderFor] = useState<OrderFor>('today');
  const [viewDay, setViewDay] = useState<OrderFor>('today');
  const [nowTick, setNowTick] = useState<Date>(() => new Date());

  const [windowSettings, setWindowSettings] = useState<OrderWindowSettingsRow | null>(null);
  const [todayStatus, setTodayStatus] = useState<OrderWindowStatus>({
    holiday: false,
    windowOpen: true,
    title: '',
    message: '',
  });
  const [tomorrowStatus, setTomorrowStatus] = useState<OrderWindowStatus>({
    holiday: false,
    windowOpen: true,
    title: '',
    message: '',
  });
  const [declaredHolidayDates, setDeclaredHolidayDates] = useState<string[]>([]);

  const [adminAddedRows, setAdminAddedRows] = useState<EmployeeAdjustment[]>([]);
  const [weeklyMenu, setWeeklyMenu] = useState<MenuItem[]>([]);
  const [menuLoading, setMenuLoading] = useState(true);

  const [bills, setBills] = useState<MonthlyBill[]>([]);
  const [billPayments, setBillPayments] = useState<BillPayment[]>([]);
  const [billsLoading, setBillsLoading] = useState(true);

  const [cancelling, setCancelling] = useState(false);
  const [homeMsg, setHomeMsg] = useState<string>('');
  const [pollExpanded, setPollExpanded] = useState(false);

  const todayDate = getOrderTargetDate('today', nowTick);
  const tomorrowDate = getOrderTargetDate('tomorrow', nowTick);
  const viewDate = viewDay === 'tomorrow' ? tomorrowDate : todayDate;
  const dayStatus = viewDay === 'tomorrow' ? tomorrowStatus : todayStatus;
  const specialsMap = useMenuSpecialsForDate(viewDate);

  const orderEmployeeKey = user?.memberLoginMode === 'mobile' ? user.mobile : user?.id;
  const memberName = user?.name || user?.id || 'Member';

  const nameByCode = useMemo(() => {
    const map = new Map<string, string>();
    (menuItems || []).forEach(item => {
      if (item.itemCode) map.set(item.itemCode, item.itemName || item.itemCode);
    });
    weeklyMenu.forEach(item => {
      if (item.itemCode && item.itemName) map.set(item.itemCode, item.itemName);
    });
    return map;
  }, [menuItems, weeklyMenu]);

  const viewOrder = useMemo<Order | null>(() => {
    if (!orderEmployeeKey) return null;
    const active = (orders || []).filter(
      o =>
        o.employeeId === orderEmployeeKey &&
        o.date === viewDate &&
        o.status !== 'cancelled' &&
        (o.orderSource === 'admin' ||
          Object.keys(o.items || {}).some(c => Boolean(o.items[c])) ||
          Object.keys(o.guestItems || {}).some(c => Boolean(o.guestItems?.[c])))
    );
    return active.sort((a, b) => String((b as any).createdAt || '').localeCompare(String((a as any).createdAt || '')))[0] || null;
  }, [orders, orderEmployeeKey, viewDate]);

  const memberOrderLines = useMemo(
    () =>
      summarizeOrderLines(
        viewOrder?.items,
        viewOrder?.itemQuantities,
        viewOrder?.itemNames,
        nameByCode
      ),
    [viewOrder, nameByCode]
  );
  const guestOrderLines = useMemo(
    () =>
      summarizeOrderLines(
        viewOrder?.guestItems,
        viewOrder?.guestItemQuantities,
        viewOrder?.guestItemNames,
        nameByCode
      ),
    [viewOrder, nameByCode]
  );

  const hasMemberItems = memberOrderLines.length > 0;
  const hasGuestItems = guestOrderLines.length > 0;
  const hasAnyOrder = hasMemberItems || hasGuestItems || viewOrder?.orderSource === 'admin';
  const viewAdminAdded = useMemo(
    () => adminAddedRows.filter(a => a.adjustment_date === viewDate),
    [adminAddedRows, viewDate]
  );

  const canCancel = Boolean(
    hasMemberItems && !dayStatus.holiday && dayStatus.windowOpen && viewDay === orderFor && !cancelling
  );
  const canOrderOnViewDay = Boolean(!dayStatus.holiday && dayStatus.windowOpen && viewDay === orderFor);

  const activeWeeklyMenu = useMemo(
    () => weeklyMenu.filter(item => item.active && !item.archived),
    [weeklyMenu]
  );

  const billSummary = useMemo(
    () => summarizeMemberBill(bills, billPayments),
    [bills, billPayments]
  );

  const holidayNotice = useMemo(
    () =>
      findNextHolidayNotice(
        [...(holidays || []), ...declaredHolidayDates],
        todayStatus.holiday,
        tomorrowStatus.holiday,
        nowTick
      ),
    [holidays, declaredHolidayDates, todayStatus.holiday, tomorrowStatus.holiday, nowTick]
  );

  const cutoffBanner = useMemo(
    () => computeOrderCutoffBanner(windowSettings, dayStatus, viewDay, orderFor, nowTick),
    [windowSettings, dayStatus, viewDay, orderFor, nowTick]
  );

  const loadWindowAndHolidays = useCallback(async () => {
    const now = new Date();
    const tDate = getOrderTargetDate('today', now);
    const tmDate = getOrderTargetDate('tomorrow', now);
    try {
      const nextOrderFor = await loadOrderForSetting();
      setOrderFor(nextOrderFor);
    } catch {
      setOrderFor('today');
    }
    if (supabaseEnabled && supabase) {
      try {
        const { data: settingsRow } = await supabase
          .from('order_window_settings')
          .select('enabled,start_time,end_time,order_for')
          .maybeSingle();
        if (settingsRow) {
          setWindowSettings({
            enabled: Boolean(settingsRow.enabled),
            start_time: settingsRow.start_time || null,
            end_time: settingsRow.end_time || null,
            order_for: settingsRow.order_for === 'tomorrow' ? 'tomorrow' : 'today',
          });
        }
      } catch {
        // Keep existing window settings if unavailable
      }
      try {
        const todayIso = formatDate(now);
        const { data: hdRows } = await supabase
          .from('holiday_dates')
          .select('holiday_date')
          .gte('holiday_date', todayIso)
          .order('holiday_date', { ascending: true })
          .limit(5);
        if (Array.isArray(hdRows)) {
          setDeclaredHolidayDates(
            hdRows.map((r: any) => String(r.holiday_date || '').slice(0, 10)).filter(Boolean)
          );
        }
      } catch {
        setDeclaredHolidayDates([]);
      }
    }
    try {
      const [sToday, sTomorrow] = await Promise.all([
        loadOrderWindowStatus(tDate, 'Today'),
        loadOrderWindowStatus(tmDate, 'Tomorrow'),
      ]);
      setTodayStatus(sToday);
      setTomorrowStatus(sTomorrow);
    } catch {
      // Fallback safely
    }
  }, []);

  const loadBillsData = useCallback(async () => {
    setBillsLoading(true);
    try {
      const loadedBills = await loadPublishedBills();
      setBills(loadedBills);
      if (loadedBills.length) {
        const loadedPayments = await loadMyBillPayments(loadedBills.map(b => b.id));
        setBillPayments(loadedPayments);
      } else {
        setBillPayments([]);
      }
    } catch {
      setBills([]);
      setBillPayments([]);
    } finally {
      setBillsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadWindowAndHolidays();
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        setNowTick(new Date());
        void loadWindowAndHolidays();
      }
    };
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    const pollTimer = window.setInterval(() => {
      setNowTick(new Date());
      void loadWindowAndHolidays();
    }, 15000);
    const clockTimer = window.setInterval(() => setNowTick(new Date()), 30000);
    return () => {
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(pollTimer);
      window.clearInterval(clockTimer);
    };
  }, [loadWindowAndHolidays]);

  useEffect(() => {
    let alive = true;
    if (!user) {
      setAdminAddedRows([]);
      return;
    }
    const load = async () => {
      try {
        const rows = await loadEmployeeAdjustments(user.identityId || user.id);
        if (alive) setAdminAddedRows(rows);
      } catch {
        if (alive) setAdminAddedRows([]);
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 15000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [user, viewDate]);

  useEffect(() => {
    let alive = true;
    setMenuLoading(true);
    void getWeeklyMenuForDate(viewDate)
      .then(items => {
        if (alive) setWeeklyMenu(items);
      })
      .catch(() => {
        if (alive) setWeeklyMenu([]);
      })
      .finally(() => {
        if (alive) setMenuLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [viewDate]);

  useEffect(() => {
    if (!user) {
      setBills([]);
      setBillPayments([]);
      setBillsLoading(false);
      return;
    }
    void loadBillsData();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void loadBillsData();
    };
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [user, loadBillsData]);

  const openBill = useCallback((billId: string) => {
    setOpenBillId(billId);
    setShowNotifications(false);
    setActiveTab('bills');
  }, []);

  useEffect(() => {
    const openPush = (payload: Record<string, unknown>) => {
      const billId = typeof payload?.bill_id === 'string' ? payload.bill_id : null;
      const screen = typeof payload?.screen === 'string' ? payload.screen : '';
      const type = typeof payload?.notification_type === 'string' ? payload.notification_type : '';
      const pollId = typeof payload?.poll_id === 'string' ? payload.poll_id : null;
      if (billId) openBill(billId);
      else if (screen === 'poll' || type === 'poll_open' || pollId) {
        setShowNotifications(false);
        setActiveTab('orders');
      } else {
        setShowNotifications(true);
      }
    };
    const onTap = (event: Event) =>
      openPush(((event as CustomEvent).detail || {}) as Record<string, unknown>);
    window.addEventListener('gocanteen:push-tap', onTap);
    const pending = consumePendingPushAction();
    if (pending) window.setTimeout(() => openPush(pending), 0);
    return () => window.removeEventListener('gocanteen:push-tap', onTap);
  }, [openBill]);

  const handleCancelOrder = async () => {
    if (!viewOrder || !canCancel) return;
    if (!window.confirm(`Cancel your member order for ${viewDate}?`)) return;
    setCancelling(true);
    setHomeMsg('');
    try {
      await cancelOrder(viewOrder, 'employee');
      setOrders(await refreshOrders());
      setHomeMsg(`${viewDay === 'tomorrow' ? 'Tomorrow’s' : 'Today’s'} member order has been cancelled.`);
    } catch (e: any) {
      setHomeMsg(e?.message || 'Could not cancel order.');
    } finally {
      setCancelling(false);
    }
  };

  const openOrdersTab = (mode: 'me' | 'guest') => {
    setOrderMode(mode);
    setShowNotifications(false);
    setActiveTab('orders');
  };

  const renderHome = () => {
    const mealTitle = viewDay === 'tomorrow' ? 'Tomorrow’s meal' : 'Today’s meal';
    const menuTitle = viewDay === 'tomorrow' ? 'Tomorrow’s menu' : 'Today’s menu';
    const hasNotices = Boolean(holidayNotice || (activePoll && activePollOpen));

    const cutoffStyle =
      cutoffBanner.tone === 'green'
        ? {
            box: 'border-emerald-200 bg-emerald-50/90',
            dot: 'bg-emerald-500',
            title: 'text-emerald-950',
            sub: 'text-emerald-800',
          }
        : cutoffBanner.tone === 'amber'
          ? {
              box: 'border-amber-200 bg-amber-50/90',
              dot: 'bg-amber-500',
              title: 'text-amber-950',
              sub: 'text-amber-800',
            }
          : {
              box: 'border-slate-200 bg-white',
              dot: 'bg-slate-400',
              title: 'text-slate-900',
              sub: 'text-slate-600',
            };

    const statusBadge = dayStatus.holiday
      ? { label: 'Holiday', cls: 'bg-amber-100 text-amber-800' }
      : hasMemberItems
        ? { label: 'Ordered', cls: 'bg-emerald-100 text-emerald-800' }
        : hasGuestItems
          ? { label: 'Guest order', cls: 'bg-sky-100 text-sky-800' }
          : viewOrder?.orderSource === 'admin'
            ? { label: 'Admin added', cls: 'bg-emerald-100 text-emerald-800' }
            : { label: 'Not ordered', cls: 'bg-slate-100 text-slate-700' };

    return (
      <div className="space-y-4">
        {/* Greeting */}
        <section className="px-0.5 pt-1">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
            {formatBusinessDayHeading(nowTick)}
          </p>
          <h2 className="mt-0.5 text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl">
            {getMemberGreeting(memberName, nowTick)}
          </h2>
        </section>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:items-start">
          {/* Left column on desktop (7 cols) */}
          <div className="space-y-4 lg:col-span-7">
            {/* Cutoff Countdown Banner */}
            <section
              data-testid="home-cutoff-banner"
              className={`flex items-start gap-3 rounded-2xl border px-4 py-3 shadow-xs ${cutoffStyle.box}`}
            >
              <span
                aria-hidden="true"
                className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${cutoffStyle.dot}`}
              />
              <div className="min-w-0">
                <p className={`text-sm font-bold ${cutoffStyle.title}`}>{cutoffBanner.title}</p>
                <p className={`mt-0.5 text-xs font-medium ${cutoffStyle.sub}`}>{cutoffBanner.subtitle}</p>
              </div>
            </section>

            {/* Today / Tomorrow Switch + Meal Card */}
            <section
              data-testid="home-meal-card"
              className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm sm:p-5"
            >
              <div
                role="tablist"
                aria-label="Select meal day"
                className="grid grid-cols-2 rounded-xl bg-slate-100 p-1"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={viewDay === 'today'}
                  onClick={() => {
                    setHomeMsg('');
                    setViewDay('today');
                  }}
                  className={`min-h-9 rounded-lg px-3 py-1.5 text-xs font-bold transition sm:text-sm ${
                    viewDay === 'today'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Today
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={viewDay === 'tomorrow'}
                  onClick={() => {
                    setHomeMsg('');
                    setViewDay('tomorrow');
                  }}
                  className={`min-h-9 rounded-lg px-3 py-1.5 text-xs font-bold transition sm:text-sm ${
                    viewDay === 'tomorrow'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Tomorrow
                </button>
              </div>

              <div className="mt-4 flex items-center justify-between gap-3">
                <h3 className="text-base font-extrabold text-slate-900 sm:text-lg">{mealTitle}</h3>
                <span
                  data-testid="home-meal-status"
                  className={`rounded-full px-2.5 py-1 text-xs font-bold ${statusBadge.cls}`}
                >
                  {statusBadge.label}
                </span>
              </div>

              {homeMsg && (
                <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700">
                  {homeMsg}
                </p>
              )}

              {hasAnyOrder ? (
                <div className="mt-3 space-y-3">
                  {memberOrderLines.length > 0 && (
                    <p className="text-sm font-medium text-slate-700">{memberOrderLines.join(' · ')}</p>
                  )}
                  {guestOrderLines.length > 0 && (
                    <p className="text-xs font-semibold text-sky-700">
                      Guest: {guestOrderLines.join(' · ')}
                    </p>
                  )}
                  {viewAdminAdded.length > 0 && (
                    <p className="text-xs font-medium text-slate-600">
                      Admin added:{' '}
                      {viewAdminAdded
                        .map(a => `${a.description?.trim() || 'Added Amount'} (₹${Number(a.amount || 0).toFixed(0)})`)
                        .join(', ')}
                    </p>
                  )}

                  <div className="flex flex-wrap gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => openOrdersTab(!hasMemberItems && hasGuestItems ? 'guest' : 'me')}
                      className="min-h-10 flex-1 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-800 hover:bg-slate-50"
                    >
                      View order
                    </button>
                    {canCancel && (
                      <button
                        type="button"
                        disabled={cancelling}
                        onClick={() => void handleCancelOrder()}
                        className="min-h-10 flex-1 rounded-xl border border-red-200 bg-red-50/70 px-4 py-2 text-sm font-bold text-red-700 hover:bg-red-100 disabled:opacity-50"
                      >
                        {cancelling ? 'Cancelling…' : 'Cancel order'}
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="mt-3 space-y-3">
                  <p className="text-sm text-slate-600">
                    {dayStatus.holiday
                      ? 'The kitchen is closed for a holiday.'
                      : canOrderOnViewDay
                        ? `No meal ordered yet for ${viewDay}.`
                        : viewDay !== orderFor
                          ? `Active ordering is currently set to ${orderFor}.`
                          : `Ordering for ${viewDay} is currently closed.`}
                  </p>
                  {viewAdminAdded.length > 0 && (
                    <p className="text-xs font-medium text-slate-600">
                      Admin added:{' '}
                      {viewAdminAdded
                        .map(a => `${a.description?.trim() || 'Added Amount'} (₹${Number(a.amount || 0).toFixed(0)})`)
                        .join(', ')}
                    </p>
                  )}
                  {canOrderOnViewDay && (
                    <button
                      type="button"
                      onClick={() => openOrdersTab('me')}
                      className="min-h-11 w-full rounded-xl bg-primary-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-primary-700"
                    >
                      Place order
                    </button>
                  )}
                </div>
              )}

              {guestOrdersOn && canOrderOnViewDay && (
                <div className="mt-3 border-t border-slate-100 pt-3">
                  <button
                    type="button"
                    onClick={() => openOrdersTab('guest')}
                    className="text-xs font-bold text-primary-700 hover:text-primary-800"
                  >
                    + Order for guest
                  </button>
                </div>
              )}
            </section>

            {/* Today's / Tomorrow's Menu & Specials Card */}
            <section
              data-testid="home-menu-card"
              className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm sm:p-5"
            >
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-base font-extrabold text-slate-900 sm:text-lg">{menuTitle}</h3>
                <button
                  type="button"
                  onClick={() => openOrdersTab('me')}
                  className="text-xs font-bold text-primary-700 hover:text-primary-800"
                >
                  Full menu
                </button>
              </div>
              {menuLoading ? (
                <p className="mt-3 text-sm text-slate-500">Loading menu…</p>
              ) : activeWeeklyMenu.length === 0 ? (
                <p className="mt-3 text-sm text-slate-500">No menu items listed for {viewDay}.</p>
              ) : (
                <ul className="mt-3 divide-y divide-slate-100">
                  {activeWeeklyMenu.map(item => {
                    const specialText = menuSpecialLabel(specialsMap[item.itemCode]);
                    const onOrder = Boolean(viewOrder?.items?.[item.itemCode]);
                    return (
                      <li
                        key={item.itemCode}
                        className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
                      >
                        <div className="min-w-0 flex items-center gap-2">
                          <span className="truncate text-sm font-semibold text-slate-800">
                            {item.itemName}
                          </span>
                          {specialText && (
                            <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800">
                              {specialText}
                            </span>
                          )}
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {onOrder && (
                            <span className="text-[11px] font-semibold text-slate-500">
                              On your order
                            </span>
                          )}
                          {!pooling && (
                            <span className="text-sm font-bold tabular-nums text-slate-700">
                              ₹{formatRupeesCompact(item.unitPrice)}
                            </span>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>

          {/* Right column on desktop (5 cols) */}
          <div className="space-y-4 lg:col-span-5">
            {/* Monthly Bill Card (read-only + opens existing Bills UPI modal) */}
            <section
              data-testid="home-bill-card"
              className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm sm:p-5"
            >
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  {billSummary.monthTitle}
                </h3>
                {!billSummary.canPayNow && (
                  <button
                    type="button"
                    onClick={() => {
                      if (billSummary.bill) openBill(billSummary.bill.id);
                      else {
                        setShowNotifications(false);
                        setActiveTab('bills');
                      }
                    }}
                    className="text-xs font-bold text-primary-700 hover:text-primary-800"
                  >
                    View bill
                  </button>
                )}
              </div>
              {billsLoading ? (
                <p className="mt-3 text-sm text-slate-500">Checking bill…</p>
              ) : (
                <>
                  <p className="mt-1.5 text-3xl font-extrabold tracking-tight tabular-nums text-slate-900">
                    ₹{formatRupeesCompact(billSummary.displayAmount)}
                  </p>
                  <p
                    className={`mt-1 text-xs font-semibold ${
                      billSummary.statusTone === 'amber'
                        ? 'text-amber-700'
                        : billSummary.statusTone === 'green'
                          ? 'text-emerald-700'
                          : 'text-slate-500'
                    }`}
                  >
                    {billSummary.statusText}
                  </p>
                  {billSummary.canPayNow && billSummary.bill && (
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => openBill(billSummary.bill!.id)}
                        className="min-h-10 flex-1 rounded-xl bg-primary-600 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-primary-700"
                      >
                        Pay now
                      </button>
                      <button
                        type="button"
                        onClick={() => openBill(billSummary.bill!.id)}
                        className="min-h-10 flex-1 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-800 hover:bg-slate-50"
                      >
                        View bill
                      </button>
                    </div>
                  )}
                </>
              )}
            </section>

            {/* Notices: Holiday Notice + Open Poll */}
            {hasNotices && (
              <section data-testid="home-notices" className="space-y-2.5">
                <p className="px-0.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  Notices
                </p>
                {holidayNotice && (
                  <div
                    data-testid="home-holiday-notice"
                    className="rounded-2xl border border-amber-200 bg-amber-50/90 p-4 shadow-xs"
                  >
                    <p className="text-sm font-extrabold text-amber-950">{holidayNotice.title}</p>
                    <p className="mt-1 text-xs font-medium text-amber-800">{holidayNotice.subtitle}</p>
                  </div>
                )}
                {activePoll && activePollOpen && (
                  <div
                    data-testid="home-poll-notice"
                    className="rounded-2xl border border-indigo-100 bg-white p-4 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <span className="inline-block rounded-full bg-indigo-50 px-2.5 py-0.5 text-[11px] font-bold text-indigo-700">
                          Open poll
                        </span>
                        <p className="mt-1.5 text-sm font-bold text-slate-900">{activePoll.title}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setPollExpanded(v => !v)}
                        className="shrink-0 rounded-xl bg-indigo-600 px-3 py-2 text-xs font-bold text-white shadow-xs hover:bg-indigo-700"
                      >
                        {pollExpanded ? 'Hide' : 'Vote now'}
                      </button>
                    </div>
                    {pollExpanded && (
                      <div className="mt-2">
                        <MemberPoll />
                      </div>
                    )}
                  </div>
                )}
              </section>
            )}

            {/* Inline Install Card (eligible non-native/non-iOS/non-standalone browsers only) */}
            <InstallPrompt variant="inline" />
          </div>
        </div>
      </div>
    );
  };

  const renderOtherTabs = () => {
    if (showNotifications) {
      return (
        <Notifications
          onBack={() => setShowNotifications(false)}
          onOpenBill={openBill}
        />
      );
    }
    if (activeTab === 'orders') {
      return (
        <div className="space-y-5">
          <OrderModeTabs mode={orderMode} onMode={setOrderMode} />
          {orderMode === 'me' || !guestOrdersOn ? <OrderForm /> : <GuestMealForm />}
          <MemberPoll />
          <section>
            <OrderCalendar />
          </section>
        </div>
      );
    }
    if (activeTab === 'bills') {
      return <Bills openBillId={openBillId} onBillOpened={() => setOpenBillId(null)} />;
    }
    return (
      <section className="mx-auto w-full max-w-xl">
        <h2 className="text-2xl font-bold text-primary-900">Profile</h2>
        <div className="mt-5 space-y-3 rounded-2xl border bg-white p-5">
          <div>
            <span className="text-xs text-gray-600">Member Name</span>
            <p className="font-semibold text-gray-800">{user?.name || '—'}</p>
          </div>
          <div>
            <span className="text-xs text-gray-600">
              {user?.memberLoginMode === 'mobile' ? 'Mobile Number' : 'Member / SR Number'}
            </span>
            <p className="font-semibold text-gray-800">
              {user?.memberLoginMode === 'mobile' ? user?.mobile || '—' : user?.id || '—'}
            </p>
          </div>
          {user?.memberLoginMode !== 'mobile' && (
            <div>
              <span className="text-xs text-gray-600">Mobile</span>
              <p className="font-semibold text-gray-800">{user?.mobile || '—'}</p>
            </div>
          )}
          <div className="flex flex-col gap-2 pt-3 sm:flex-row">
            <button
              type="button"
              onClick={() => setPasswordModalOpen(true)}
              className="rounded-lg bg-gray-100 px-4 py-3 font-semibold text-gray-700"
            >
              Change Password
            </button>
            <button
              type="button"
              onClick={() => void logout()}
              className="rounded-lg bg-red-600 px-4 py-3 font-semibold text-white shadow-sm"
            >
              Logout
            </button>
          </div>
        </div>
      </section>
    );
  };

  return (
    <div className="min-h-screen w-full overflow-x-hidden bg-slate-50 pb-[calc(5.5rem+env(safe-area-inset-bottom,0px))]">
      <CanteenHeader
        variant="member"
        onChangePassword={() => setPasswordModalOpen(true)}
        onOpenNotifications={() => setShowNotifications(true)}
        onOpenBill={openBill}
        onOpenProfile={() => {
          setShowNotifications(false);
          setActiveTab('profile');
        }}
      />
      <main className="mx-auto w-full max-w-6xl px-3.5 py-4 sm:px-6 sm:py-6">
        {activeTab === 'home' && !showNotifications ? (
          renderHome()
        ) : (
          <section className="w-full min-w-0 rounded-2xl border border-gray-100 bg-white p-3 shadow-md sm:p-6">
            {renderOtherTabs()}
          </section>
        )}
      </main>
      <nav
        aria-label="Member navigation"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 px-2 pt-2 shadow-[0_-2px_8px_rgba(0,0,0,0.06)] backdrop-blur"
        style={{ paddingBottom: 'calc(0.5rem + env(safe-area-inset-bottom,0px))' }}
      >
        <div className="mx-auto grid max-w-2xl grid-cols-4 gap-1">
          <button
            type="button"
            onClick={() => {
              setShowNotifications(false);
              setActiveTab('home');
            }}
            className={`min-h-10 touch-manipulation rounded-lg px-2 py-2 text-xs font-semibold sm:text-sm ${
              activeTab === 'home' && !showNotifications
                ? 'bg-primary-600 text-white shadow-sm'
                : 'text-gray-600'
            }`}
          >
            🏠 Home
          </button>
          <button
            type="button"
            onClick={() => {
              setShowNotifications(false);
              setActiveTab('orders');
            }}
            className={`min-h-10 touch-manipulation rounded-lg px-2 py-2 text-xs font-semibold sm:text-sm ${
              activeTab === 'orders' && !showNotifications
                ? 'bg-primary-600 text-white shadow-sm'
                : 'text-gray-600'
            }`}
          >
            🍛 Orders
          </button>
          <button
            type="button"
            onClick={() => {
              setShowNotifications(false);
              setActiveTab('bills');
            }}
            className={`min-h-10 touch-manipulation rounded-lg px-2 py-2 text-xs font-semibold sm:text-sm ${
              activeTab === 'bills' && !showNotifications
                ? 'bg-primary-600 text-white shadow-sm'
                : 'text-gray-600'
            }`}
          >
            🧾 Bills
          </button>
          <button
            type="button"
            onClick={() => {
              setShowNotifications(false);
              setActiveTab('profile');
            }}
            className={`min-h-10 touch-manipulation rounded-lg px-2 py-2 text-xs font-semibold sm:text-sm ${
              activeTab === 'profile' && !showNotifications
                ? 'bg-primary-600 text-white shadow-sm'
                : 'text-gray-600'
            }`}
          >
            👤 Profile
          </button>
        </div>
      </nav>
      <ChangePasswordModal
        isOpen={isPasswordModalOpen}
        onClose={() => setPasswordModalOpen(false)}
      />
    </div>
  );
};

export default EmployeeDashboard;
