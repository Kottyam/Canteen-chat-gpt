import React, { useMemo, useState } from 'react';
import Header from '../shared/Header';
import OrderForm from './OrderForm';
import OrderCalendar from './OrderCalendar';
import Bills from './Bills';
import ChangePasswordModal from '../auth/ChangePasswordModal';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import { Order } from '../../types';

const EmployeeDashboard: React.FC = () => {
  const { user } = useAuth();
  const { orders, prices, menuItems } = useData();
  const [activeTab, setActiveTab] = useState<'home'|'orders'|'bills'|'profile'>('home');
  const [isPasswordModalOpen, setPasswordModalOpen] = useState(false);
  const today = new Date().toISOString().slice(0,10);
  const todayOrder = useMemo<Order|null>(() => user ? (orders.find(o => o.employeeId === user.id && o.date === today) || null) : null, [orders,user,today]);
  const orderTotal = useMemo(() => todayOrder ? (Object.entries(todayOrder.items) as [string,boolean][]).reduce((sum,[code,selected]) => selected ? sum + Number(todayOrder.itemPrices?.[code] ?? menuItems.find(i=>i.itemCode===code)?.unitPrice ?? (prices as any)[code] ?? 0) : sum,0) : 0,[todayOrder,menuItems,prices]);

  const content = () => {
    if (activeTab === 'orders') return <div className="space-y-6"><section><h2 className="mb-3 text-2xl font-bold text-gray-800">Today's Order</h2><OrderForm/></section><section><OrderCalendar/></section></div>;
    if (activeTab === 'bills') return <Bills/>;
    if (activeTab === 'profile') return <section className="mx-auto w-full max-w-xl"><h2 className="text-2xl font-bold text-gray-800">Profile</h2><div className="mt-5 space-y-3 rounded-xl border bg-white p-5"><div><span className="text-xs text-gray-500">Employee Name</span><p className="font-semibold text-gray-800">{user?.name || '—'}</p></div><div><span className="text-xs text-gray-500">Employee / SR Number</span><p className="font-semibold text-gray-800">{user?.id || '—'}</p></div><div><span className="text-xs text-gray-500">Mobile</span><p className="font-semibold text-gray-800">{user?.mobile || '—'}</p></div><div className="flex flex-col gap-2 pt-3 sm:flex-row"><button type="button" onClick={()=>setPasswordModalOpen(true)} className="rounded-lg bg-gray-100 px-4 py-3 font-semibold text-gray-700">Change Password</button><button type="button" onClick={()=>{sessionStorage.removeItem('canteen_user');window.location.reload()}} className="rounded-lg bg-red-600 px-4 py-3 font-semibold text-white">Logout</button></div></div></section>;
    return <section className="space-y-5"><div className="rounded-2xl bg-white p-5 shadow-sm"><p className="text-sm text-gray-500">{new Date().toLocaleDateString()}</p><h2 className="mt-1 text-2xl font-bold text-gray-800">Welcome, {user?.name || user?.id}</h2>{todayOrder ? <div className="mt-5 rounded-xl bg-gray-50 p-4"><div className="flex items-center justify-between gap-3"><div><p className="font-bold text-gray-800">Today's Order</p><p className="text-sm text-primary-700">{todayOrder.orderSource === 'admin' ? 'Placed by Admin' : 'Placed'}</p></div><p className="text-xl font-bold text-primary-700">₹{orderTotal.toFixed(2)}</p></div><button type="button" onClick={()=>setActiveTab('orders')} className="mt-4 w-full rounded-lg bg-red-600 px-4 py-3 font-semibold text-white">View / Cancel Order</button></div> : <div className="mt-5 rounded-xl bg-gray-50 p-4"><p className="font-semibold text-gray-800">No order placed yet</p><p className="mt-1 text-sm text-gray-500">Place today's order when ordering is open.</p><button type="button" onClick={()=>setActiveTab('orders')} className="mt-4 w-full rounded-lg bg-primary-600 px-4 py-3 font-semibold text-white">Place Today's Order</button></div>}<div className="mt-4 flex items-center justify-between rounded-xl border p-4"><span className="font-semibold text-gray-700">Today's Total</span><span className="text-xl font-bold text-gray-900">₹{orderTotal.toFixed(2)}</span></div></div><div className="rounded-xl border bg-white p-4"><p className="font-bold text-gray-800">Monthly Bills</p><p className="mt-1 text-sm text-gray-500">Published bills are available in Bills.</p><button type="button" onClick={()=>setActiveTab('bills')} className="mt-3 rounded-lg bg-primary-600 px-4 py-2.5 font-semibold text-white">View Bills</button></div></section>;
  };

  return <div className="min-h-screen w-full overflow-x-hidden bg-gray-100 pb-20"><Header onChangePassword={()=>setPasswordModalOpen(true)}/><main className="mx-auto w-full max-w-6xl px-3 py-4 sm:px-6 sm:py-6"><section className="w-full min-w-0 rounded-xl bg-white p-3 shadow-md sm:p-6">{content()}</section></main><nav className="fixed inset-x-0 bottom-0 z-40 border-t bg-white/95 px-2 py-2 shadow-[0_-2px_8px_rgba(0,0,0,0.08)] backdrop-blur"><div className="mx-auto grid max-w-2xl grid-cols-4 gap-1"><button onClick={()=>setActiveTab('home')} className={`rounded-lg px-2 py-2 text-xs font-semibold sm:text-sm ${activeTab==='home'?'bg-primary-600 text-white':'text-gray-600'}`}>🏠 Home</button><button onClick={()=>setActiveTab('orders')} className={`rounded-lg px-2 py-2 text-xs font-semibold sm:text-sm ${activeTab==='orders'?'bg-primary-600 text-white':'text-gray-600'}`}>🍛 Orders</button><button onClick={()=>setActiveTab('bills')} className={`rounded-lg px-2 py-2 text-xs font-semibold sm:text-sm ${activeTab==='bills'?'bg-primary-600 text-white':'text-gray-600'}`}>🧾 Bills</button><button onClick={()=>setActiveTab('profile')} className={`rounded-lg px-2 py-2 text-xs font-semibold sm:text-sm ${activeTab==='profile'?'bg-primary-600 text-white':'text-gray-600'}`}>👤 Profile</button></div></nav><ChangePasswordModal isOpen={isPasswordModalOpen} onClose={()=>setPasswordModalOpen(false)}/></div>;
};
export default EmployeeDashboard;
