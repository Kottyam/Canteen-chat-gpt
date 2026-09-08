import { jsPDF } from 'jspdf';
import { Filesystem,Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { Capacitor } from '@capacitor/core';
import { MonthlyRevenueReport,RevenueTransaction,formatReportDate } from '../services/revenueReport';

const GREEN=[5,150,105] as const;
const W=297,M=12,CW=W-M*2,FOOT=202,HEAD=8,LINE=3.8,BODY_BOTTOM=195;
const BASE_WIDTHS=[30,90,35,55,63];
const WIDTH_TOTAL=BASE_WIDTHS.reduce((a,b)=>a+b,0);
const widths=BASE_WIDTHS.map(v=>CW*v/WIDTH_TOTAL);
const xs=widths.reduce<number[]>((acc,w,i)=>{acc.push(i===0?M:acc[i-1]+widths[i-1]);return acc},[]);
const money=(n:number)=>`₹${Number(n||0).toFixed(2)}`;

async function deliver(doc:jsPDF,filename:string){
  const blob=doc.output('blob');
  if(Capacitor.isNativePlatform()){
    const base64=await new Promise<string>((resolve,reject)=>{const r=new FileReader();r.onloadend=()=>resolve(String(r.result).split(',')[1]||'');r.onerror=reject;r.readAsDataURL(blob)});
    await Filesystem.writeFile({path:filename,data:base64,directory:Directory.Cache,recursive:true});
    const uri=await Filesystem.getUri({path:filename,directory:Directory.Cache});
    try{await Share.share({title:filename,text:'GoCanteen Revenue Report',url:uri.uri,dialogTitle:'View or send PDF'});}
    finally{try{await Filesystem.deleteFile({path:filename,directory:Directory.Cache})}catch{}}
    return;
  }
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
}

const split=(d:jsPDF,v:string,w:number)=>d.splitTextToSize(String(v??''),Math.max(8,w-4)) as string[];
const centerX=(i:number)=>xs[i]+widths[i]/2;

function header(d:jsPDF,r:MonthlyRevenueReport,m:number,y:number,generatedAt:string){
  d.setTextColor(...GREEN);d.setFont('helvetica','bold');d.setFontSize(20);d.text('GO CANTEEN',W/2,15,{align:'center'});
  d.setTextColor(35,35,35);d.setFontSize(10);d.text('Canteen Management System',W/2,22,{align:'center'});
  d.setFontSize(14);d.text('REVENUE REPORT',W/2,31,{align:'center'});
  d.setFont('helvetica','normal');d.setFontSize(9);d.text(`Canteen Name: ${r.canteen_name}`,M,43);
  d.text(`Month: ${new Date(y,m-1,1).toLocaleString('en-IN',{month:'long',year:'numeric'})}`,M,49);
  d.text(`Period: ${formatReportDate(r.start_date)} to ${formatReportDate(r.end_date)}`,M,55);
  d.setFontSize(8);d.text(`Generated: ${generatedAt}`,W-M,43,{align:'right'});
  return 64;
}

function tableHead(d:jsPDF,y:number){
  d.setFillColor(245,247,246);d.setDrawColor(145,145,145);d.setLineWidth(.25);d.rect(M,y,CW,HEAD,'FD');
  d.setFont('helvetica','bold');d.setFontSize(7.5);
  const heads=['Date','Particulars','Quantity','Type','Total Amount'];
  heads.forEach((h,i)=>{d.text(h,centerX(i),y+5.5,{align:'center'});if(i<heads.length-1)d.line(xs[i]+widths[i],y,xs[i]+widths[i],y+HEAD)});
  return y+HEAD;
}

function rowHeight(d:jsPDF,t:RevenueTransaction){
  const values=[t.particulars,t.quantity==null?'—':String(t.quantity),t.type,money(t.amount)];
  return Math.max(7.2,...values.map((v,i)=>split(d,v,widths[i+1]).length*LINE+2.8));
}

function drawRow(d:jsPDF,t:RevenueTransaction,y:number){
  const h=rowHeight(d,t),vals=[t.particulars,t.quantity==null?'—':String(t.quantity),t.type,money(t.amount)];
  for(let c=1;c<5;c++){
    d.rect(xs[c],y,widths[c],h);
    const ls=split(d,vals[c-1],widths[c]),bh=ls.length*LINE;
    ls.forEach((v,j)=>d.text(v,centerX(c),y+(h-bh)/2+3+j*LINE,{align:'center'}));
  }
  return h;
}

function drawDateCell(d:jsPDF,date:string,y:number,h:number){
  d.setDrawColor(145,145,145);d.rect(xs[0],y,widths[0],h);d.setFont('helvetica','normal');d.setFontSize(7.5);
  const dl=split(d,formatReportDate(date),widths[0]),db=dl.length*LINE;
  dl.forEach((v,i)=>d.text(v,centerX(0),y+(h-db)/2+3+i*LINE,{align:'center'}));
}

function drawTransactions(d:jsPDF,r:MonthlyRevenueReport,y:number,m:number,yr:number,generatedAt:string){
  const groups=new Map<string,RevenueTransaction[]>();
  r.transactions.forEach(t=>{if(!groups.has(t.date))groups.set(t.date,[]);groups.get(t.date)!.push(t)});
  for(const[date,items]of groups){
    let i=0;
    while(i<items.length){
      if(y+7>BODY_BOTTOM){d.addPage();y=header(d,r,m,yr,generatedAt);y=tableHead(d,y)}
      const start=i;let used=0;
      while(i<items.length){const h=rowHeight(d,items[i]);if(y+used+h>BODY_BOTTOM&&i>start)break;used+=h;i++;if(y+used>BODY_BOTTOM)break}
      const pageItems=items.slice(start,i);drawDateCell(d,date,y,used);let ry=y;
      d.setDrawColor(145,145,145);d.setLineWidth(.2);
      pageItems.forEach(t=>{const h=drawRow(d,t,ry);ry+=h});
      y=ry;
      if(i<items.length){d.addPage();y=header(d,r,m,yr,generatedAt);y=tableHead(d,y)}
    }
  }
  return y;
}

function summary(d:jsPDF,r:MonthlyRevenueReport,y:number,m:number,yr:number,generatedAt:string){
  const contributionActive=Number(r.company_food_revenue||0)>0;
  const rows:[string,number][]=[];
  if(contributionActive)rows.push(['Gross Food Revenue',r.gross_food_revenue],['Employee Portion',r.employee_food_revenue],['Company Contribution',r.company_food_revenue]);
  else rows.push(['Food Revenue',r.food_revenue]);
  rows.push(['Guest Revenue',r.guest_revenue],['Admin Added Amount',r.admin_added_revenue],['Additional Revenue',r.additional_revenue],['Total Revenue',r.total_collection],['Total Expenses',r.total_expenses],['NET REVENUE',r.net_revenue]);
  const rh=7,sh=7,need=sh+rows.length*rh+13;
  if(y+need>BODY_BOTTOM){d.addPage();y=header(d,r,m,yr,generatedAt)+7}
  d.setFont('helvetica','bold');d.setFontSize(11);d.text('FINANCIAL SUMMARY',M,y);y+=sh;
  const lw=CW-66,aw=66;d.setDrawColor(160,160,160);d.setLineWidth(.2);
  rows.forEach((row,i)=>{d.setFont('helvetica',i>=rows.length-3?'bold':'normal');d.rect(M,y,lw,rh);d.rect(M+lw,y,aw,rh);d.text(row[0],M+2,y+4.8);d.text(money(row[1]),W-M-3,y+4.8,{align:'right'});y+=rh});
  d.setFont('helvetica','normal');d.setFontSize(7);
  if(contributionActive)d.text('Company Contribution is a breakdown of Gross Food Revenue and is not added again as separate revenue.',M,y+5);
}

export async function downloadRevenuePdfA4(report:MonthlyRevenueReport,month:number,year:number){
  const d=new jsPDF({orientation:'landscape',unit:'mm',format:'a4'});const generatedAt=new Date().toLocaleString('en-IN');
  let y=header(d,report,month,year,generatedAt);y=tableHead(d,y);y=drawTransactions(d,report,y,month,year,generatedAt);summary(d,report,y+7,month,year,generatedAt);
  for(let p=1;p<=d.getNumberOfPages();p++){d.setPage(p);d.setFont('helvetica','normal');d.setFontSize(7);d.text(`Page ${p} of ${d.getNumberOfPages()}`,W-M,FOOT,{align:'right'})}
  await deliver(d,`GoCanteen-Revenue-${year}-${String(month).padStart(2,'0')}.pdf`);
}
