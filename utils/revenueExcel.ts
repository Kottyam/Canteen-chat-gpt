import * as XLSX from 'xlsx';
import { Capacitor } from '@capacitor/core';
import { Filesystem,Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { MonthlyRevenueReport,formatReportDate } from '../services/revenueReport';

async function deliver(buffer:ArrayBuffer,filename:string){
  if(Capacitor.isNativePlatform()){
    const bytes=new Uint8Array(buffer);let binary='';for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));
    await Filesystem.writeFile({path:filename,data:btoa(binary),directory:Directory.Cache,recursive:true});const uri=await Filesystem.getUri({path:filename,directory:Directory.Cache});
    try{await Share.share({title:filename,text:'GoCanteen Revenue Report',url:uri.uri,dialogTitle:'View or send Excel report'});}finally{try{await Filesystem.deleteFile({path:filename,directory:Directory.Cache})}catch{}}return;
  }
  const blob=new Blob([buffer],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
}

export async function downloadRevenueExcel(report:MonthlyRevenueReport,month:number,year:number){
  const rows:any[][]=[];const push=(...v:any[])=>rows.push(v);const generatedAt=new Date().toLocaleString('en-IN');
  push(['GO CANTEEN']);push(['Canteen Management System']);push(['REVENUE REPORT']);push([]);push(['Canteen',report.canteen_name]);push(['Month',new Date(year,month-1,1).toLocaleString('en-IN',{month:'long',year:'numeric'})]);push(['Period',`${formatReportDate(report.start_date)} to ${formatReportDate(report.end_date)}`]);push(['Generated',generatedAt]);push([]);
  push(['Date','Particulars','Quantity','Type','Total Amount']);const txStart=rows.length+1;let lastDate='';report.transactions.forEach(t=>{const displayDate=t.date===lastDate?'':formatReportDate(t.date);lastDate=t.date;push(displayDate,t.particulars,t.quantity==null?null:t.quantity,t.type,t.amount)});const txEnd=rows.length;
  push([]);push(['FINANCIAL SUMMARY']);
  const contributionActive=Number(report.company_food_revenue||0)>0;
  if(contributionActive){push(['Gross Food Revenue',report.gross_food_revenue]);push(['Employee Portion',report.employee_food_revenue]);push(['Company Contribution',report.company_food_revenue]);}
  else push(['Food Revenue',report.food_revenue]);
  push(['Guest Revenue',report.guest_revenue]);push(['Admin Added Amount',report.admin_added_revenue]);push(['Additional Revenue',report.additional_revenue]);push(['Total Revenue',report.total_collection]);push(['Total Expenses',report.total_expenses]);push(['NET REVENUE',report.net_revenue]);
  const ws=XLSX.utils.aoa_to_sheet(rows);ws['!cols']=[{wch:15},{wch:38},{wch:12},{wch:24},{wch:20}];ws['!freeze']={xSplit:0,ySplit:9};ws['!autofilter']={ref:`A10:E${Math.max(10,txEnd)}`};
  for(let r=txStart;r<=txEnd;r++){if(ws[`E${r}`])ws[`E${r}`].z='₹#,##0.00';if(ws[`C${r}`]&&typeof ws[`C${r}`].v==='number')ws[`C${r}`].z='0';}
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Revenue Report');const out=XLSX.write(wb,{bookType:'xlsx',type:'array',cellStyles:true});await deliver(out,`GoCanteen-Revenue-${year}-${String(month).padStart(2,'0')}.xlsx`);
}
