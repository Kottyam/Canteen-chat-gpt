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
  const rows:any[][]=[];const push=(...v:any[])=>rows.push(v);
  push(['GO CANTEEN']);push(['Canteen Management System']);push(['REVENUE REPORT']);push([]);push(['Canteen',report.canteen_name]);push(['Month',new Date(year,month-1,1).toLocaleString('en-IN',{month:'long',year:'numeric'})]);push(['Period',`${formatReportDate(report.start_date)} to ${formatReportDate(report.end_date)}`]);push([]);
  push(['Date','Particulars','Type','Amount']);const txStart=rows.length+1;report.transactions.forEach(t=>push(formatReportDate(t.date),t.particulars,t.type,t.amount));const txEnd=rows.length;
  push([]);push(['EXPENSES']);push(['Date','Particulars','Type','Amount']);const expStart=rows.length+1;report.expenses.forEach(e=>push(formatReportDate(e.date),e.particulars,e.type,e.amount));const expEnd=rows.length;
  push([]);push(['SUMMARY']);const summaryHeaderRow=rows.length;push(['Normal Food Revenue',null]);push(['Guest Revenue',null]);push(['Admin Added Amount',null]);push(['Additional Revenue',null]);push(['Total Revenue',null]);push(['Total Expenses',null]);push(['Net Revenue',null]);
  const ws=XLSX.utils.aoa_to_sheet(rows);ws['!cols']=[{wch:15},{wch:38},{wch:24},{wch:18}];ws['!freeze']={xSplit:0,ySplit:8};
  const setFormula=(row:number,formula:string)=>{ws[`B${row}`]={t:'n',f:formula};ws[`B${row}`].z='₹#,##0.00'};
  setFormula(summaryHeaderRow+2,`SUMIF(C${txStart}:C${txEnd},"Food Revenue",D${txStart}:D${txEnd})`);
  setFormula(summaryHeaderRow+3,`SUMIF(C${txStart}:C${txEnd},"Guest Revenue",D${txStart}:D${txEnd})`);
  setFormula(summaryHeaderRow+4,`SUMIF(C${txStart}:C${txEnd},"Admin Added",D${txStart}:D${txEnd})`);
  setFormula(summaryHeaderRow+5,`SUMIF(C${txStart}:C${txEnd},"Additional Revenue",D${txStart}:D${txEnd})`);
  setFormula(summaryHeaderRow+6,`SUM(B${summaryHeaderRow+2}:B${summaryHeaderRow+5})`);
  if(expEnd>=expStart)setFormula(summaryHeaderRow+7,`SUM(D${expStart}:D${expEnd})`);else setFormula(summaryHeaderRow+7,'0');
  setFormula(summaryHeaderRow+8,`B${summaryHeaderRow+6}-B${summaryHeaderRow+7}`);
  for(let r=txStart;r<=txEnd;r++)if(ws[`D${r}`])ws[`D${r}`].z='₹#,##0.00';for(let r=expStart;r<=expEnd;r++)if(ws[`D${r}`])ws[`D${r}`].z='₹#,##0.00';
  ws['!autofilter']={ref:`A9:D${Math.max(9,txEnd)}`};const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Revenue Report');
  const out=XLSX.write(wb,{bookType:'xlsx',type:'array',cellStyles:true});await deliver(out,`GoCanteen-Revenue-${year}-${String(month).padStart(2,'0')}.xlsx`);
}
