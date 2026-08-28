import React, { useMemo, useState } from 'react';
import { useData } from '../../context/DataContext';
import { downloadMonthlyPdf, orderTotal } from '../../utils/pdf';
import { getMonthName } from '../../utils/helpers';

const MonthlyReport: React.FC = () => {
  const { users, orders, prices, menuItems } = useData();
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth());
  const [year, setYear] = useState(now.getFullYear());

  const employees = users.filter(u => u.role === 'employee');

  const priceFor = (key: keyof typeof prices) =>
    menuItems.find(item => item.itemCode === key)?.unitPrice ?? prices[key];

  const totalForOrder = (order: (typeof orders)[number]) => {
    const keys = Object.keys(order.items) as (keyof typeof prices)[];
    return keys.reduce(
      (sum, key) => sum + (order.items[key] ? priceFor(key) : 0),
      0
    );
  };

  const data = useMemo(
    () =>
      employees.map(user => {
        const mine = orders.filter(order => {
          if (order.employeeId !== user.id) return false;

          const date = new Date(`${order.date}T00:00:00`);
          return (
            date.getMonth() === month &&
            date.getFullYear() === year
          );
        });

        return {
          user,
          count: mine.length,
          total: mine.reduce((sum, order) => sum + totalForOrder(order), 0),
        };
      }),
    [employees, orders, month, year, menuItems, prices]
  );

  const grandTotal = data.reduce((sum, row) => sum + row.total, 0);

  const generatePdf = () => {
    downloadMonthlyPdf(month, year, users, orders, prices);
  };

  return (
    <div className="w-full min-w-0">
      <div className="mb-5">
        <h3 className="text-xl font-bold text-gray-800 sm:text-2xl">
          Monthly Employee Report
        </h3>
        <p className="mt-1 text-sm text-gray-500">
          Employee-wise food amount for the selected month.
        </p>
      </div>

      <div className="mb-5 flex flex-col gap-2 rounded-lg bg-gray-50 p-3 sm:flex-row sm:flex-wrap sm:items-center sm:p-4">
        <select
          value={month}
          onChange={e => setMonth(Number(e.target.value))}
          className="w-full rounded-md border px-3 py-2.5 sm:w-auto"
        >
          {Array.from({ length: 12 }, (_, index) => (
            <option key={index} value={index}>
              {getMonthName(index)}
            </option>
          ))}
        </select>

        <select
          value={year}
          onChange={e => setYear(Number(e.target.value))}
          className="w-full rounded-md border px-3 py-2.5 sm:w-auto"
        >
          {Array.from({ length: 5 }, (_, index) => {
            const y = now.getFullYear() - index;
            return (
              <option key={y} value={y}>
                {y}
              </option>
            );
          })}
        </select>

        <button
          type="button"
          onClick={generatePdf}
          className="w-full rounded-md bg-primary-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-primary-700 sm:w-auto"
        >
          Generate Monthly PDF
        </button>
      </div>

      <div className="mb-4 rounded-lg border bg-white p-4">
        <div className="text-sm text-gray-500">
          Selected: {getMonthName(month)} {year}
        </div>
        <div className="mt-1 text-xl font-bold text-primary-700">
          Monthly Total: ₹{grandTotal.toFixed(2)}
        </div>
      </div>

      <div className="space-y-3 md:hidden">
        {data.map(row => (
          <div key={row.user.id} className="rounded-lg border bg-white p-4">
            <div className="font-semibold text-gray-800">{row.user.name}</div>
            <div className="text-sm text-gray-500">
              SR: {row.user.id}
            </div>
            <div className="text-sm text-gray-500">
              Mobile: {row.user.mobile || '—'}
            </div>
            <div className="mt-2 flex justify-between border-t pt-2 text-sm">
              <span>Orders: {row.count}</span>
              <span className="font-semibold">
                ₹{row.total.toFixed(2)}
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="hidden overflow-x-auto rounded-lg border md:block">
        <table className="min-w-full bg-white">
          <thead className="bg-gray-50">
            <tr>
              <th className="whitespace-nowrap p-3 text-left text-sm">Name</th>
              <th className="whitespace-nowrap p-3 text-left text-sm">SR Number</th>
              <th className="whitespace-nowrap p-3 text-left text-sm">Mobile</th>
              <th className="whitespace-nowrap p-3 text-center text-sm">Orders</th>
              <th className="whitespace-nowrap p-3 text-right text-sm">Food Amount</th>
            </tr>
          </thead>

          <tbody>
            {data.map(row => (
              <tr key={row.user.id} className="border-t">
                <td className="p-3">{row.user.name}</td>
                <td className="p-3">{row.user.id}</td>
                <td className="p-3">{row.user.mobile || '—'}</td>
                <td className="p-3 text-center">{row.count}</td>
                <td className="p-3 text-right">
                  ₹{row.total.toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>

          <tfoot>
            <tr className="border-t font-bold">
              <td className="p-3" colSpan={4}>
                Monthly Total
              </td>
              <td className="p-3 text-right">
                ₹{grandTotal.toFixed(2)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
};

export default MonthlyReport;
