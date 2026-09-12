import { jsPDF } from 'jspdf';
import { Filesystem,Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { Capacitor } from '@capacitor/core';
import { MonthlyRevenueReport,RevenueTransaction,formatReportDate } from '../services/revenueReport';

const GREEN=[5,150,105] as const;
const PAGE_W=210,PAGE_H=297,M=10,PRINT_W=PAGE_W-M*2;
const HEADER_H=8,ROW_LINE=3.8,BODY_TOP=64,BODY_BOTTOM=276,FOOT_Y=288;
const COL_WIDTHS=[24,62,20,38,46] as const;
const COL_X=COL_WIDTHS.reduce<number[]>((acc,w,i)=>{acc.push(i===0?M:acc[i-1]+COL_WIDTHS[i-1]);return acc},[]);
const FONT='helvetica';
const BODY_SIZE=7.5;
const HEADER_SIZE=7.5;
const BORDER=[145,145,145] as const;
const moneyValue=(n:number)=>Number(n||0).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});

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

const split=(d:jsPDF,v:string,w:number)=>d.splitTextToSize(String(v??''),Math.max(8,w-5)) as string[];
const centerX=(i:number)=>COL_X[i]+COL_WIDTHS[i]/2;
const setBodyFont=(d:jsPDF,bold=false)=>{d.setFont(FONT,bold?'bold':'normal');d.setFontSize(BODY_SIZE);d.setTextColor(35,35,35)};

function header(d:jsPDF,r:MonthlyRevenueReport,m:number,y:number,generatedAt:string){
  d.setTextColor(...GREEN);d.setFont(FONT,'bold');d.setFontSize(20);d.text('GO CANTEEN',PAGE_W/2,15,{align:'center'});
  d.setTextColor(35,35,35);d.setFont(FONT,'normal');d.setFontSize(10);d.text('Canteen Management System',PAGE_W/2,22,{align:'center'});
  d.setFont(FONT,'bold');d.setFontSize(14);d.text('REVENUE REPORT',PAGE_W/2,31,{align:'center'});
  d.setFont(FONT,'normal');d.setFontSize(9);
  const canteenLines=split(d,`Canteen Name: ${r.canteen_name}`,105);
  canteenLines.forEach((line,i)=>d.text(line,M,43+i*3.8));
  d.text(`Month: ${new Date(y,m-1,1).toLocaleString('en-IN',{month:'long',year:'numeric'})}`,M,49+(canteenLines.length-1)*3.8);
  d.text(`Period: ${formatReportDate(r.start_date)} to ${formatReportDate(r.end_date)}`,M,55+(canteenLines.length-1)*3.8);
  d.setFontSize(8);const generatedLines=split(d,`Generated: ${generatedAt}`,65);generatedLines.forEach((line,i)=>d.text(line,PAGE_W-M,43+i*3.8,{align:'right'}));
  return BODY_TOP;
}

function tableHead(d:jsPDF,y:number){
  d.setFillColor(245,247,246);d.setDrawColor(...BORDER);d.setLineWidth(.25);d.rect(M,y,PRINT_W,HEADER_H,'FD');
  d.setFont(FONT,'bold');d.setFontSize(HEADER_SIZE);d.setTextColor(35,35,35);
  ['Date','Particulars','Quantity','Type','Total Amount'].forEach((h,i)=>{d.text(h,centerX(i),y+5.4,{align:'center'});if(i<4)d.line(COL_X[i]+COL_WIDTHS[i],y,COL_X[i]+COL_WIDTHS[i],y+HEADER_H)});
  return y+HEADER_H;
}

function rowHeight(d:jsPDF,t:RevenueTransaction){const particulars=split(d,t.particulars,COL_WIDTHS[1]);const type=split(d,t.type,COL_WIDTHS[3]);return Math.max(7.6,particulars.length*ROW_LINE+3,type.length*ROW_LINE+3,8.5)}
function drawCenteredCell(d:jsPDF,text:string,column:number,y:number,h:number){const lines=split(d,text,COL_WIDTHS[column]);const blockH=lines.length*ROW_LINE;const startY=y+(h-blockH)/2+2.9;lines.forEach((line,index)=>d.text(line,centerX(column),startY+index*ROW_LINE,{align:'center',baseline:'alphabetic'}))}
function drawMoneyCentered(d:jsPDF,amount:number,column:number,y:number,h:number){const text=`Rs ${moneyValue(amount)}`;setBodyFont(d,false);const center=centerX(column);d.text(text,center,y+(h-ROW_LINE)/2+2.9,{align:'center'})}
function drawRow(d:jsPDF,t:RevenueTransaction,y:number){const h=rowHeight(d,t);d.setDrawColor(...BORDER);d.setLineWidth(.2);for(let c=1;c<5;c++)d.rect(COL_X[c],y,COL_WIDTHS[c],h);setBodyFont(d,false);drawCenteredCell(d,t.particulars,1,y,h);drawCenteredCell(d,t.quantity==null?'—':String(t.quantity),2,y,h);drawCenteredCell(d,t.type,3,y,h);drawMoneyCentered(d,t.amount,4,y,h);return h}
function drawDateCell(d:jsPDF,date:string,y:number,h:number){d.setDrawColor(...BORDER);d.setLineWidth(.2);d.rect(COL_X[0],y,COL_WIDTHS[0],h);setBodyFont(d,false);drawCenteredCell(d,formatReportDate(date),0,y,h)}

