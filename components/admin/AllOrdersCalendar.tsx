
import React, { useMemo, useState } from 'react';
import { useData } from '../../context/DataContext';
import { getMonthName, formatDate } from '../../utils/helpers';
import { Order, OrderItems } from '../../types';

const WEEKEND = [0, 6];

const AllOrdersCalendar: React.FC = () => {
  const { orders, prices } = useData();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [holidays, setHolidays] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('canteen_holidays') || '[]');
    } catch {
      return [];
    }
  });

  const startOfMonth = new Date(
    currentDate.getFullYear(),
    currentDate.getMonth(),
    1
  );
  const daysInMonth = new Date(
    currentDate.getFullYear(),
    currentDate.getMonth() + 1,
    0
  ).getDate();
  const startDay = startOfMonth.getDay();

  const ordersByDate = useMemo(() => {
    return orders.reduce((acc, order) => {
      (acc[order.date] = acc[order.date] || []).push(order);
      return acc;
    }, {} as Record<string, Order[]>);
  }, [orders]);

  const isHoliday = (date: Date) =>
    WEEKEND.includes(date.getDay()) ||
    holidays.includes(formatDate(date));

  const setHoliday = (date: Date) => {
    const dateString = formatDate(date);

    if (WEEKEND.includes(date.getDay())) return;

    const next = holidays.includes(dateString)
      ? holidays.filter(d => d !== dateString)
      : [...holidays, dateString];

    setHolidays(next);
    localStorage.setItem('canteen_holidays', JSON.stringify(next));
  };

  const selectedOrders = selectedDate
    ? ordersByDate[selectedDate] || []
    : [];

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
    setCurrentDate(
      new Date(
        currentDate.getFullYear(),
        currentDate.getMonth() + offset,
        1
      )
    );
    setSelectedDate(null);
  };

  const renderDays = () => {
    const days: React.ReactNode[] = [];

    for (let i = 0; i < startDay; i++) {
      days.push(
        <div key={`empty-${i}`} className="min-h-14 border bg-gray-50" />
      );
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(
        currentDate.getFullYear(),
        currentDate.getMonth(),
        day
      );
      const dateString = formatDate(date);
      const weekend = WEEKEND.includes(date.getDay());
      const holiday = isHoliday(date);
      const dayOrders = ordersByDate[dateString] || [];
      const isToday = formatDate(new Date()) === dateString;

      days.push(
        <button
          key={day}
          type="button"
          onClick={() => setSelectedDate(dateString)}
          onContextMenu={e => {
            e.preventDefault();
            setHoliday(date);
          }}
          className={`min-h-14 border p-1 text-left transition sm:min-h-20 sm:p-2 ${
            holiday
              ? 'bg-gray-200 text-gray-500'
              : dayOrders.length
                ? 'bg-green-50 hover:bg-green-100'
                : 'bg-white hover:bg-gray-50'
          } ${isToday ? 'ring-2 ring-primary-400 ring-inset' : ''}`}
          title={
            weekend
              ? 'Saturday/Sunday - Holiday'
              : holiday
                ? 'Holiday. Click to view; right-click to toggle holiday.'
                : 'Click to view orders. Right-click to declare holiday.'
          }
        >
          <span className={`block text-center text-xs sm:text-sm ${isToday ? 'font-bold' : ''}`}>
            {day}
          </span>

          {holiday ? (
            <span className="mt-1 block text-center text-[10px] font-medium sm:text-xs">
              Holiday
            </span>
          ) : dayOrders.length > 0 ? (
            <span className="mt-1 block text-center text-[10px] text-green-700 sm:text-xs">
              {dayOrders.length} orders
            </span>
          ) : null}
        </button>
      );
    }

    return days;
  };

  return (
    <div className="w-full min-w-0">
      <h3 className="mb-4 text-xl font-bold text-gray-800 sm:text-2xl">
        Orders & Holiday Calendar
      </h3>

      <div className="mb-4 rounded-lg border bg-gray-50 p-3 text-sm text-gray-600 sm:p-4">
        <p>
          <strong>Saturday and Sunday</strong> are automatically holidays.
        </p>
        <p className="mt-1">
          For another holiday, select the date and use{' '}
          <strong>Declare / Remove Holiday</strong> below.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="min-w-0 rounded-lg bg-white p-3 shadow-sm sm:p-5 xl:col-span-2">
          <div className="mb-4 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => changeMonth(-1)}
              className="rounded-md bg-gray-200 px-3 py-2 text-sm hover:bg-gray-300"
            >
              ←
            </button>

            <h4 className="text-base font-semibold sm:text-xl">
              {getMonthName(currentDate.getMonth())}{' '}
              {currentDate.getFullYear()}
            </h4>

            <button
              type="button"
              onClick={() => changeMonth(1)}
              className="rounded-md bg-gray-200 px-3 py-2 text-sm hover:bg-gray-300"
            >
              →
            </button>
          </div>

          <div className="grid grid-cols-7 text-center text-[10px] font-bold text-gray-500 sm:text-xs">
            <div>Sun</div>
            <div>Mon</div>
            <div>Tue</div>
            <div>Wed</div>
            <div>Thu</div>
            <div>Fri</div>
            <div>Sat</div>
          </div>

          <div className="mt-1 grid grid-cols-7 overflow-hidden rounded border">
            {renderDays()}
          </div>

          {selectedDate && (
            <div className="mt-4 rounded-lg border bg-gray-50 p-3">
              <p className="font-semibold">Selected: {selectedDate}</p>
              <p className="mt-1 text-sm text-gray-600">
                Status:{' '}
                {isHoliday(new Date(`${selectedDate}T00:00:00`))
                  ? 'Holiday'
                  : 'Working day'}
              </p>

              {!WEEKEND.includes(
                new Date(`${selectedDate}T00:00:00`).getDay()
              ) && (
                <button
                  type="button"
                  onClick={() =>
                    setHoliday(new Date(`${selectedDate}T00:00:00`))
                  }
                  className="mt-3 w-full rounded-md bg-primary-600 px-4 py-2.5 text-sm font-medium text-white sm:w-auto"
                >
                  {holidays.includes(selectedDate)
                    ? 'Remove Holiday'
                    : 'Declare Holiday'}
                </button>
              )}
            </div>
          )}
        </div>

        <div className="min-w-0 rounded-lg bg-white p-3 shadow-sm sm:p-5">
          <h4 className="mb-4 text-lg font-bold text-gray-800">
            Orders for {selectedDate || 'selected date'}
          </h4>

          {selectedOrders.length > 0 ? (
            <div className="max-h-[32rem] space-y-3 overflow-y-auto">
              {selectedOrders.map(order => (
                <div
                  key={order.id}
                  className="rounded-md border p-3"
                >
                  <p className="font-bold text-gray-700">
                    SR: {order.employeeId}
                  </p>

                  <ul className="mt-1 text-sm text-gray-600">
                    {order.items.morningTea && <li>Morning Tea</li>}
                    {order.items.lunchMeals && <li>Meals</li>}
                    {order.items.lunchEgg && <li>+ Egg</li>}
                    {order.items.lunchFishMeat && <li>+ Fish/Meat</li>}
                    {order.items.eveningTea && <li>Evening Tea</li>}
                  </ul>

                  <p className="mt-2 text-right font-semibold">
                    Total: ₹{calculateOrderTotal(order.items).toFixed(2)}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-500">
              {selectedDate
                ? 'No orders for this date.'
                : 'Select a date to see orders.'}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default AllOrdersCalendar;
   
