import React, { useEffect, useMemo, useState } from 'react';
import { useData } from '../../context/DataContext';
import { useAuth } from '../../context/AuthContext';
import { OrderItems, Order, MenuItem } from '../../types';
import { formatDate } from '../../utils/helpers';
import { cancelOrder } from '../../services/supabaseSync';

const EMPTY: OrderItems = {
  morningTea: false,
  lunchMeals: false,
  lunchEgg: false,
  lunchFishMeat: false,
  eveningTea: false,
};

const OrderForm: React.FC = () => {
  const { user } = useAuth();
  const { orders, setOrders, prices, menuItems } = useData();
  const today = formatDate(new Date());

  const [items, setItems] = useState<OrderItems>(EMPTY);
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);

  const activeItems = useMemo(() => {
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

  const change = (name: keyof OrderItems, checked: boolean) => {
    const next = { ...items, [name]: checked };

    if (name === 'lunchEgg' && checked) next.lunchMeals = true;
    if (name === 'lunchFishMeat' && checked) next.lunchMeals = true;

    if (name === 'lunchMeals' && !checked) {
      next.lunchEgg = false;
      next.lunchFishMeat = false;
    }

    setItems(next);
  };

  const total = activeItems.reduce((sum, item) => {
    const key = item.itemCode as keyof OrderItems;
    return sum + (items[key] ? item.unitPrice : 0);
  }, 0);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    setSaving(true);
    setMsg('');

    const id = `${user.id}-${today}`;
    const order: Order = {
      id,
      employeeId: user.id,
      date: today,
      items,
    };

    const existing = orders.findIndex(o => o.id === id);

    setOrders(prev =>
      existing >= 0
        ? prev.map((o, index) => (index === existing ? order : o))
        : [...prev, order]
    );

    setMsg('Today’s order saved/updated.');
    setSaving(false);
  };

  const removeItem = (key: keyof OrderItems) => {
    change(key, false);
  };

  const cancelToday = async () => {
    if (!user) return;

    const existing = orders.find(
      o => o.employeeId === user.id && o.date === today
    );

    if (!existing) {
      setItems({ ...EMPTY });
      setMsg('There is no order for today.');
      return;
    }

    if (!window.confirm('Cancel your complete order for today?')) return;

    setSaving(true);
    setMsg('');

    try {
      await cancelOrder(existing);
    } catch (error) {
      console.error(error);
      // Keep the local action usable even if cloud cancellation is unavailable.
    }

    setOrders(prev => prev.filter(o => o.id !== existing.id));
    setItems({ ...EMPTY });
    setMsg('Today’s order cancelled.');
    setSaving(false);
  };

  return (
    <div className="w-full min-w-0 rounded-lg bg-white p-3 shadow-md sm:p-6">
      <div className="mb-4">
        <h3 className="text-xl font-bold text-gray-800">Today’s Order</h3>
        <p className="text-sm text-gray-500">
          You can add, change or cancel an order only for today ({today}).
        </p>
      </div>

      <form onSubmit={save} className="space-y-3">
        {activeItems.map(item => {
          const key = item.itemCode as keyof OrderItems;
          const checked = Boolean(items[key]);

          return (
            <div
              key={item.itemCode}
              className="flex items-center justify-between gap-3 rounded-lg border p-3"
            >
              <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={e => change(key, e.target.checked)}
                  className="h-5 w-5 shrink-0"
                />
                <span className="min-w-0 truncate text-sm font-medium text-gray-700 sm:text-base">
                  {item.itemName}
                </span>
              </label>

              <div className="flex shrink-0 items-center gap-2">
                <span className="text-sm font-medium">₹{item.unitPrice}</span>
                {checked && (
                  <button
                    type="button"
                    onClick={() => removeItem(key)}
                    className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-700"
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
          );
        })}

        <div className="flex items-center justify-between border-t pt-3">
          <span className="font-semibold text-gray-800">Today’s Total</span>
          <span className="text-lg font-bold text-primary-700">₹{total}</span>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="submit"
            disabled={saving}
            className="w-full rounded-md bg-primary-600 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50 sm:w-auto"
          >
            {saving ? 'Saving…' : 'Save / Update Order'}
          </button>

          <button
            type="button"
            disabled={saving}
            onClick={cancelToday}
            className="w-full rounded-md bg-red-600 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50 sm:w-auto"
          >
            Cancel Today’s Order
          </button>
        </div>

        {msg && (
          <p className="rounded-md bg-green-100 p-3 text-sm text-green-700">
            {msg}
          </p>
        )}
      </form>
    </div>
  );
};

export default OrderForm;