function drawTransactions(d:jsPDF,r:MonthlyRevenueReport,y:number,m:number,yr:number,generatedAt:string){const groups=new Map<string,RevenueTransaction[]>();r.transactions.forEach(t=>{if(!groups.has(t.date))groups.set(t.date,[]);groups.get(t.date)!.push(t)});for(const[date,items]of groups){let i=0;while(i<items.length){if(y+8.5>BODY_BOTTOM){d.addPage();y=header(d,r,m,yr,generatedAt);y=tableHead(d,y)}const start=i;let used=0;while(i<items.length){const h=rowHeight(d,items[i]);if(i>start&&y+used+h>BODY_BOTTOM)break;used+=h;i++}const pageItems=items.slice(start,i);drawDateCell(d,date,y,used);let ry=y;pageItems.forEach(t=>{ry+=drawRow(d,t,ry)});y=ry;if(i<items.length){d.addPage();y=header(d,r,m,yr,generatedAt);y=tableHead(d,y)}}}return y}

function summary(d:jsPDF,r:MonthlyRevenueReport,y:number,m:number,yr:number,generatedAt:string){const contributionActive=Boolean(r.contribution_enabled);const rows:[string,number][]=[];if(contributionActive)rows.push(['Member Food Gross',r.gross_food_revenue],['Employee Payable',r.employee_food_revenue],['Company Contribution',r.company_food_revenue]);else rows.push(['Member Food Revenue',r.food_revenue]);rows.push(['Guest Food Revenue',r.guest_revenue],['Admin Added Amount',r.admin_added_revenue],['Additional Revenue',r.additional_revenue],['Total Revenue',r.total_collection],['Total Expenses',r.total_expenses],['NET REVENUE',r.net_revenue]);const titleH=7,rowH=7,need=titleH+rows.length*rowH+13;if(y+need>BODY_BOTTOM){d.addPage();y=header(d,r,m,yr,generatedAt)+7}d.setFont(FONT,'bold');d.setFontSize(11);d.setTextColor(35,35,35);d.text('FINANCIAL SUMMARY',M,y);y+=titleH;const labelW=PRINT_W-60,amountW=60;d.setDrawColor(160,160,160);d.setLineWidth(.2);rows.forEach((row,i)=>{const bold=i>=rows.length-3;setBodyFont(d,bold);d.rect(M,y,labelW,rowH);d.rect(M+labelW,y,amountW,rowH);d.text(row[0],M+labelW/2,y+4.8,{align:'center'});setBodyFont(d,false);d.text(`Rs ${moneyValue(row[1])}`,M+labelW+amountW/2,y+4.8,{align:'center'});y+=rowH});if(contributionActive){setBodyFont(d,false);d.setFontSize(7);const note=split(d,'Company Contribution is a breakdown of Gross Food Revenue and is not added again as separate revenue.',PRINT_W);note.forEach((line,i)=>d.text(line,M,y+5+i*3.2))}return y}

function employeeContributionTable(d:jsPDF,r:MonthlyRevenueReport,m:number,yr:number,generatedAt:string){if(!r.employee_contributions.length)return;d.addPage();let y=header(d,r,m,yr,generatedAt)+7;d.setFont(FONT,'bold');d.setFontSize(11);d.setTextColor(35,35,35);d.text('EMPLOYEE FOOD CONTRIBUTION',M,y);y+=8;const widths=[62,42,42,44];const labels=['Employee Name','Gross Eligible Food','Company Contribution','Employee Payable'];const xs=widths.reduce<number[]>((acc,w,i)=>{acc.push(i===0?M:acc[i-1]+widths[i-1]);return acc},[]);d.setFillColor(245,247,246);d.setDrawColor(...BORDER);d.setLineWidth(.25);d.rect(M,y,PRINT_W,8,'FD');d.setFont(FONT,'bold');d.setFontSize(7.2);labels.forEach((label,i)=>d.text(label,xs[i]+widths[i]/2,y+5.2,{align:'center'}));y+=8;r.employee_contributions.forEach(item=>{const h=8;d.setFont(FONT,'normal');d.setFontSize(7.2);d.setTextColor(35,35,35);d.setDrawColor(...BORDER);widths.forEach((w,i)=>d.rect(xs[i],y,w,h));d.text(item.employee_name,xs[0]+widths[0]/2,y+5.2,{align:'center'});d.text(`Rs ${moneyValue(item.gross_eligible_food)}`,xs[1]+widths[1]/2,y+5.2,{align:'center'});d.text(`Rs ${moneyValue(item.company_contribution)}`,xs[2]+widths[2]/2,y+5.2,{align:'center'});d.text(`Rs ${moneyValue(item.employee_payable)}`,xs[3]+widths[3]/2,y+5.2,{align:'center'});y+=h;if(y>BODY_BOTTOM&&item!==r.employee_contributions[r.employee_contributions.length-1]){d.addPage();y=header(d,r,m,yr,generatedAt)+7}})}

export async function downloadRevenuePdfA4(report:MonthlyRevenueReport,month:number,year:number){const d=new jsPDF({orientation:'portrait',unit:'mm',format:'a4'});const generatedAt=new Date().toLocaleString('en-IN');let y=header(d,report,month,year,generatedAt);y=tableHead(d,y);y=drawTransactions(d,report,y,month,year,generatedAt);summary(d,report,y+7,month,year,generatedAt);employeeContributionTable(d,report,month,year,generatedAt);for(let p=1;p<=d.getNumberOfPages();p++){d.setPage(p);d.setFont(FONT,'normal');d.setFontSize(7);d.setTextColor(80,80,80);d.text(`Page ${p} of ${d.getNumberOfPages()}`,PAGE_W-M,FOOT_Y,{align:'right'})}await deliver(d,`GoCanteen-Revenue-${year}-${String(month).padStart(2,'0')}.pdf`)}
