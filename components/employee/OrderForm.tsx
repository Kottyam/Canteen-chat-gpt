import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import { OrderItems, Order, MenuItem } from '../../types';
import { formatDate } from '../../utils/helpers';
import { cancelOrder, loadSupabaseData, upsertOrder } from '../../services/supabaseSync';

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
    const order = user ? orders.find(o => o.employeeId === user.id && o.date === today) : undefined;
    setItems(order ? { ...order.items } : { ...EMPTY });
  }, [user, orders, today]);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user) return;
    if (holiday) {
      setMsg('Today is a holiday. Ordering is not available.');
      return;
    }

    setSaving(true);
    setMsg('');

    const order: Order = {
      id: `${user.id}-${today}`,
      employeeId: user.id,
      date: today,
      items,
    };

    try {
      await upsertOrder(order, prices);
      setOrders(prev => {
        const index = prev.findIndex(o => o.id === order.id);
        return index >= 0
          ? prev.map((o, i) => (i === index ? order : o))
          : [...prev, order];
      });
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
    const existing = orders.find(o => o.employeeId === user.id && o.date === today);
    if (!existing) { setMsg('There is no order for today.'); return; }
    if (!window.confirm('Cancel your complete order for today?')) return;

    setSaving(true);
    try {
      await cancelOrder(existing);
      setOrders(prev => prev.filter(o => o.id !== existing.id));
      setItems({ ...EMPTY });
      setMsg('Today’s order cancelled.');
    } catch (error: any) {
      console.error(error);
      setMsg(`Could not cancel order: ${error?.message || 'Please try again.'}`);
    } finally {
      setSaving(false);
    }
  };

  const change = (key: keyof OrderItems, checked: boolean) => {
    if (holiday) return;
    const next = { ...items, [key]: checked };
    if ((key === 'lunchEgg' || key === 'lunchFishMeat') && checked) next.lunchMeals = true;
    if (key === 'lunchMeals' && !checked) { next.lunchEgg = false; next.lunchFishMeat = false; }
    setItems(next);
  };

  const total = activeItems.reduce((sum, item) => {
    const key = item.itemCode as keyof OrderItems;
    return sum + (items[key] ? item.unitPrice : 0);
  }, 0);

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
            {weekend ? 'Saturday and Sunday are holidays.' : 'Admin has declared today a holiday.'} Orders are closed.
          </p>
        </div>
      )}

      <form onSubmit={save} className="space-y-3">
        {activeItems.map(item => {
          const key = item.itemCode as keyof OrderItems;
          const checked = Boolean(items[key]);
          return (
            <label key={item.itemCode} className={`flex min-h-14 items-center justify-between gap-3 rounded-xl border p-3 ${holiday ? 'opacity-60' : ''}`}>
              <span className="flex min-w-0 items-center gap-3">
                <input type="checkbox" disabled={holiday} checked={checked} onChange={e => change(key, e.target.checked)} className="h-5 w-5 shrink-0" />
                <span className="min-w-0 break-words text-sm font-medium text-gray-700 sm:text-base">{item.itemName}</span>
              </span>
              <span className="shrink-0 text-sm font-semibold">₹{item.unitPrice}</span>
            </label>
          );
        })}

        <div className="flex items-center justify-between border-t pt-3">
          <span className="font-semibold">Today’s Total</span>
          <span className="text-lg font-bold text-primary-700">₹{total.toFixed(2)}</span>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <button type="submit" disabled={saving || holiday} className="min-h-12 w-full rounded-lg bg-primary-600 px-4 font-semibold text-white disabled:opacity-50">
            {holiday ? 'Ordering Closed' : saving ? 'Saving…' : 'Save / Update Order'}
          </button>
          {!holiday && (
            <button type="button" disabled={saving} onClick={cancelToday} className="min-h-12 w-full rounded-lg bg-red-600 px-4 font-semibold text-white disabled:opacity-50">
              Cancel Today’s Order
            </button>
          )}
        </div>

        {msg && <p className="rounded-lg bg-gray-50 p-3 text-sm text-gray-700">{msg}</p>}
      </form>
    </div>
  );
};

export default OrderForm;
