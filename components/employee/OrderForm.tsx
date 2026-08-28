import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import { OrderItems, Order, MenuItem } from '../../types';
import { formatDate } from '../../utils/helpers';
import { cancelOrder, upsertOrder } from '../../services/supabaseSync';

const EMPTY: OrderItems = {
  morningTea: false,
  lunchMeals: false,
  lunchEgg: false,
  lunchFishMeat: false,
  eveningTea: false,
};

const OrderForm: React.FC = () => {
  const { user } = useAuth();
  const { orders, setOrders, prices, menuItems, holidays } = useData();
  const today = formatDate(new Date());
  const day = new Date();
  const weekend = day.getDay() === 0 || day.getDay() === 6;
  const holiday = weekend || holidays.includes(today);
  const existing = user
    ? orders.find(o => o.employeeId === user.id && o.date === today)
    : undefined;

  const [items, setItems] = useState<OrderItems>({ ...EMPTY });
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);

  const activeItems = useMemo<MenuItem[]>(() => {
    const fallback: MenuItem[] = [
      { itemCode: 'morningTea', itemName: 'Morning Tea', unitPrice: prices.morningTea, active: true },
      { itemCode: 'lunchMeals', itemName: 'Lunch: Meals', unitPrice: prices.lunchMeals, active: true },
      { itemCode: 'lunchEgg', itemName: 'Lunch: Egg (add-on)', unitPrice: prices.lunchEgg, active: true },
      { itemCode: 'lunchFishMeat', itemName: 'Lunch: Fish/Meat (add-on)', unitPrice: prices.lunchFishMeat, active: true },
      { itemCode: 'eveningTea', itemName: 'Evening Tea', unitPrice: prices.eveningTea, active: true },
    ];
    return (menuItems.length ? menuItems : fallback).filter(i => i.active);
  }, [menuItems, prices]);

  useEffect(() => {
    const order = user
      ? orders.find(o => o.employeeId === user.id && o.date === today)
      : undefined;
    setItems(order ? { ...order.items } : { ...EMPTY });
  }, [user, orders, today]);

  // Use a functional state update so one tap can only change the requested item.
  const change = (key: keyof OrderItems, checked: boolean) => {
    if (holiday || existing) return;

    setItems(prev => {
      const next = { ...prev, [key]: checked };

      // Add-ons require Meals, but selecting/deselecting an add-on must not
      // change either of the other add-ons.
      if ((key === 'lunchEgg' || key === 'lunchFishMeat') && checked) {
        next.lunchMeals = true;
      }

      // Meals cannot be removed while an add-on remains selected.
      if (key === 'lunchMeals' && !checked) {
        next.lunchEgg = false;
        next.lunchFishMeat = false;
      }

      return next;
    });
  };

  const getPrice = (order: Order | undefined, key: keyof OrderItems) =>
    order?.itemPrices?.[key] ??
    menuItems.find(i => i.itemCode === key)?.unitPrice ??
    prices[key];

  const total = (order: Order | undefined) =>
    order
      ? (Object.keys(order.items) as (keyof OrderItems)[]).reduce(
          (sum, key) => sum + (order.items[key] ? getPrice(order, key) : 0),
          0
        )
      : activeItems.reduce(
          (sum, item) =>
            sum + (items[item.itemCode as keyof OrderItems] ? item.unitPrice : 0),
          0
        );

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user) return;
    if (holiday) {
      setMsg('Today is a holiday. Ordering is not available.');
      return;
    }
    if (existing) {
      setMsg('An order already exists for today. Cancel it first before placing a new order.');
      return;
    }

    setSaving(true);
    setMsg('');
    try {
      const order: Order = {
        id: crypto.randomUUID(),
        employeeId: user.id,
        date: today,
        items,
        itemPrices: Object.fromEntries(
          (Object.keys(items) as (keyof OrderItems)[])
            .filter(k => items[k])
            .map(k => [k, prices[k]])
        ),
      };
      await upsertOrder(order, prices);
      setOrders(prev => [...prev, order]);
      setMsg('Today’s order saved successfully.');
    } catch (error: any) {
      console.error(error);
      setMsg(`Could not save order: ${error?.message || 'Please try again.'}`);
    } finally {
      setSaving(false);
    }
  };

  const cancelToday = async () => {
    if (!user || holiday) return;
    if (!existing) {
      setMsg('There is no order for today.');
      return;
    }
    if (!window.confirm('Cancel your complete order for today?')) return;

    setSaving(true);
    setMsg('');
    try {
      await cancelOrder(existing);
      setOrders(prev => prev.filter(o => o.id !== existing.id));
      setItems({ ...EMPTY });
      setMsg('Today’s order cancelled. You can now place a new order.');
    } catch (error: any) {
      console.error(error);
      setMsg(`Could not cancel order: ${error?.message || 'Please try again.'}`);
    } finally {
      setSaving(false);
    }
  };

  if (existing) {
    return (
      <div className="w-full min-w-0 rounded-xl bg-white p-3 shadow-sm sm:p-6">
        <div className="mb-4">
          <h3 className="text-xl font-bold text-gray-800">Today’s Order</h3>
          <p className="text-sm text-gray-500">{today}</p>
        </div>

        {holiday && (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
            <div className="text-lg font-bold text-amber-800">🎉 Holiday</div>
            <p className="mt-1 text-sm text-amber-700">Orders are closed.</p>
          </div>
        )}

        {!holiday && (
          <div className="mb-4 rounded-xl border border-primary-200 bg-primary-50 p-4">
            <div className="font-bold text-primary-800">Order already placed for today</div>
            <p className="mt-1 text-sm text-primary-700">
              Cancel the existing order before placing a fresh order.
            </p>
          </div>
        )}

        <div className="space-y-2">
          {(Object.keys(existing.items) as (keyof OrderItems)[])
            .filter(k => existing.items[k])
            .map(k => (
              <div key={k} className="flex justify-between rounded-lg border p-3">
                <span>
                  {({
                    morningTea: 'Morning Tea',
                    lunchMeals: 'Meals',
                    lunchEgg: 'Egg',
                    lunchFishMeat: 'Fish/Meat',
                    eveningTea: 'Evening Tea',
                  } as any)[k]}
                </span>
                <span>₹{getPrice(existing, k).toFixed(2)}</span>
              </div>
            ))}
        </div>

        <div className="mt-3 flex justify-between border-t pt-3 font-bold">
          <span>Today’s Total</span>
          <span className="text-primary-700">₹{total(existing).toFixed(2)}</span>
        </div>

        {!holiday && (
          <button
            type="button"
            disabled={saving}
            onClick={cancelToday}
            className="mt-4 min-h-12 w-full rounded-lg bg-red-600 px-4 font-semibold text-white disabled:opacity-50"
          >
            {saving ? 'Cancelling…' : 'Cancel Today’s Order'}
          </button>
        )}

        {msg && <p className="mt-3 rounded-lg bg-gray-50 p-3 text-sm text-gray-700">{msg}</p>}
      </div>
    );
  }

  return (
    <div className="w-full min-w-0 rounded-xl bg-white p-3 shadow-sm sm:p-6">
      <div className="mb-4">
        <h3 className="text-xl font-bold text-gray-800">Today’s Order</h3>
        <p className="text-sm text-gray-500">{today}</p>
      </div>

      {holiday && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div className="text-lg font-bold text-amber-800">🎉 Holiday</div>
          <p className="mt-1 text-sm text-amber-700">
            {weekend ? 'Saturday and Sunday are holidays.' : 'Admin has declared today a holiday.'}{' '}
            Orders are closed.
          </p>
        </div>
      )}

      <form onSubmit={save} className="space-y-3">
        {activeItems.map(item => {
          const key = item.itemCode as keyof OrderItems;
          const inputId = `order-item-${item.itemCode}`;

          return (
            <div
              key={item.itemCode}
              className={`flex min-h-14 items-center justify-between gap-3 rounded-xl border p-3 ${
                holiday ? 'opacity-60' : ''
              }`}
            >
              <div className="flex min-w-0 items-center gap-3">
                <input
                  id={inputId}
                  type="checkbox"
                  disabled={holiday}
                  checked={Boolean(items[key])}
                  onChange={e => change(key, e.currentTarget.checked)}
                  className="h-5 w-5 shrink-0 touch-manipulation"
                />
                <label
                  htmlFor={inputId}
                  className="min-w-0 cursor-pointer break-words text-sm font-medium text-gray-700 sm:text-base"
                >
                  {item.itemName}
                </label>
              </div>
              <span className="shrink-0 text-sm font-semibold">₹{item.unitPrice}</span>
            </div>
          );
        })}

        <div className="flex items-center justify-between border-t pt-3">
          <span className="font-semibold">Today’s Total</span>
          <span className="text-lg font-bold text-primary-700">₹{total(undefined).toFixed(2)}</span>
        </div>

        <button
          type="submit"
          disabled={saving || holiday}
          className="min-h-12 w-full rounded-lg bg-primary-600 px-4 font-semibold text-white disabled:opacity-50"
        >
          {holiday ? 'Ordering Closed' : saving ? 'Saving…' : 'Place Today’s Order'}
        </button>

        {msg && <p className="rounded-lg bg-gray-50 p-3 text-sm text-gray-700">{msg}</p>}
      </form>
    </div>
  );
};

export default OrderForm;
