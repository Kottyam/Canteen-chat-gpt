import React, { useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import { Order, OrderItems } from '../../types';
import { formatDate } from '../../utils/helpers';

const OrderCalendar: React.FC = () => {
  const { user } = useAuth();
  const { orders, prices, menuItems } = useData();
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const mine = useMemo(
    () =>
      user
        ? orders
            .filter(o => o.employeeId === user.id)
            .sort((a, b) => b.date.localeCompare(a.date))
        : [],
    [orders, user]
  );

  const last15 = mine.slice(0, 15);

  const names: Record<keyof OrderItems, string> = {
    morningTea: 'Morning Tea',
    lunchMeals: 'Meals',
    lunchEgg: 'Egg',
    lunchFishMeat: 'Fish/Meat',
    eveningTea: 'Evening Tea',
  };

  const priceFor = (key: keyof OrderItems) => {
    const menu = menuItems.find(m => m.itemCode === key);
    return menu?.unitPrice ?? prices[key];
  };

  const getTotal = (order: Order) =>
    (Object.keys(order.items) as (keyof OrderItems)[]).reduce(
      (sum, key) => sum + (order.items[key] ? priceFor(key) : 0),
      0
    );

  const selectedOrder = selectedDate
    ? mine.find(o => o.date === selectedDate) || null
    : null;

  return (
    <div className="w-full min-w-0 rounded-lg bg-white p-3 shadow-md sm:p-6">
      <div className="mb-4">
        <h3 className="text-xl font-bold text-gray-800">
          Last 15 Days – Order History
        </h3>
        <p className="mt-1 text-sm text-gray-500">
          Select a date to view your order and daily amount.
        </p>
      </div>

      {last15.length === 0 ? (
        <p className="rounded-md bg-gray-50 p-4 text-sm text-gray-500">
          No orders yet.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-2">
          {last15.map(order => (
            <button
              key={order.id}
              type="button"
              onClick={() => setSelectedDate(order.date)}
              className={`flex w-full min-w-0 items-center justify-between gap-3 rounded-lg border p-3 text-left transition ${
                selectedDate === order.date
                  ? 'border-primary-500 bg-primary-50'
                  : 'hover:bg-gray-50'
              }`}
            >
              <span className="min-w-0">
                <span className="block font-semibold text-gray-800">
                  {order.date}
                </span>
                <span className="block truncate text-sm text-gray-600">
                  {(Object.keys(order.items) as (keyof OrderItems)[])
                    .filter(key => order.items[key])
                    .map(key => names[key])
                    .join(', ') || 'No items'}
                </span>
              </span>

              <span className="shrink-0 font-semibold text-primary-700">
                ₹{getTotal(order).toFixed(2)}
              </span>
            </button>
          ))}
        </div>
      )}

      {selectedOrder && (
        <div className="mt-5 rounded-lg border bg-gray-50 p-4">
          <div className="flex items-center justify-between gap-3">
            <h4 className="font-bold text-gray-800">
              Order for {selectedOrder.date}
            </h4>
            <button
              type="button"
              onClick={() => setSelectedDate(null)}
              className="rounded px-2 py-1 text-gray-500 hover:bg-gray-200"
              aria-label="Close order details"
            >
              ✕
            </button>
          </div>

          <div className="mt-3 space-y-2">
            {(Object.keys(selectedOrder.items) as (keyof OrderItems)[])
              .filter(key => selectedOrder.items[key])
              .map(key => (
                <div
                  key={key}
                  className="flex justify-between gap-3 border-b pb-2 text-sm"
                >
                  <span>{names[key]}</span>
                  <span>₹{priceFor(key).toFixed(2)}</span>
                </div>
              ))}
          </div>

          <div className="mt-3 flex justify-between border-t pt-3 font-bold">
            <span>Daily Total</span>
            <span>₹{getTotal(selectedOrder).toFixed(2)}</span>
          </div>
        </div>
      )}

      <p className="mt-5 text-xs text-gray-400">
        Today is {formatDate(new Date())}. Previous dates are view-only.
      </p>
    </div>
  );
};

export default OrderCalendar;
