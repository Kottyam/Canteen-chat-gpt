import type { Order } from '../types';
import { supabase, supabaseEnabled } from '../supabase';

export interface AIQuantityItemRow{
  name:string;memberQuantity:number;guestQuantity:number;totalQuantity:number;
  orders:number;avgPerOrder:number;orderingDays:number;avgPerOrderingDay:number;
  currentQuantity:number;previousQuantity:number;change:number;changePercent:number|null;
}
export interface AIQuantityWeekdayRow{
  day:string;memberQuantity:number;guestQuantity:number;totalQuantity:number;orders:number;orderingDays:number;
}
export interface AIQuantityBehaviour{
  currentMonth:string;previousMonth:string;historicalFrom:string;historicalTo:string;
  totalMemberQuantity:number;totalGuestQuantity:number;totalQuantity:number;
  items:AIQuantityItemRow[];weekdays:AIQuantityWeekdayRow[];
}

const monthKey=(d:string)=>d.slice(0,7);
const safeNumber=(v:unknown)=>{const n=Number(v);return Number.isFinite(n)&&n>0?n:0};
const aggregate=(order:Order)=>{
  const member=new Map<string,number>(),guest=new Map<string,number>();
  Object.keys(order.items||{}).forEach(code=>{
    if(!order.items?.[code])return;
    const q=safeNumber(order.itemQuantities?.[code]);if(!q)return;
    const name=(order.itemNames?.[code]||code).trim();if(name)member.set(name,(member.get(name)||0)+q);
  });
  Object.keys(order.guestItems||{}).forEach(code=>{
    if(!order.guestItems?.[code])return;
    const q=safeNumber(order.guestItemQuantities?.[code]);if(!q)return;
    const name=(order.guestItemNames?.[code]||order.itemNames?.[code]||code).trim();if(name)guest.set(name,(guest.get(name)||0)+q);
  });
  return {member,guest};
};

export async function loadAIQuantityBehaviour(orders:Order[],now=new Date()):Promise<AIQuantityBehaviour>{
  const currentMonth=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  const prev=new Date(now.getFullYear(),now.getMonth()-1,1);
  const previousMonth=`${prev.getFullYear()}-${String(prev.getMonth()+1).padStart(2,'0')}`;
  const start=new Date(now.getFullYear(),now.getMonth()-5,1);
  const historicalFrom=`${start.getFullYear()}-${String(start.getMonth()+1).padStart(2,'0')}-01`;
  const endMonth=currentMonth;
  let sourceOrders=orders;
  if(supabaseEnabled&&supabase){
    const {data,error}=await supabase.from('orders').select('id,employee_id,ordered_for,status,order_source,order_items(id,item_code,item_name,quantity,item_source)').gte('ordered_for',historicalFrom).lte('ordered_for',`${endMonth}-31`);
    if(error) throw error;
    sourceOrders=(data||[]).map((o:any)=>({
      id:o.id,employeeId:o.employee_id,memberIdentityId:o.employee_id,date:String(o.ordered_for),status:o.status==='cancelled'?'cancelled':'active',
      orderSource:o.order_source==='admin'?'admin':'employee',
      items:Object.fromEntries((o.order_items||[]).filter((i:any)=>i.item_source!=='guest'&&safeNumber(i.quantity)>0).map((i:any)=>[i.item_code,true])),
      itemQuantities:Object.fromEntries((o.order_items||[]).filter((i:any)=>i.item_source!=='guest'&&safeNumber(i.quantity)>0).map((i:any)=>[i.item_code,safeNumber(i.quantity)])),
      itemNames:Object.fromEntries((o.order_items||[]).filter((i:any)=>i.item_source!=='guest'&&safeNumber(i.quantity)>0).map((i:any)=>[i.item_code,i.item_name||i.item_code])),
      guestItems:Object.fromEntries((o.order_items||[]).filter((i:any)=>i.item_source==='guest'&&safeNumber(i.quantity)>0).map((i:any)=>[i.item_code,true])),
      guestItemQuantities:Object.fromEntries((o.order_items||[]).filter((i:any)=>i.item_source==='guest'&&safeNumber(i.quantity)>0).map((i:any)=>[i.item_code,safeNumber(i.quantity)])),
      guestItemNames:Object.fromEntries((o.order_items||[]).filter((i:any)=>i.item_source==='guest'&&safeNumber(i.quantity)>0).map((i:any)=>[i.item_code,i.item_name||i.item_code]))
    })) as Order[];
  }
  const relevant=sourceOrders.filter(o=>o.status!=='cancelled'&&o.date>=historicalFrom&&monthKey(o.date)<=endMonth);
  let totalMemberQuantity=0,totalGuestQuantity=0;
  const items=new Map<string,{member:number;guest:number;orders:number;days:Set<string>;current:number;previous:number}>();
  const weekdayMap=new Map<string,{member:number;guest:number;orders:number;days:Set<string>}>();
  const weekdays=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  for(const order of relevant){
    const {member,guest}=aggregate(order);
    const names=new Set([...member.keys(),...guest.keys()]);
    const month=monthKey(order.date);
    const weekday=weekdays[new Date(`${order.date}T00:00:00`).getDay()];
    const wd=weekdayMap.get(weekday)||{member:0,guest:0,orders:0,days:new Set<string>()};
    if(member.size||guest.size){wd.orders++;wd.days.add(order.date);}
    for(const [name,q] of member){totalMemberQuantity+=q;const r=items.get(name)||{member:0,guest:0,orders:0,days:new Set<string>(),current:0,previous:0};r.member+=q;if(month===currentMonth)r.current+=q;if(month===previousMonth)r.previous+=q;items.set(name,r);wd.member+=q;}
    for(const [name,q] of guest){totalGuestQuantity+=q;const r=items.get(name)||{member:0,guest:0,orders:0,days:new Set<string>(),current:0,previous:0};r.guest+=q;if(month===currentMonth)r.current+=q;if(month===previousMonth)r.previous+=q;items.set(name,r);wd.guest+=q;}
    for(const name of names){const r=items.get(name)!;r.orders++;r.days.add(order.date);}
    if(member.size||guest.size)weekdayMap.set(weekday,wd);
  }
  const rows=[...items.entries()].map(([name,r])=>{const total=r.member+r.guest;const change=r.current-r.previous;return{name,memberQuantity:r.member,guestQuantity:r.guest,totalQuantity:total,orders:r.orders,avgPerOrder:r.orders?total/r.orders:0,orderingDays:r.days.size,avgPerOrderingDay:r.days.size?total/r.days.size:0,currentQuantity:r.current,previousQuantity:r.previous,change,changePercent:r.previous===0?null:change/Math.abs(r.previous)*100}}).sort((a,b)=>b.totalQuantity-a.totalQuantity);
  const weekdayRows=weekdays.map(day=>{const r=weekdayMap.get(day)||{member:0,guest:0,orders:0,days:new Set<string>()};return{day,memberQuantity:r.member,guestQuantity:r.guest,totalQuantity:r.member+r.guest,orders:r.orders,orderingDays:r.days.size}});
  return{currentMonth,previousMonth,historicalFrom,historicalTo:endMonth,totalMemberQuantity,totalGuestQuantity,totalQuantity:totalMemberQuantity+totalGuestQuantity,items:rows,weekdays:weekdayRows};
}
