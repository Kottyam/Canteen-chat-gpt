import React,{useEffect,useMemo,useState}from'react';
import{useData}from'../../context/DataContext';
import{getMonthName,formatDate}from'../../utils/helpers';
import{Order}from'../../types';
import{supabase}from'../../supabase';

const WEEKDAYS=[['Monday',1],['Tuesday',2],['Wednesday',3],['Thursday',4],['Friday',5],['Saturday',6],['Sunday',0]] as const;

const AllOrdersCalendar:React.FC=()=>{
  const{users,orders}=useData();
  const[currentDate,setCurrentDate]=useState(new Date());
  const[selectedDate,setSelectedDate]=useState<string|null>(null);
  const[message,setMessage]=useState('');
  const[saving,setSaving]=useState(false);
  const[recurringWeekdays,setRecurringWeekdays]=useState<number[]>([]);
  const[declaredDates,setDeclaredDates]=useState<string[]>([]);
  const[holidayLoading,setHolidayLoading]=useState(true);

  const loadHolidayConfiguration=async()=>{
    if(!supabase)return;
    setHolidayLoading(true);
    try{
      const{data,error}=await supabase.rpc('get_holiday_configuration');
      if(error)throw error;
      const cfg=(data||{}) as {recurring_weekdays?:unknown;declared_dates?:unknown};
      setRecurringWeekdays(Array.isArray(cfg.recurring_weekdays)?cfg.recurring_weekdays.map(Number):[]);
      setDeclaredDates(Array.isArray(cfg.declared_dates)?cfg.declared_dates.map(String):[]);
    }catch(error:any){
      console.error('Holiday configuration load failed',error);
      setMessage('Could not load the latest holiday configuration.');
      setRecurringWeekdays([]);
      setDeclaredDates([]);
    }finally{setHolidayLoading(false)}
  };

  useEffect(()=>{
    void loadHolidayConfiguration();
    const refresh=()=>void loadHolidayConfiguration();
    window.addEventListener('focus',refresh);
    document.addEventListener('visibilitychange',refresh);
    const timer=window.setInterval(refresh,10000);
    return()=>{window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);window.clearInterval(timer)};
  },[]);

  const ordersByDate=useMemo(()=>orders.reduce((acc,order)=>{(acc[order.date]=acc[order.date]||[]).push(order);return acc},{}as Record<string,Order[]>),[orders]);
  const employeeName=(id:string)=>users.find(u=>u.id===id)?.name||'Unknown employee';
  const isHoliday=(date:Date)=>declaredDates.includes(formatDate(date))||recurringWeekdays.includes(date.getDay());
  const recurringLabel=useMemo(()=>WEEKDAYS.filter(([,value])=>recurringWeekdays.includes(value)).map(([label])=>label),[recurringWeekdays]);

  const toggleHoliday=async(dateString:string)=>{
    if(!supabase||holidayLoading||saving)return;
    const date=new Date(`${dateString}T00:00:00`);
    if(recurringWeekdays.includes(date.getDay())){
      setMessage('This date is covered by the recurring holiday setting. Change it in Settings → Time Management → Holiday Management.');
      return;
    }
    setSaving(true);setMessage('');
    try{
      if(declaredDates.includes(dateString)){
        const{error}=await supabase.from('holiday_dates').delete().eq('holiday_date',dateString);
        if(error)throw error;
        setMessage(`${dateString} declared holiday removed.`);
      }else{
        const{error}=await supabase.rpc('admin_add_declared_holiday',{p_date:dateString});
        if(error)throw error;
        setMessage(`${dateString} declared as holiday.`);
      }
      await loadHolidayConfiguration();
    }catch(error:any){console.error(error);setMessage(error?.message||'Holiday update failed. Please try again.')}finally{setSaving(false)}
  };

  const selectedOrders=selectedDate?ordersByDate[selectedDate]||[]:[];
  const normalTotal=(order:Order)=>Object.keys(order.items||{}).reduce((s,c)=>s+(order.items[c]?Number(order.itemPrices?.[c]||0)*Math.max(1,Number(order.itemQuantities?.[c]||1)):0),0);
  const guestTotal=(order:Order)=>Object.keys(order.guestItems||{}).reduce((s,c)=>s+(order.guestItems?.[c]?Number(order.guestItemPrices?.[c]||0)*Math.max(1,Number(order.guestItemQuantities?.[c]||1)):0),0);
  const changeMonth=(offset:number)=>{setCurrentDate(new Date(currentDate.getFullYear(),currentDate.getMonth()+offset,1));setSelectedDate(null)};
  const firstDay=new Date(currentDate.getFullYear(),currentDate.getMonth(),1).getDay();
  const daysInMonth=new Date(currentDate.getFullYear(),currentDate.getMonth()+1,0).getDate();
  const days:React.ReactNode[]=[];
  for(let i=0;i<firstDay;i++)days.push(<div key={`blank-${i}`} className="min-h-16 border bg-gray-50 sm:min-h-20"/>);
  for(let day=1;day<=daysInMonth;day++){
    const date=new Date(currentDate.getFullYear(),currentDate.getMonth(),day);
    const dateString=formatDate(date);
    const holiday=isHoliday(date);
    const count=(ordersByDate[dateString]||[]).length;
    const today=formatDate(new Date())===dateString;
    days.push(<button key={day} type="button" onClick={()=>setSelectedDate(dateString)} className={`min-h-16 border p-1 text-left sm:min-h-20 sm:p-2 ${holiday?'bg-gray-200 text-gray-500':'bg-white hover:bg-green-50'} ${today?'ring-2 ring-primary-400 ring-inset':''}`}><div className="text-center text-xs font-semibold sm:text-sm">{day}</div><div className="mt-1 text-center text-[9px] sm:text-xs">{holiday?'Holiday':count?`${count} orders`:''}</div></button>);
  }

  const selectedHoliday=selectedDate?isHoliday(new Date(`${selectedDate}T00:00:00`)):false;
  const selectedRecurring=selectedDate?recurringWeekdays.includes(new Date(`${selectedDate}T00:00:00`).getDay()):false;

  return <div className="w-full min-w-0">
    <h3 className="mb-4 text-xl font-bold text-gray-800 sm:text-2xl">Orders &amp; Holiday Calendar</h3>
    <div className="mb-4 rounded-lg border bg-gray-50 p-3 text-sm text-gray-600">
      {holidayLoading?'Loading holiday configuration…':recurringLabel.length?`${recurringLabel.join(', ')} ${recurringLabel.length===1?'is':'are'} recurring holiday${recurringLabel.length===1?'':'s'}. Declared holidays are also shown on their specific dates.`:'No recurring weekly holidays configured. Declared holidays are shown on their specific dates.'}
    </div>
    {message&&<div className="mb-4 rounded-lg bg-green-50 p-3 text-sm text-green-700">{message}</div>}
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
      <div className="min-w-0 rounded-lg bg-white p-3 shadow-sm sm:p-5 xl:col-span-2">
        <div className="mb-4 flex items-center justify-between"><button type="button" onClick={()=>changeMonth(-1)} className="rounded-md bg-gray-200 px-3 py-2">←</button><h4 className="text-base font-semibold sm:text-xl">{getMonthName(currentDate.getMonth())} {currentDate.getFullYear()}</h4><button type="button" onClick={()=>changeMonth(1)} className="rounded-md bg-gray-200 px-3 py-2">→</button></div>
        <div className="grid grid-cols-7 text-center text-[10px] font-bold text-gray-500 sm:text-xs">{['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d=><div key={d}>{d}</div>)}</div>
        <div className="mt-1 grid grid-cols-7 overflow-hidden rounded border">{days}</div>
        {selectedDate&&<div className="mt-4 rounded-lg border bg-gray-50 p-3"><p className="font-semibold">Selected date: {selectedDate}</p><p className="mt-1 text-sm text-gray-600">{selectedHoliday?'Holiday':'Working day'}</p>{!selectedRecurring&&<button type="button" disabled={saving||holidayLoading} onClick={()=>void toggleHoliday(selectedDate)} className="mt-3 min-h-11 w-full rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50 sm:w-auto">{saving?'Saving…':declaredDates.includes(selectedDate)?'Remove Holiday':'Declare Holiday'}</button>}</div>}
      </div>
      <div className="min-w-0 rounded-lg bg-white p-3 shadow-sm sm:p-5"><h4 className="mb-4 text-lg font-bold text-gray-800">Orders for {selectedDate||'selected date'}</h4>{selectedOrders.length?<div className="max-h-[32rem] space-y-3 overflow-y-auto">{selectedOrders.map(order=>{const normal=normalTotal(order);const guest=guestTotal(order);const hasGuest=Object.keys(order.guestItems||{}).some(c=>order.guestItems?.[c]);return <div key={order.id} className="rounded-lg border p-3"><p className="font-bold text-gray-800">{employeeName(order.employeeId)}</p><p className="text-xs text-gray-500">SR: {order.employeeId} · Status: {order.status||'active'}</p>{Object.keys(order.items||{}).some(c=>order.items[c])&&<div className="mt-2 text-sm"><div className="font-semibold text-gray-700">EMPLOYEE ORDER</div><ul className="mt-1 space-y-1 text-gray-600">{Object.keys(order.items||{}).filter(c=>order.items[c]).map(c=>{const q=Math.max(1,Number(order.itemQuantities?.[c]||1));const u=Number(order.itemPrices?.[c]||0);return <li key={c}>{order.itemNames?.[c]||c} × {q} · ₹{(u*q).toFixed(2)} <span className="text-xs text-gray-400">(₹{u.toFixed(2)} × {q})</span></li>})}</ul><p className="mt-1 text-right font-semibold">Employee Total: ₹{normal.toFixed(2)}</p></div>}{hasGuest&&<div className="mt-3 border-t pt-2 text-sm"><div className="font-semibold text-gray-700">GUEST ORDER</div><p className="text-xs text-gray-500">Guests: {order.guestCount||0}</p><ul className="mt-1 space-y-1 text-gray-600">{Object.keys(order.guestItems||{}).filter(c=>order.guestItems?.[c]).map(c=>{const q=Math.max(1,Number(order.guestItemQuantities?.[c]||1));const u=Number(order.guestItemPrices?.[c]||0);return <li key={c}>{order.guestItemNames?.[c]||order.itemNames?.[c]||c} × {q} · ₹{(u*q).toFixed(2)} <span className="text-xs text-gray-400">(₹{u.toFixed(2)} × {q})</span></li>})}</ul><p className="mt-1 text-right font-semibold">Guest Total: ₹{guest.toFixed(2)}</p></div>}</div>})}</div>:<p className="text-sm text-gray-500">{selectedDate?'No orders for this date.':'Select a date to see orders.'}</p>}</div>
    </div>
  </div>;
};
export default AllOrdersCalendar;
