import * as XLSX from 'xlsx';
import { Capacitor } from '@capacitor/core';
import { Filesystem,Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { MonthlyRevenueReport,formatReportDate } from '../services/revenueReport';

async function deliver(buffer:ArrayBuffer,filename:string){
  if(Capacitor.isNativePlatform()){
    const bytes=new Uint8Array(buffer);let binary='';for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));
    const data=btoa(binary);await Filesystem.writeFile({path:filename,data,directory:Directory.Cache,recursive:true});
    const uri=await Filesystem.getUri({path:filename,directory:Directory.Cache});
    try{await Share.share({title:filename,text:'GoCanteen Revenue Report',url:uri.uri,dialogTitle:'View or send Excel report'});}finally{try{await Filesystem.deleteFile({path:filename,directory:Directory.Cache})}catch{}}
    return;
  }
  const blob=new Blob([buffer],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
}

export async function downloadRevenueExcel(report:MonthlyRevenueReport,month:number,year:number){
  const rows:any[][]=[];const push=(...v:any[])=>rows.push(v);
  push(['GO CANTEEN']);push(['Canteen Management System']);push(['REVENUE REPORT']);push([]);
  push(['Canteen',report.canteen_name]);push(['Month',new Date(year,month-1,1).toLocaleString('en-IN',{month:'long',year:'numeric'})]);push(['Period',`${formatReportDate(report.start_date)} to ${formatReportDate(report.end_date)}`]);push([]);
  push(['Date','Particulars','Type','Amount']);
  report.transactions.forEach(t=>push(formatReportDate(t.date),t.particulars,t.type,t.amount));
  push([]);push(['EXPENSES']);push(['Date','Particulars','Type','Amount']);report.expenses.forEach(e=>push(formatReportDate(e.date),e.particulars,e.type,e.amount));
  push([]);push(['SUMMARY']);
  const summaryStart=rows.length;
  push(['Normal Food Revenue',report.food_revenue]);push(['Guest Revenue',report.guest_revenue]);push(['Admin Added Amount',report.admin_added_revenue]);push(['Additional Revenue',report.additional_revenue]);push(['Total Revenue',report.total_collection]);push(['Total Expenses',report.total_expenses]);push(['Net Revenue',report.net_revenue]);
  const ws=XLSX.utils.aoa_to_sheet(rows);ws['!cols']=[{wch:15},{wch:36},{wch:24},{wch:16}];ws['!freeze']={xSplit:0,ySplit:8};
  for(let r=7;r<7+report.transactions.length;r++)if(ws[`D${r+1}`])ws[`D${r+1}`].z='₹#,##0.00';
  const expenseHeader=9+report.transactions.length;for(let r=expenseHeader+1;r<expenseHeader+1+report.expenses.length;r++)if(ws[`D${r+1}`])ws[`D${r+1}`].z='₹#,##0.00';
  for(let r=summaryStart;r<rows.length;r++)if(ws[`B${r+1}`])ws[`B${r+1}`].z='₹#,##0.00';
  ws['!autofilter']={ref:`A8:D${8+report.transactions.length}`};
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Revenue Report');
  const out=XLSX.write(wb,{bookType:'xlsx',type:'array'});await deliver(out,`GoCanteen-Revenue-${year}-${String(month).padStart(2,'0')}.xlsx`);
}
