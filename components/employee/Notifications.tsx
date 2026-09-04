import React,{useEffect,useState}from'react';
import {loadMyNotifications,markNotificationRead,NotificationRow}from'../../services/notifications';

interface NotificationsProps{onBack:()=>void;onOpenBill:(billId:string)=>void;}
const Notifications:React.FC<NotificationsProps>=({onBack,onOpenBill})=>{
  const[items,setItems]=useState<NotificationRow[]>([]);const[loading,setLoading]=useState(true);
  const load=async()=>{try{setItems(await loadMyNotifications())}catch{setItems([])}finally{setLoading(false)}};
  useEffect(()=>{void load();const timer=window.setInterval(()=>void load(),15000);return()=>window.clearInterval(timer)},[]);
  const open=async(n:NotificationRow)=>{try{await markNotificationRead(n.id)}catch{return}setItems(p=>p.filter(x=>x.id!==n.id));if(n.notification_type==='monthly_bill_published'&&typeof n.payload?.bill_id==='string'){onOpenBill(n.payload.bill_id);return}};
  return <section className="w-full min-w-0"><div className="mb-5 flex items-center gap-3"><button type="button" onClick={onBack} className="rounded-lg border px-3 py-2 text-sm font-semibold text-gray-700">← Back</button><div><h2 className="text-2xl font-bold text-gray-800">Notifications</h2><p className="text-sm text-gray-500">{items.length} pending</p></div></div>{loading?<p className="rounded-lg bg-gray-50 p-4 text-sm text-gray-500">Loading notifications…</p>:items.length===0?<p className="rounded-lg border bg-gray-50 p-5 text-sm text-gray-500">No pending notifications.</p>:<div className="space-y-2">{items.map(n=><button key={n.id} type="button" onClick={()=>void open(n)} className="block w-full rounded-xl border bg-primary-50 p-4 text-left"><div className="flex items-start justify-between gap-3"><span className="font-semibold text-gray-800 break-words">{n.title}</span><span className="shrink-0 rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-bold text-white">NEW</span></div><p className="mt-1 break-words text-sm text-gray-600">{n.message}</p><p className="mt-2 text-[11px] text-gray-400">{new Date(n.created_at).toLocaleString()}</p>{n.notification_type==='monthly_bill_published'&&<p className="mt-2 text-xs font-semibold text-primary-700">Tap to open bill</p>}</button>)}</div>}</section>;
};
export default Notifications;
