
import React, { useState, useMemo } from 'react';
import { useData } from '../../context/DataContext';
import { getMonthName, formatDate } from '../../utils/helpers';
import { Order, OrderItems } from '../../types';

const AllOrdersCalendar: React.FC = () => {
    const { orders, prices } = useData();
    const [currentDate, setCurrentDate] = useState(new Date());
    const [selectedDateOrders, setSelectedDateOrders] = useState<Order[]>([]);
    
    const startOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
    const endOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);
    const startDay = startOfMonth.getDay();
    const daysInMonth = endOfMonth.getDate();

    const ordersByDate = useMemo(() => {
        return orders.reduce((acc, order) => {
            (acc[order.date] = acc[order.date] || []).push(order);
            return acc;
        }, {} as Record<string, Order[]>);
    }, [orders]);

    const changeMonth = (offset: number) => {
        setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + offset, 1));
        setSelectedDateOrders([]);
    };

    const renderDays = () => {
        const days = [];
        for (let i = 0; i < startDay; i++) {
            days.push(<div key={`empty-${i}`} className="border border-gray-200"></div>);
        }
        for (let day = 1; day <= daysInMonth; day++) {
            const date = new Date(currentDate.getFullYear(), currentDate.getMonth(), day);
            const dateString = formatDate(date);
            const ordersForDay = ordersByDate[dateString] || [];
            const isToday = formatDate(new Date()) === dateString;

            days.push(
                <div 
                    key={day} 
                    className={`p-2 border border-gray-200 cursor-pointer transition-colors ${ordersForDay.length > 0 ? 'bg-green-100 hover:bg-green-200' : 'hover:bg-gray-100'} ${isToday ? 'bg-yellow-100' : ''}`}
                    onClick={() => setSelectedDateOrders(ordersForDay)}
                >
                    <span className={`block text-center text-sm ${isToday ? 'font-bold' : ''}`}>{day}</span>
                    {ordersForDay.length > 0 && <span className="block mt-1 text-xs text-center text-green-700">{ordersForDay.length} orders</span>}
                </div>
            );
        }
        return days;
    };

    const calculateOrderTotal = (items: OrderItems) => {
        let total = 0;
        if (items.morningTea) total += prices.morningTea;
        if (items.lunchMeals) total += prices.lunchMeals;
        if (items.lunchEgg) total += prices.lunchEgg;
        if (items.lunchFishMeat) total += prices.lunchFishMeat;
        if (items.eveningTea) total += prices.eveningTea;
        return total;
    };

    return (
         <div>
            <h3 className="mb-6 text-2xl font-bold text-gray-800">All Orders Calendar</h3>
            <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
                <div className="p-6 bg-white rounded-lg shadow-md xl:col-span-2">
                    <div className="flex items-center justify-between mb-4">
                        <button onClick={() => changeMonth(-1)} className="px-3 py-1 text-gray-600 bg-gray-200 rounded-md hover:bg-gray-300">&lt;</button>
                        <h3 className="text-xl font-semibold">{getMonthName(currentDate.getMonth())} {currentDate.getFullYear()}</h3>
                        <button onClick={() => changeMonth(1)} className="px-3 py-1 text-gray-600 bg-gray-200 rounded-md hover:bg-gray-300">&gt;</button>
                    </div>
                    <div className="grid grid-cols-7 text-xs font-bold text-center text-gray-600">
                        <div>Sun</div><div>Mon</div><div>Tue</div><div>Wed</div><div>Thu</div><div>Fri</div><div>Sat</div>
                    </div>
                    <div className="grid grid-cols-7 mt-1">{renderDays()}</div>
                </div>
                <div className="p-6 bg-white rounded-lg shadow-md xl:col-span-1">
                    <h4 className="mb-4 text-lg font-bold text-gray-800">Orders for {selectedDateOrders[0]?.date || '...'}</h4>
                    {selectedDateOrders.length > 0 ? (
                        <div className="space-y-4 overflow-y-auto max-h-96">
                            {selectedDateOrders.map(order => (
                                <div key={order.id} className="p-3 border border-gray-200 rounded-md">
                                    <p className="font-bold text-gray-700">ID: {order.employeeId}</p>
                                    <ul className="text-sm text-gray-600">
                                        {order.items.morningTea && <li>Morning Tea</li>}
                                        {order.items.lunchMeals && <li>Meals</li>}
                                        {order.items.lunchEgg && <li>+ Egg</li>}
                                        {order.items.lunchFishMeat && <li>+ Fish/Meat</li>}
                                        {order.items.eveningTea && <li>Evening Tea</li>}
                                    </ul>
                                    <p className="mt-1 font-semibold text-right">Total: ₹{calculateOrderTotal(order.items).toFixed(2)}</p>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <p className="text-gray-500">Select a date with orders to see details.</p>
                    )}
                </div>
            </div>
        </div>
    );
};

export default AllOrdersCalendar;
   