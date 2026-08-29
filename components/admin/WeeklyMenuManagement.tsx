import React, { useMemo, useState } from 'react';
import { DailyMenuItem, MenuItem, OrderItems } from '../../types';
import { upsertDailyMenu } from '../../services/supabaseSync';
import { useData } from '../../context/DataContext';
import { formatDate } from '../../utils/helpers';

const CODES: (keyof OrderItems)[] = ['morningTea', 'lunchMeals', 'lunchEgg', 'lunchFishMeat', 'eveningTea'];
const DEFAULTS: Record<keyof OrderItems, { name: string; price: number }> = {
  morningTea: { name: 'Morning Tea', price: 8 },
  lunchMeals: { name: 'Lunch: Meals', price: 40 },
  lunchEgg: { name: 'Lunch: Egg (add-on)', price: 10 },
  lunchFishMeat: { name: 'Lunch: Fish/Meat (add-on)', price: 25 },
  eveningTea: { name: 'Evening Tea', price: 8 },
};

type DayDraft = Record<string, MenuItem[]>;
const addDays = (date: Date, days: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);

const WeeklyMenuManagement: React.FC = () => {
  const { menuItems, dailyMenus, setDailyMenus } = useData();
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const dates = useMemo(() => Array.from({ length: 7 }, (_, i) => formatDate(addDays(new Date(), i))), []);

  const initialDraft = useMemo<DayDraft>(() => {
    const result: DayDraft = {};
    dates.forEach(date => {
      const scheduled = dailyMenus.filter(item => item.menuDate === date);
      result[date] = CODES.map(code => {
        const existing = scheduled.find(item => item.itemCode === code);
        const master = menuItems.find(item => item.itemCode === code && !item.archived);
        const base = master || { itemCode: code, itemName: DEFAULTS[code].name, unitPrice: DEFAULTS[code].price, active: true };
        return existing
          ? { itemCode: existing.itemCode, itemName: existing.itemName, unitPrice: existing.unitPrice, active: existing.active }
          : { itemCode: base.itemCode, itemName: base.itemName, unitPrice: base.unitPrice, active: base.active };
      });
    });
    return result;
  }, [dates, dailyMenus, menuItems]);

  const [draft, setDraft] = useState<DayDraft>(initialDraft);
  React.useEffect(() => setDraft(initialDraft), [initialDraft]);

  const patch = (date: string, code: string, next: Partial<MenuItem>) => {
    setDraft(prev => ({ ...prev, [date]: (prev[date] || []).map(item => item.itemCode === code ? { ...item, ...next } : item) }));
  };

  const copyDayToAll = (sourceDate: string) => {
    const source = draft[sourceDate] || [];
    setDraft(prev => {
      const next = { ...prev };
      dates.forEach(date => { if (date !== sourceDate) next[date] = source.map(item => ({ ...item })); });
      return next;
    });
    setMessage('That day’s menu has been copied to the other six days. Review and save the week.');
  };

  const saveWeek = async () => {
    setSaving(true); setMessage('');
    try {
      for (const date of dates) {
        const rows = (draft[date] || []).map(item => ({ ...item, itemName: item.itemName.trim(), unitPrice: Number(item.unitPrice) }));
        if (rows.some(item => !item.itemName || !Number.isFinite(item.unitPrice) || item.unitPrice < 0)) throw new Error(`Please enter a valid name and price for ${date}.`);
        await upsertDailyMenu(date, rows);
      }
      const saved: DailyMenuItem[] = dates.flatMap(date => (draft[date] || []).map(item => ({ ...item, menuDate: date })));
      setDailyMenus(prev => [...prev.filter(item => !dates.includes(item.menuDate)), ...saved]);
      setMessage('7-day menu saved successfully. Employees will see each day’s menu and price when that date arrives.');
    } catch (error: any) {
      console.error(error); setMessage(`Could not save weekly menu: ${error?.message || 'Please try again.'}`);
    } finally { setSaving(false); }
  };

  return (
    <div className="w-full min-w-0">
      <h3 className="text-2xl font-bold text-gray-800">Weekly Menu</h3>
      <p className="mb-4 mt-1 text-sm text-gray-500">Set a different menu and price for each of the next 7 days. The schedule automatically rolls forward every day.</p>
      {message && <div className="mb-4 rounded-lg bg-green-50 p-3 text-sm text-green-700">{message}</div>}
      <div className="mb-4 rounded-xl border border-blue-100 bg-blue-50 p-3 text-sm text-blue-800">Only the current 7-day window can be published. Employees see the menu scheduled for the current date.</div>
      <div className="space-y-4">
        {dates.map((date, index) => {
          const day = new Date(`${date}T00:00:00`);
          const dayLabel = day.toLocaleDateString(undefined, { weekday: 'long', day: '2-digit', month: 'short' });
          return (
            <div key={date} className="rounded-xl border bg-white p-3 shadow-sm sm:p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div><h4 className="text-lg font-bold text-gray-800">{index === 0 ? 'Today' : dayLabel}</h4><p className="text-xs text-gray-500">{date}</p></div>
                <button type="button" onClick={() => copyDayToAll(date)} className="rounded-lg border px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50">Copy this day to all</button>
              </div>
              <div className="space-y-3">
                {(draft[date] || []).map(item => (
                  <div key={item.itemCode} className="grid gap-2 rounded-lg bg-gray-50 p-2 sm:grid-cols-[1fr_130px_auto] sm:items-center">
                    <div className="flex items-center gap-2">
                      <input type="checkbox" checked={item.active} onChange={e => patch(date, item.itemCode, { active: e.currentTarget.checked })} className="h-5 w-5" />
                      <input value={item.itemName} onChange={e => patch(date, item.itemCode, { itemName: e.target.value })} className="min-h-11 w-full rounded-lg border bg-white px-3 text-sm" />
                    </div>
                    <div className="flex min-w-0"><span className="flex min-h-11 items-center rounded-l-lg border border-r-0 bg-white px-3 text-gray-500">₹</span><input type="number" min="0" step="0.5" inputMode="decimal" value={item.unitPrice} onChange={e => patch(date, item.itemCode, { unitPrice: Number(e.target.value) })} className="min-h-11 w-full min-w-0 rounded-r-lg border bg-white px-3 text-base" /></div>
                    <span className="text-xs text-gray-500">{item.active ? 'Published' : 'Off'}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <button type="button" disabled={saving} onClick={saveWeek} className="mt-5 min-h-12 w-full rounded-lg bg-primary-600 px-4 font-semibold text-white disabled:opacity-50">{saving ? 'Saving 7-day menu…' : 'Save 7-Day Menu'}</button>
    </div>
  );
};

export default WeeklyMenuManagement;
