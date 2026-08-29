import { jsPDF } from 'jspdf';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { Capacitor } from '@capacitor/core';
import { Order, Prices, User } from '../types';

const fallbackNames: Record<string,string>={morningTea:'Morning Tea',lunchMeals:'Meals',lunchEgg:'Egg',lunchFishMeat:'Fish/Meat',eveningTea:'Evening Tea'};
export function orderTotal(order:Order,prices:Prices){return Object.keys(order.items).reduce((s,k)=>order.items[k]?s+Number(order.itemPrices?.[k]??(k in prices?prices[k as keyof Prices]:0)):s,0)}
export function orderText(order:Order){return Object.keys(order.items).filter(k=>order.items[k]).map(k=>order.itemNames?.[k]||fallbackNames[k]||k).join(', ')||'No items'}
function wrap(doc:jsPDF,text:string,x:number,y:number,w:number){const lines=doc.splitTextToSize(text,w) as string[];doc.text(lines,x,y);return y+lines.length*5}
function page(doc:jsPDF,y:number,needed=10){if(y+needed>282){doc.addPage();return 18}return y}

async function deliverPdf(doc:jsPDF,filename:string){
  const blob=doc.output('blob');
  // Native Android path: write the PDF to the app cache only, then open the
  // system share sheet. It is not uploaded to Supabase or kept permanently.
  if(Capacitor.isNativePlatform()){
    const base64=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onloadend=()=>resolve(String(reader.result).split(',')[1]||'');reader.onerror=reject;reader.readAsDataURL(blob)});
    const saved=await Filesystem.writeFile({path:filename,data:base64,directory:Directory.Cache,recursive:true});
    const uri=await Filesystem.getUri({path:filename,directory:Directory.Cache});
    try{await Share.share({title:filename,text:'GoCanteen PDF report',url:uri.uri,dialogTitle:'Open or save PDF'});}finally{try{await Filesystem.deleteFile({path:filename,directory:Directory.Cache})}catch{}}
    return;
  }
  const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
}

export async function downloadDailyPdf(date:string,users:User[],orders:Order[],prices:Prices){
 const doc=new jsPDF();const day=orders.filter(o=>o.date===date);const counts:Record<string,number>={};let total=0;
 day.forEach(o=>{Object.keys(o.items).forEach(k=>{if(o.items[k])counts[k]=(counts[k]||0)+1});total+=orderTotal(o,prices)});
 doc.setFontSize(18);doc.text('GoCanteen - Daily Order Report',14,18);doc.setFontSize(10);doc.text(`Date: ${date}`,14,26);let y=36;doc.setFontSize(11);doc.text(`Employees / Orders: ${day.length}`,14,y);y+=7;y=wrap(doc,Object.keys(counts).map(k=>`${fallbackNames[k]||k}: ${counts[k]}`).join('   ')||'No items',14,y,182);doc.setFontSize(12);doc.text(`Total Amount: Rs.${total.toFixed(2)}`,14,y);y+=10;doc.setFontSize(10);
 day.forEach((o,i)=>{y=page(doc,y,22);const u=users.find(x=>x.id===o.employeeId);doc.setFont('helvetica','bold');y=wrap(doc,`${i+1}. ${u?.name||o.employeeId} | SR: ${o.employeeId}`,14,y,182);doc.setFont('helvetica','normal');y=wrap(doc,`Items: ${orderText(o)}`,18,y+1,178);doc.text(`Amount: Rs.${orderTotal(o,prices).toFixed(2)}`,18,y+1);y+=8});
 await deliverPdf(doc,`GoCanteen-Daily-${date}.pdf`);
}

export async function downloadMonthlyPdf(month:number,year:number,users:User[],orders:Order[],prices:Prices){
 const doc=new jsPDF();const monthName=new Date(year,month,1).toLocaleString('en-IN',{month:'long'});const employees=users.filter(u=>u.role==='employee');let y=36;let grand=0;
 doc.setFontSize(18);doc.text('GoCanteen - Monthly Employee Report',14,18);doc.setFontSize(10);doc.text(`${monthName} ${year}`,14,26);
 employees.forEach((u,i)=>{const mine=orders.filter(o=>o.employeeId===u.id&&(()=>{const d=new Date(`${o.date}T00:00:00`);return d.getMonth()===month&&d.getFullYear()===year})());const total=mine.reduce((s,o)=>s+orderTotal(o,prices),0);grand+=total;y=page(doc,y,25);doc.setFont('helvetica','bold');y=wrap(doc,`${i+1}. ${u.name||'-'}`,14,y,182);doc.setFont('helvetica','normal');y=wrap(doc,`SR Number: ${u.id}   Mobile: ${u.mobile||'-'}`,14,y+1,182);doc.text(`Orders: ${mine.length}   Food Amount: Rs.${total.toFixed(2)}`,14,y+1);y+=9});
 y=page(doc,y,20);doc.setFontSize(13);doc.setFont('helvetica','bold');doc.text(`Monthly Total: Rs.${grand.toFixed(2)}`,14,y+5);await deliverPdf(doc,`GoCanteen-Monthly-${year}-${String(month+1).padStart(2,'0')}.pdf`);
}
