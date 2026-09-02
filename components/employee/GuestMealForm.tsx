import React,{useEffect,useMemo,useState}from'react';
import {useAuth}from'../../context/AuthContext';
import {useData}from'../../context/DataContext';
import {Order}from'../../types';
import {formatDate}from'../../utils/helpers';
import {upsertOrder}from'../../services/supabaseSync';
import {supabase}from'../../supabase';

const GuestMealForm:React.FC=()=>{
  const{user}=useAuth();
  const{orders,setOrders,menuItems,holidays}=useData();
  const today=formatDate(new Date());
  const holiday=new Date(`${today}T00:00:00`).getDay()===0||new Date(`${today}T00:00:00`).getDay()===6||holidays.includes(today);
  const activeItems=useMemo(()=>menuItems.filter(i=>i.active&&!i.archived),[menuItems]);
  const[guestName,setGuestName]=useState('');
  const[selected,setSelected]=useState<Record<string,boolean>>({});
  const[windowOpen,setWindowOpen]=useState(true);
  const[windowLabel,setWindowLabel]=useState('');
  const[saving,setSaving]=useState(false);
  const[msg,setMsg]=useState('');
  useEffect(()=>{
    let alive=true;
    const check=async()=>{
      if(!supabase||holiday){if(alive){setWindowOpen(!holiday);setWindowLabel('')}return}
      const{data,error}=await supabase.from('order_windows').select('enabled,start_time,end_time').eq('weekday',new Date().getDay()).maybeSingle();
      if(error||!data){if(alive){setWindowOpen(true);setWindowLabel('')}return}
      const hm=new Date().toTimeString().slice(0,5);const start=String(data.start_time).slice(0,5),end=String(data.end_time).slice(0,5);
      if(alive){setWindowOpen(Boolean(data.enabled)&&hm>=start&&hm<end);setWindowLabel(`${start} – ${end}`)}
    };
    void check();const timer=window.setInterval(check,30000);return()=>{alive=false;window.clearInterval(timer)};
  },[today,holiday]);
  const total=activeItems.reduce((sum,item)=>sum+(selected[item.itemCode]?Number(item.unitPrice):0),0);
  const toggle=(code:string)=>{if(holiday||!windowOpen)return;setSelected(prev=>({...prev,[code]:!prev[code]}))};
  const save=async(e:React.FormEvent)=>{
    e.preventDefault();if(!user)return;
    if(holiday){setMsg('Guest meals are not available on holidays.');return}
    if(!windowOpen){setMsg(`Ordering is closed. Order time: ${windowLabel||'not configured'}.`);return}
    const chosen=activeItems.filter(i=>selected[i.itemCode]);if(!chosen.length){setMsg('Please select at least one menu item.');return}
    setSaving(true);setMsg('');
    try{
      const itemPrices:Record<string,number>={},itemNames:Record<string,string>={};chosen.forEach(i=>{itemPrices[i.itemCode]=i.unitPrice;itemNames[i.itemCode]=i.itemName});
      const order:Order={id:crypto.randomUUID(),employeeId:user.id,date:today,items:Object.fromEntries(chosen.map(i=>[i.itemCode,true])),itemPrices,itemNames,orderSource:'guest',guestName:guestName.trim()||undefined};
      await upsertOrder(order,{morningTea:0,lunchMeals:0,lunchEgg:0,lunchFishMeat:0,eveningTea:0});
      setOrders(prev=>[...prev,order]);setGuestName('');setSelected({});setMsg('Guest meal added successfully.');
    }catch(error:any){setMsg(error?.message||'Could not add guest meal.')}finally{setSaving(false)}
  };
  const todayGuests=orders.filter(o=>o.employeeId===user?.id&&o.date===today&&o.orderSource==='guest'&&o.status!=='cancelled');
  return <section className="rounded-xl border bg-white p-4 shadow-sm sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-lg font-bold text-gray-800">Guest Meals</h3><p className="mt-1 text-sm text-gray-500">Add guest food using the same current Menu &amp; Prices.</p></div><span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-600">Today: ₹{todayGuests.reduce((s,o)=>s+Object.keys(o.items).reduce((x,k)=>x+(o.items[k]?Number(o.itemPrices?.[k]||0):0),0),0).toFixed(2)}</span></div>
    {holiday&&<div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">Guest meals are closed today because it is a holiday.</div>}
    {!holiday&&!windowOpen&&<div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">Guest meal ordering is currently closed. Order time: {windowLabel||'not configured'}.</div>}
    <form onSubmit={save} className="mt-4 space-y-3">
      <input value={guestName} onChange={e=>setGuestName(e.target.value)} placeholder="Guest Name (optional)" className="w-full rounded-md border px-3 py-2.5" maxLength={100}/>
      <div className="space-y-2">{activeItems.map(item=><label key={item.itemCode} className={`flex min-h-14 cursor-pointer items-center justify-between gap-3 rounded-xl border p-3 ${(holiday||!windowOpen)?'opacity-60':''}`}><span className="flex min-w-0 items-center gap-3"><input type="checkbox" disabled={holiday||!windowOpen} checked={Boolean(selected[item.itemCode])} onChange={()=>toggle(item.itemCode)} className="h-5 w-5 shrink-0"/><span className="break-words text-sm font-medium text-gray-700">{item.itemName}</span></span><span className="shrink-0 text-sm font-semibold">₹{item.unitPrice}</span></label>)}</div>
      <div className="flex items-center justify-between border-t pt-3"><span className="font-semibold">Guest Total</span><span className="text-lg font-bold text-primary-700">₹{total.toFixed(2)}</span></div>
      <button type="submit" disabled={saving||holiday||!windowOpen||activeItems.length===0} className="min-h-12 w-full rounded-lg bg-primary-600 px-4 font-semibold text-white disabled:opacity-50">{saving?'Saving…':'Add Guest Meal'}</button>
      {msg&&<p className="rounded-lg bg-gray-50 p-3 text-sm text-gray-700">{msg}</p>}
    </form>
  </section>;
};
export default GuestMealForm;
