import React,{useEffect,useMemo,useState}from'react';
import{useAuth}from'../../context/AuthContext';
import{useData}from'../../context/DataContext';
import{OrderItems,Order}from'../../types';
import{formatDate}from'../../utils/helpers';
import{upsertOrder,cancelOrder}from'../../services/supabaseSync';
import{supabase}from'../../supabase';

const OrderForm:React.FC=()=>{
 const{user}=useAuth();
 const{orders,setOrders,prices,menuItems,holidays}=useData();
 const now=new Date();
 const today=formatDate(now);
 const weekend=now.getDay()===0||now.getDay()===6;
 const holiday=weekend||holidays.includes(today);
 const todayOrder=user?orders.find(o=>o.employeeId===user.id&&o.date===today&&o.status!=='cancelled'):undefined;
 const activeItems=useMemo(()=>menuItems.filter(i=>i.active&&!i.archived),[menuItems]);
 const[serverEmployeeOrder,setServerEmployeeOrder]=useState<Order|null>(null);
 const[checkingEmployeeOrder,setCheckingEmployeeOrder]=useState(true);
 const[items,setItems]=useState<OrderItems>({});
 const[quantities,setQuantities]=useState<Record<string,number>>({});
 const[msg,setMsg]=useState('');
 const[saving,setSaving]=useState(false);
 const[windowOpen,setWindowOpen]=useState(true);

 const fetchActiveEmployeeOrder=async():Promise<Order|null>=>{
  if(!user||!supabase)return null;
  const{data:profile,error:pe}=await supabase.from('profiles').select('id').or(`employee_code.eq.${user.id},sr_number.eq.${user.id}`).maybeSingle();
  if(pe)throw pe;
  if(!profile)return null;
  const{data,error}=await supabase.from('orders').select('id,employee_id,ordered_for,status,created_at,updated_at,cancelled_at,order_source,guest_name,guest_count,guest_total,order_items(item_code,item_name,quantity,unit_price,item_source,guest_name)').eq('employee_id',profile.id).eq('ordered_for',today).eq('status','active').order('created_at',{ascending:false});
  if(error)throw error;
  const row=(data||[]).find((o:any)=>(o.order_items||[]).some((i:any)=>i.item_source!=='guest'&&Number(i.quantity)>0));
  if(!row)return null;
  const employeeItems:OrderItems={},itemQuantities:Record<string,number>={},itemPrices:Record<string,number>={},itemNames:Record<string,string>={},guestItems:OrderItems={},guestItemQuantities:Record<string,number>={},guestItemPrices:Record<string,number>={},guestItemNames:Record<string,string>{};
  (row.order_items||[]).forEach((i:any)=>{
   if(Number(i.quantity)<=0)return;
   if(i.item_source==='guest'){
    guestItems[i.item_code]=true;guestItemQuantities[i.item_code]=Number(i.quantity);guestItemPrices[i.item_code]=Number(i.unit_price);guestItemNames[i.item_code]=i.item_name||i.item_code;
   }else{
    employeeItems[i.item_code]=true;itemQuantities[i.item_code]=Number(i.quantity);itemPrices[i.item_code]=Number(i.unit_price);itemNames[i.item_code]=i.item_name||i.item_code;
   }
  });
  return{id:row.id,employeeId:user.id,date:row.ordered_for,items:employeeItems,itemQuantities,itemPrices,itemNames,guestItems,guestItemQuantities,guestItemPrices,guestItemNames,orderSource:row.order_source==='admin'?'admin':'employee',guestName:row.guest_name||undefined,guestCount:row.guest_count==null?undefined:Number(row.guest_count),guestTotal:Number(row.guest_total||0),status:'active',cancelledAt:row.cancelled_at||undefined};
 };

 const existing=serverEmployeeOrder;

 useEffect(()=>{setItems({});setQuantities({})},[existing?.id,today]);
 useEffect(()=>{
  let mounted=true;
  const check=async()=>{
   if(!mounted)return;
   try{
    const result=await fetchActiveEmployeeOrder();
    if(mounted){setServerEmployeeOrder(result);setCheckingEmployeeOrder(false)}
   }catch(error){
    console.error('Active employee order check failed',error);
    if(mounted){setServerEmployeeOrder(null);setCheckingEmployeeOrder(false);setMsg('Could not verify today’s employee order. Please try again.')}
   }
  };
  void check();
  return()=>{mounted=false};
 },[user?.id,today]);
 useEffect(()=>{
  let mounted=true;
  const check=async()=>{if(!supabase||holiday){if(mounted)setWindowOpen(!holiday);return}const{data,error}=await supabase.rpc('employee_order_window_open');if(mounted)setWindowOpen(!error&&data!==false)};
  void check();const timer=window.setInterval(check,30000);return()=>{mounted=false;window.clearInterval(timer)}
 },[today,holiday]);

 const change=(code:string,checked:boolean)=>{if(holiday||!windowOpen||existing)return;setItems(p=>({...p,[code]:checked}));if(checked)setQuantities(p=>({...p,[code]:Math.max(1,Number(p[code]||1))}));else setQuantities(p=>{const n={...p};delete n[code];return n})};
 const setQty=(code:string,value:number)=>{if(holiday||!windowOpen||existing)return;const qty=Math.max(0,Math.min(99,value));setQuantities(p=>({...p,[code]:qty}));setItems(p=>({...p,[code]:qty>0}))};
 const price=(code:string)=>Number(menuItems.find(i=>i.itemCode===code)?.unitPrice??(code in prices?prices[code as keyof typeof prices]:0));
 const selectedTotal=activeItems.reduce((s,i)=>s+(items[i.itemCode]?price(i.itemCode)*Math.max(1,Number(quantities[i.itemCode]||1)):0),0);
 const storedTotal=existing?Object.keys(existing.items||{}).reduce((s,c)=>s+(existing.items[c]?Number(existing.itemPrices?.[c]??price(c))*Math.max(1,Number(existing.itemQuantities?.[c]||1)):0),0):0;

 const save=async(e:React.FormEvent)=>{
  e.preventDefault();if(!user)return;if(holiday){setMsg('Today is a holiday. Ordering is not available.');return}if(!windowOpen){setMsg('Ordering is currently closed.');return}
  setSaving(true);setMsg('');
  try{
   const serverOrder=await fetchActiveEmployeeOrder();
   if(serverOrder){setServerEmployeeOrder(serverOrder);setMsg('Employee order already placed for today. Cancel it before placing a new order.');return}
   const chosen=activeItems.filter(i=>items[i.itemCode]&&Number(quantities[i.itemCode]||0)>0);
   if(!chosen.length){setMsg('Please select at least one menu item.');return}
   const base=todayOrder||undefined;
   const itemPrices:Record<string,number>={},itemNames:Record<string,string>={},itemQuantities:Record<string,number>={};
   chosen.forEach(i=>{itemPrices[i.itemCode]=i.unitPrice;itemNames[i.itemCode]=i.itemName;itemQuantities[i.itemCode]=Math.max(1,Number(quantities[i.itemCode]||1))});
   const order:Order={id:base?.id||crypto.randomUUID(),employeeId:user.id,date:today,items:Object.fromEntries(chosen.map(i=>[i.itemCode,true])),itemQuantities,itemPrices,itemNames,guestItems:base?.guestItems,guestItemQuantities:base?.guestItemQuantities,guestItemPrices:base?.guestItemPrices,guestItemNames:base?.guestItemNames,guestName:base?.guestName,guestCount:base?.guestCount,guestTotal:base?.guestTotal,orderSource:'employee',status:'active'};
   await upsertOrder(order,prices);
   const refreshed=await fetchActiveEmployeeOrder();
   setOrders(p=>{const idx=p.findIndex(o=>o.id===order.id);if(idx<0)return[...p,refreshed||order];const n=[...p];n[idx]={...n[idx],...(refreshed||order)};return n});
   setServerEmployeeOrder(refreshed||order);setItems({});setQuantities({});setMsg('Today’s order saved successfully.');
  }catch(error:any){console.error('Order save failed',error);setMsg(error?.message||'Could not save order. Please try again.')}finally{setSaving(false)}
 };

 const cancelToday=async()=>{
  if(!user||holiday||!windowOpen||!existing)return;if(!window.confirm('Cancel your employee order for today?'))return;setSaving(true);setMsg('');
  try{
   const hasGuest=Object.keys(existing.guestItems||{}).some(c=>existing.guestItems?.[c]);
   if(hasGuest){const updated:Order={...existing,items:{},itemQuantities:{},itemPrices:{},itemNames:{},status:'active'};await upsertOrder(updated,prices);setOrders(p=>p.map(o=>o.id===existing.id?updated:o));}
   else{await cancelOrder(existing);setOrders(p=>p.filter(o=>o.id!==existing.id));}
   setItems({});setQuantities({});
   const refreshed=await fetchActiveEmployeeOrder();
   setServerEmployeeOrder(refreshed);
   setMsg(refreshed?'Employee order is still active.':'Today’s employee order cancelled. You can now place a new order.');
  }catch(error:any){console.error('Order cancel failed',error);setMsg(error?.message||'Could not cancel order. Please try again.')}finally{setSaving(false)}
 };

 return <div className="w-full min-w-0 rounded-xl bg-white p-3 shadow-sm sm:p-6">
  <div className="mb-4"><h3 className="text-xl font-bold text-gray-800">Today’s Employee Order</h3><p className="text-sm text-gray-500">{today}</p></div>
  {checkingEmployeeOrder?<div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">Checking today’s employee order…</div>:existing&&<div className="mb-4 rounded-xl border border-primary-200 bg-primary-50 p-4"><div className="font-bold text-primary-800">Employee order already placed for today</div><div className="mt-3 space-y-2">{Object.keys(existing.items||{}).filter(c=>existing.items[c]).map(c=>{const q=Math.max(1,Number(existing.itemQuantities?.[c]||1));const u=Number(existing.itemPrices?.[c]??price(c));return <div key={c} className="flex justify-between gap-3 text-sm"><span>{existing.itemNames?.[c]??menuItems.find(i=>i.itemCode===c)?.itemName??c} × {q}</span><span className="font-semibold">₹{(u*q).toFixed(2)}</span></div>})}</div><div className="mt-3 flex justify-between border-t pt-3 font-bold"><span>Employee Total</span><span>₹{storedTotal.toFixed(2)}</span></div>{!holiday&&windowOpen&&<button type="button" disabled={saving} onClick={cancelToday} className="mt-4 min-h-12 w-full rounded-lg bg-red-600 px-4 font-semibold text-white disabled:opacity-50">{saving?'Cancelling…':'Cancel Employee Order'}</button>}{msg&&<p className="mt-3 rounded-lg bg-gray-50 p-3 text-sm text-gray-700">{msg}</p>}</div>}
  {!checkingEmployeeOrder&&holiday?<div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4"><div className="text-lg font-bold text-amber-800">🎉 Holiday</div><p className="mt-1 text-sm text-amber-700">{weekend?'Saturday and Sunday are holidays.':'Admin has declared today a holiday.'} Orders are closed.</p></div>:!checkingEmployeeOrder&&!windowOpen&&<div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4"><div className="font-bold text-amber-800">Ordering is currently closed</div><p className="mt-1 text-sm text-amber-700">Today’s order window is currently closed.</p></div>}
  {!checkingEmployeeOrder&&!existing&&<form onSubmit={save} className="space-y-3">{activeItems.map(item=>{const q=Number(quantities[item.itemCode]||0);return <div key={item.itemCode} className={`flex min-h-14 items-center justify-between gap-3 rounded-xl border p-3 ${(holiday||!windowOpen)?'opacity-60':''}`}><div className="flex min-w-0 items-center gap-3"><input type="checkbox" disabled={holiday||!windowOpen} checked={q>0} onChange={e=>change(item.itemCode,e.currentTarget.checked)} className="h-5 w-5 shrink-0 touch-manipulation"/><span className="min-w-0 break-words text-sm font-medium text-gray-700 sm:text-base">{item.itemName}</span><span className="shrink-0 text-sm font-semibold">₹{item.unitPrice}</span></div>{q>0&&<div className="flex shrink-0 items-center gap-1"><button type="button" disabled={holiday||!windowOpen} onClick={()=>setQty(item.itemCode,q-1)} className="h-9 w-9 rounded-lg border bg-white font-bold disabled:opacity-50">−</button><span className="w-7 text-center font-semibold">{q}</span><button type="button" disabled={holiday||!windowOpen} onClick={()=>setQty(item.itemCode,q+1)} className="h-9 w-9 rounded-lg border bg-white font-bold disabled:opacity-50">+</button></div>}</div>})}<div className="flex items-center justify-between border-t pt-3"><span className="font-semibold">Order Total</span><span className="text-lg font-bold text-primary-700">₹{selectedTotal.toFixed(2)}</span></div><button type="submit" disabled={saving||holiday||!windowOpen||activeItems.length===0} className="min-h-12 w-full rounded-lg bg-primary-600 px-4 font-semibold text-white disabled:opacity-50">{holiday?'Ordering Closed':!windowOpen?'Ordering Closed':saving?'Saving…':'Add Selected Items'}</button>{msg&&<p className="rounded-lg bg-gray-50 p-3 text-sm text-gray-700">{msg}</p>}</form>}
 </div>;
};
export default OrderForm;
