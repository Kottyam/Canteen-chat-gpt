import React, { useMemo, useState } from 'react';
import { useData } from '../../context/DataContext';
import {
  downloadDailyPdf,
  orderTotal,
  orderText,
} from '../../utils/pdf';
import { formatDate } from '../../utils/helpers';

const DailySummary: React.FC = () => {
  const { orders, users, prices, menuItems } = useData();
  const [selectedDate, setSelectedDate] = useState(formatDate(new Date()));

  const day = useMemo(
    () =>
      orders.filter(
        order =>
          order.date === selectedDate
      ),
    [orders, selectedDate]
  );

  const priceFor = (key: keyof typeof prices) =>
    menuItems.find(item => item.itemCode === key)?.unitPrice ??
    prices[key];

  const counts = useMemo(() => {
    const result = {
      morningTea: 0,
      lunchMeals: 0,
      lunchEgg: 0,
      lunchFishMeat: 0,
      eveningTea: 0,
    };

    day.forEach(order => {
      (Object.keys(result) as (keyof typeof result)[]).forEach(key => {
        if (order.items[key]) result[key] += 1;
      });
    });

    return result;
  }, [day]);

  const total = day.reduce((sum, order) => {
    const itemKeys = Object.keys(order.items) as (keyof typeof prices)[];
    return (
      sum +
      itemKeys.reduce(
        (s, key) => s + (order.items[key] ? priceFor(key) : 0),
        0
      )
    );
  }, 0);

  const generatePdf = () => {
    downloadDailyPdf(selectedDate, users, orders, prices);
  };

  return (
    <div className="w-full min-w-0">
      <div className="mb-5">
        <h3 className="text-xl font-bold text-gray-800 sm:text-2xl">
          Daily Report
        </h3>
        <p className="mt-1 text-sm text-gray-500">
          Select a date and generate the daily PDF report.
        </p>
      </div>

      <div className="mb-5 flex flex-col gap-2 rounded-lg bg-gray-50 p-3 sm:flex-row sm:items-center sm:p-4">
        <input
          type="date"
          value={selectedDate}
          onChange={e => setSelectedDate(e.target.value)}
          className="w-full rounded-md border px-3 py-2.5 sm:w-auto"
        />

        <button
          type="button"
          onClick={generatePdf}
          className="w-full rounded-md bg-primary-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-primary-700 sm:w-auto"
        >
          Generate Daily PDF
        </button>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {[
          ['Morning Tea', counts.morningTea],
          ['Meals', counts.lunchMeals],
          ['Egg', counts.lunchEgg],
          ['Fish/Meat', counts.lunchFishMeat],
          ['Evening Tea', counts.eveningTea],
        ].map(([name, count]) => (
          <div key={String(name)} className="rounded-lg border bg-white p-3">
            <div className="text-xs text-gray-500">{name}</div>
            <div className="mt-1 text-2xl font-bold text-gray-800">
              {count}
            </div>
          </div>
        ))}
      </div>

      <div className="mb-4 rounded-lg border bg-white p-4">
        <div className="flex flex-col gap-1 sm:flex-row sm:justify-between">
          <span className="font-semibold">Employees / Orders: {day.length}</span>
          <span className="font-bold text-primary-700">
            Total: ₹{total.toFixed(2)}
          </span>
        </div>
      </div>

      <div className="space-y-3 md:hidden">
        {day.length === 0 ? (
          <div className="rounded-lg border p-4 text-sm text-gray-500">
            No orders for this date.
          </div>
        ) : (
          day.map(order => {
            const user = users.find(u => u.id === order.employeeId);

            return (
              <div key={order.id} className="rounded-lg border bg-white p-4">
                <div className="font-semibold text-gray-800">
                  {user?.name || order.employeeId}
                </div>
                <div className="text-sm text-gray-500">
                  SR: {order.employeeId}
                </div>
                <div className="mt-2 text-sm">
                  {orderText(order)}
                </div>
                <div className="mt-2 font-semibold">
                  ₹{orderTotal(order, prices).toFixed(2)}
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="hidden overflow-x-auto rounded-lg border md:block">
        <table className="min-w-full bg-white">
          <thead className="bg-gray-50">
            <tr>
              <th className="whitespace-nowrap p-3 text-left text-sm">Name</th>
              <th className="whitespace-nowrap p-3 text-left text-sm">SR Number</th>
              <th className="p-3 text-left text-sm">Items</th>
              <th className="whitespace-nowrap p-3 text-right text-sm">Amount</th>
            </tr>
          </thead>
          <tbody>
            {day.map(order => {
              const user = users.find(u => u.id === order.employeeId);

              return (
                <tr key={order.id} className="border-t">
                  <td className="p-3">{user?.name || order.employeeId}</td>
                  <td className="p-3">{order.employeeId}</td>
                  <td className="p-3">{orderText(order)}</td>
                  <td className="p-3 text-right">
                    ₹{orderTotal(order, prices).toFixed(2)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default DailySummary;
