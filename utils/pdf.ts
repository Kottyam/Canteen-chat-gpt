import { jsPDF } from 'jspdf';
import { Order, Prices, User } from '../types';

export const itemNames: Record<keyof Order['items'], string> = { morningTea:'Morning Tea', lunchMeals:'Meals', lunchEgg:'Egg', lunchFishMeat:'Fish/Meat', eveningTea:'Evening Tea' };
export function orderTotal(order: Order, prices: Prices) { return (Object.keys(order.items) as (keyof Order['items'])[]).reduce((s,k)=>s+(order.items[k]?prices[k]:0),0); }
export function orderText(order: Order) { return (Object.keys(order.items) as (keyof Order['items'])[]).filter(k=>order.items[k]).map(k=>itemNames[k]).join(', ') || 'No items'; }
export function downloadDailyPdf(date:string, users:User[], orders:Order[], prices:Prices) {
 const doc=new jsPDF(); doc.setFontSize(18); doc.text('GoCanteen - Daily Order Report',14,18); doc.setFontSize(10); doc.text(`Date: ${date}`,14,26);
 let y=36; const day=orders.filter(o=>o.date===date); const counts={morningTea:0,lunchMeals:0,lunchEgg:0,lunchFishMeat:0,eveningTea:0}; let total=0;
 day.forEach(o=>{(Object.keys(counts) as (keyof typeof counts)[]).forEach(k=>{if(o.items[k])counts[k]++});total+=orderTotal(o,prices)});
 doc.text(`Employees/orders: ${day.length}`,14,y); y+=7; doc.text(`Tea: ${counts.morningTea+counts.eveningTea}  Meals: ${counts.lunchMeals}  Egg: ${counts.lunchEgg}  Fish/Meat: ${counts.lunchFishMeat}`,14,y); y+=7; doc.text(`Total amount: Rs.${total.toFixed(2)}`,14,y); y+=10;
 day.forEach((o,i)=>{if(y>275){doc.addPage();y=18} const u=users.find(x=>x.id===o.employeeId); doc.text(`${i+1}. ${u?.name||o.employeeId} | SR: ${o.employeeId} | ${orderText(o)} | Rs.${orderTotal(o,prices).toFixed(2)}`,14,y); y+=7});
 doc.save(`GoCanteen-Daily-${date}.pdf`);
}
export function downloadMonthlyPdf(month:number,year:number,users:User[],orders:Order[],prices:Prices) {
 const doc=new jsPDF(); const monthName=new Date(year,month,1).toLocaleString('en-IN',{month:'long'}); doc.setFontSize(18); doc.text('GoCanteen - Monthly Employee Report',14,18); doc.setFontSize(10); doc.text(`${monthName} ${year}`,14,26); let y=36; let grand=0;
 users.filter(u=>u.role==='employee').forEach((u,i)=>{const mine=orders.filter(o=>o.employeeId===u.id && new Date(o.date+'T00:00:00').getMonth()===month && new Date(o.date+'T00:00:00').getFullYear()===year); const total=mine.reduce((s,o)=>s+orderTotal(o,prices),0); grand+=total; if(y>270){doc.addPage();y=18} doc.text(`${i+1}. ${u.name} | SR: ${u.id} | Mobile: ${u.mobile||'-'} | Orders: ${mine.length} | Food amount: Rs.${total.toFixed(2)}`,14,y); y+=7; });
 if(y>270){doc.addPage();y=18} doc.setFontSize(12); doc.text(`Monthly total: Rs.${grand.toFixed(2)}`,14,y+6); doc.save(`GoCanteen-Monthly-${year}-${String(month+1).padStart(2,'0')}.pdf`);
}
