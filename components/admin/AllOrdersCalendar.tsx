import React, { useMemo, useState } from 'react';
import { useData } from '../../context/DataContext';
import { getMonthName, formatDate } from '../../utils/helpers';
import { Order, OrderItems } from '../../types';

const WEEKEND = [0, 6];

const AllOrdersCalendar: React.FC = () => {
  const { orders, prices, holidays, addHoliday, deleteHoliday } = useData();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  const ordersByDate = useMemo(
    () => orders.reduce((acc, order) => {
      (acc[order.date] = acc[order.date] || []).push(order);
      return acc;
    }, {} as Record<string, Order[]>),
    [orders]
  );

  const isHoliday = (date: Date) =>
    WEEKEND.includes(date.getDay()) || holidays.includes(formatDate(date));

  const toggleHoliday = async (dateString: string) => {
    const date = new Date(`${dateString}T00:00:00`);
    if (WEEKEND.includes(date.getDay())) {
      setMessage('Saturday and Sunday are automatically holidays.');
      return;
    }

    setSaving(true);
    setMessage('');
    try {
      if (holidays.includes(dateString)) {
        await deleteHoliday(dateString);
        setMessage(`${dateString} holiday removed.`);
      } else {
        await addHoliday(dateString);
        setMessage(`${dateString} declared as holiday.`);
      }
    } catch (error: any) {
      console.error(error);
      setMessage(`Holiday update failed: ${error?.message || 'Unknown error'}`);
    } finally {
      setSaving(false);
    }
  };

  const selectedOrders = selectedDate ? ordersByDate[selectedDate] || [] : [];

  const calculateOrderTotal = (items: OrderItems) => {
    let total = 0;
    if (items.morningTea) total += prices.morningTea;
    if (items.lunchMeals) total += prices.lunchMeals;
    if (items.lunchEgg) total += prices.lunchEgg;
    if (items.lunchFishMeat) total += prices.lunchFishMeat;
    if (items.eveningTea) total += prices.eveningTea;
    return total;
  };

  const changeMonth = (offset: number) => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + offset, 1));
    setSelectedDate(null);
  };

  const firstDay = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1).getDay();
  const daysInMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0).getDate();

  const days: React.ReactNode[] = [];
  for (let i = 0; i < firstDay; i++) {
    days.push(<div key={`blank-${i}`} className="min-h-16 border bg-gray-50 sm:min-h-20" />);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(currentDate.getFullYear(), currentDate.getMonth(), day);
    const dateString = formatDate(date);
    const holiday = isHoliday(date);
    const dayOrders = ordersByDate[dateString] || [];
    const today = formatDate(new Date()) === dateString;

    days.push(
      <button
        key={day}
        type="button"
        onClick={() => setSelectedDate(dateString)}
        className={`min-h-16 border p-1 text-left sm:min-h-20 sm:p-2 ${
          holiday ? 'bg-gray-200 text-gray-500' : 'bg-white hover:bg-green-50'
        } ${today ? 'ring-2 ring-primary-400 ring-inset' : ''}`}
      >
        <div className="text-center text-xs font-semibold sm:text-sm">{day}</div>
        <div className="mt-1 text-center text-[9px] sm:text-xs">
          {holiday ? 'Holiday' : dayOrders.length ? `${dayOrders.length} orders` : ''}
        </div>
      </button>
    );
  }

  return (
    <div className="w-full min-w-0">
      <h3 className="mb-4 text-xl font-bold text-gray-800 sm:text-2xl">Orders & Holiday Calendar</h3>

      <div className="mb-4 rounded-lg border bg-gray-50 p-3 text-sm text-gray-600">
        Saturday and Sunday are automatic holidays. Select a date to declare or remove another holiday.
      </div>

      {message && (
        <div className="mb-4 rounded-lg bg-green-50 p-3 text-sm text-green-700">{message}</div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="min-w-0 rounded-lg bg-white p-3 shadow-sm sm:p-5 xl:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <button type="button" onClick={() => changeMonth(-1)} className="rounded-md bg-gray-200 px-3 py-2">←</button>
            <h4 className="text-base font-semibold sm:text-xl">{getMonthName(currentDate.getMonth())} {currentDate.getFullYear()}</h4>
            <button type="button" onClick={() => changeMonth(1)} className="rounded-md bg-gray-200 px-3 py-2">→</button>
          </div>

          <div className="grid grid-cols-7 text-center text-[10px] font-bold text-gray-500 sm:text-xs">
            {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => <div key={d}>{d}</div>)}
          </div>
          <div className="mt-1 grid grid-cols-7 overflow-hidden rounded border">{days}</div>

          {selectedDate && (
            <div className="mt-4 rounded-lg border bg-gray-50 p-3">
              <p className="font-semibold">Selected date: {selectedDate}</p>
              <p className="mt-1 text-sm text-gray-600">
                {isHoliday(new Date(`${selectedDate}T00:00:00`)) ? 'Holiday' : 'Working day'}
              </p>
              {!WEEKEND.includes(new Date(`${selectedDate}T00:00:00`).getDay()) && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => toggleHoliday(selectedDate)}
                  className="mt-3 min-h-11 w-full rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50 sm:w-auto"
                >
                  {saving ? 'Saving…' : holidays.includes(selectedDate) ? 'Remove Holiday' : 'Declare Holiday'}
                </button>
              )}
            </div>
          )}
        </div>

        <div className="min-w-0 rounded-lg bg-white p-3 shadow-sm sm:p-5">
          <h4 className="mb-4 text-lg font-bold text-gray-800">Orders for {selectedDate || 'selected date'}</h4>
          {selectedOrders.length ? (
            <div className="max-h-[32rem] space-y-3 overflow-y-auto">
              {selectedOrders.map(order => (
                <div key={order.id} className="rounded-lg border p-3">
                  <p className="font-bold">SR: {order.employeeId}</p>
                  <ul className="mt-1 text-sm text-gray-600">
                    {order.items.morningTea && <li>Morning Tea</li>}
                    {order.items.lunchMeals && <li>Meals</li>}
                    {order.items.lunchEgg && <li>+ Egg</li>}
                    {order.items.lunchFishMeat && <li>+ Fish/Meat</li>}
                    {order.items.eveningTea && <li>Evening Tea</li>}
                  </ul>
                  <p className="mt-2 text-right font-semibold">₹{calculateOrderTotal(order.items).toFixed(2)}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-500">{selectedDate ? 'No orders for this date.' : 'Select a date to see orders.'}</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default AllOrdersCalendar;
