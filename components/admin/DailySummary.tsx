import React, { useEffect, useMemo, useState } from 'react';
import { useData } from '../../context/DataContext';
import { downloadDailyPdf, orderTotal, guestOrderTotal, orderText } from '../../utils/pdf';
import { formatDate } from '../../utils/helpers';
import { EmployeeAdjustmentForReport, loadEmployeeAdjustmentsForUsers } from '../../services/employeeAdjustments';

interface ItemSummary { name: string; totalQty: number; employeeQty: number; guestQty: number; }

const DailySummary: React.FC = () => {
  const { orders, users, prices } = useData();
  const [selectedDate, setSelectedDate] = useState(formatDate(new Date()));
  const [adjustments, setAdjustments] = useState<EmployeeAdjustmentForReport[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    if (!selectedDate) {
      setAdjustments([]);
      setLoading(false);
      return () => { alive = false; };
    }
    const load = async () => {
      setLoading(true);
      try {
        const rows = await loadEmployeeAdjustmentsForUsers(
          users.filter(u => u.role === 'employee').map(u => u.id),
          selectedDate,
          selectedDate
        );
        if (alive) setAdjustments(rows);
      } catch {
        if (alive) setAdjustments([]);
      } finally {
        if (alive) setLoading(false);
      }
    };
    void load();
    const timer = window.setInterval(load, 10000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [users, selectedDate]);

  const day = useMemo(() => selectedDate ? orders.filter(o => o.date === selectedDate && o.status !== 'cancelled') : [], [orders, selectedDate]);
  const extras = useMemo(() => selectedDate ? adjustments.filter(a => a.adjustment_date === selectedDate) : [], [adjustments, selectedDate]);
  const extraByEmployee = useMemo(() => {
    const result: Record<string, number> = {};
    extras.forEach(a => { result[a.employeeCode] = (result[a.employeeCode] || 0) + Number(a.amount || 0); });
    return result;
  }, [extras]);

  const itemSummary = useMemo<ItemSummary[]>(() => {
    const result = new Map<string, ItemSummary>();
    const add = (code: string, name: string, quantity: number, source: 'employee' | 'guest') => {
      const qty = Number(quantity || 0);
      if (qty <= 0) return;
      const key = code || name;
      const item = result.get(key) || { name: name || code, totalQty: 0, employeeQty: 0, guestQty: 0 };
      item.name = name || item.name || code;
      item.totalQty += qty;
      if (source === 'guest') item.guestQty += qty;
      else item.employeeQty += qty;
      result.set(key, item);
    };
    day.forEach(order => {
      Object.keys(order.items || {}).filter(code => order.items[code]).forEach(code => {
        add(code, order.itemNames?.[code] || code, Math.max(1, Number(order.itemQuantities?.[code] || 1)), 'employee');
      });
      Object.keys(order.guestItems || {}).filter(code => order.guestItems?.[code]).forEach(code => {
        add(code, order.guestItemNames?.[code] || order.itemNames?.[code] || code, Math.max(1, Number(order.guestItemQuantities?.[code] || 1)), 'guest');
      });
    });
    return [...result.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [day]);

  const total = day.reduce((sum, o) => sum + orderTotal(o, prices) + guestOrderTotal(o, prices), 0) + extras.reduce((sum, a) => sum + Number(a.amount || 0), 0);
  const employeeCodes = [...new Set([...day.map(o => o.employeeId), ...extras.map(a => a.employeeCode)])];

  return (
    <div className="w-full min-w-0">
      <div className="mb-5"><h3 className="text-xl font-bold text-gray-800 sm:text-2xl">Daily Report</h3><p className="mt-1 text-sm text-gray-500">Select a date and generate the daily PDF report.</p></div>
      <div className="mb-5 flex flex-col gap-2 rounded-lg bg-gray-50 p-3 sm:flex-row sm:items-center sm:p-4">
        <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value || '')} className="w-full rounded-md border px-3 py-2.5 sm:w-auto" />
        <button type="button" disabled={loading || !selectedDate} onClick={() => { if (selectedDate) void downloadDailyPdf(selectedDate, users, orders, prices, adjustments); }} className="w-full rounded-md bg-primary-600 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50 sm:w-auto">{loading ? 'Loading…' : 'Generate Daily PDF'}</button>
      </div>
      {!selectedDate ? (
        <div className="mb-5 rounded-lg border bg-gray-50 p-5 text-center text-sm text-gray-500">Select a date to view the Daily Report</div>
      ) : (
        <>
          <div className="mb-5 rounded-lg border bg-white p-4">
            <div className="mb-3 font-semibold text-gray-800">Food Items</div>
            {itemSummary.length === 0 ? <div className="text-sm text-gray-500">No food items ordered for this date.</div> : <div className="overflow-x-auto"><table className="min-w-full"><thead><tr className="border-b text-left text-xs text-gray-500"><th className="p-2">Food Item</th><th className="p-2 text-right">Total Qty</th><th className="p-2 text-right">Member Qty</th><th className="p-2 text-right">Guest Qty</th></tr></thead><tbody>{itemSummary.map(item => <tr key={item.name} className="border-b last:border-0"><td className="p-2 font-medium">{item.name}</td><td className="p-2 text-right font-semibold">{item.totalQty}</td><td className="p-2 text-right">{item.employeeQty}</td><td className="p-2 text-right">{item.guestQty}</td></tr>)}</tbody></table></div>}
          </div>
          <div className="mb-4 rounded-lg border bg-white p-4"><div className="flex flex-col gap-1 sm:flex-row sm:justify-between"><span className="font-semibold">Members / Entries: {employeeCodes.length}</span><span className="font-bold text-primary-700">Total Collection: ₹{total.toFixed(2)}</span></div></div>
          <div className="space-y-3 md:hidden">{employeeCodes.length === 0 ? <div className="rounded-lg border p-4 text-sm text-gray-500">No orders or admin additions for this date.</div> : employeeCodes.map(code => {
            const employeeOrders = day.filter(o => o.employeeId === code);
            const employeeFood = employeeOrders.reduce((s, o) => s + orderTotal(o, prices), 0);
            const guestFood = employeeOrders.reduce((s, o) => s + guestOrderTotal(o, prices), 0);
            const extra = extraByEmployee[code] || 0;
            const itemText = employeeOrders.flatMap(o => [orderText(o), ...Object.keys(o.guestItems || {}).filter(c => o.guestItems?.[c]).map(c => `${o.guestItemNames?.[c] || o.itemNames?.[c] || c} × ${Math.max(1, Number(o.guestItemQuantities?.[c] || 1))}`)]).filter(Boolean).join(' · ');
            return <div key={code} className="rounded-lg border bg-white p-4"><div className="font-semibold text-gray-800">{users.find(u => u.id === code)?.name || code}</div><div className="text-sm text-gray-500">SR: {code}</div><div className="mt-2 text-sm">Member Food: ₹{employeeFood.toFixed(2)}</div><div className="mt-1 text-sm">Guest Food: ₹{guestFood.toFixed(2)}</div><div className="mt-2 text-xs text-gray-500">{itemText || 'No items'}</div>{extra !== 0 && <div className="mt-2 text-sm font-medium text-primary-700">Admin Added: ₹{extra.toFixed(2)}</div>}<div className="mt-2 border-t pt-2 font-semibold">Member Total: ₹{(employeeFood + guestFood + extra).toFixed(2)}</div></div>;
          })}</div>
          <div className="hidden overflow-x-auto rounded-lg border md:block"><table className="min-w-full bg-white"><thead className="bg-gray-50"><tr><th className="p-3 text-left text-sm">Name</th><th className="p-3 text-left text-sm">SR Number</th><th className="p-3 text-right text-sm">Member Food</th><th className="p-3 text-right text-sm">Guest Food</th><th className="p-3 text-right text-sm">Admin Added</th><th className="p-3 text-right text-sm">Total</th></tr></thead><tbody>{employeeCodes.map(code => { const employeeOrders = day.filter(o => o.employeeId === code); const employeeFood = employeeOrders.reduce((s, o) => s + orderTotal(o, prices), 0); const guestFood = employeeOrders.reduce((s, o) => s + guestOrderTotal(o, prices), 0); const extra = extraByEmployee[code] || 0; return <tr key={code} className="border-t"><td className="p-3">{users.find(u => u.id === code)?.name || code}</td><td className="p-3">{code}</td><td className="p-3 text-right">₹{employeeFood.toFixed(2)}</td><td className="p-3 text-right">₹{guestFood.toFixed(2)}</td><td className="p-3 text-right">₹{extra.toFixed(2)}</td><td className="p-3 text-right font-semibold">₹{(employeeFood + guestFood + extra).toFixed(2)}</td></tr>; })}</tbody></table></div>
        </>
      )}
    </div>
  );
};

export default DailySummary;
