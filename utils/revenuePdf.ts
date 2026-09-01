import { jsPDF } from 'jspdf';
import { Filesystem,Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { Capacitor } from '@capacitor/core';
import { supabase } from '../supabase';

async function deliver(doc:jsPDF,filename:string){
 const blob=doc.output('blob');
 if(Capacitor.isNativePlatform()){
  const base64=await new Promise<string>((resolve,reject)=>{const r=new FileReader();r.onloadend=()=>resolve(String(r.result).split(',')[1]||'');r.onerror=reject;r.readAsDataURL(blob)});
  await Filesystem.writeFile({path:filename,data:base64,directory:Directory.Cache,recursive:true});
  const uri=await Filesystem.getUri({path:filename,directory:Directory.Cache});
  try{await Share.share({title:filename,text:'GoCanteen Revenue Report',url:uri.uri,dialogTitle:'View or send PDF'});}finally{try{await Filesystem.deleteFile({path:filename,directory:Directory.Cache})}catch{}}
  return;
 }
 const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
}

export async function downloadRevenuePdfLive(month:number,year:number){
 const doc=new jsPDF();const monthName=new Date(year,month,1).toLocaleString('en-IN',{month:'long'});
 const start=`${year}-${String(month+1).padStart(2,'0')}-01`;const lastDay=new Date(year,month+1,0).getDate();const end=`${year}-${String(month+1).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`;
 let collection=0,expenses=0;
 if(supabase){const{data,error}=await supabase.rpc('get_monthly_revenue',{p_year:year,p_month:month+1});if(error)throw error;const row=data?.[0];collection=Number(row?.total_collection||0);expenses=Number(row?.total_expenses||0)}
 const revenue=collection-expenses;doc.setFontSize(18);doc.text('GoCanteen - Revenue Report',14,18);doc.setFontSize(11);doc.text(`${monthName} ${year}`,14,28);doc.text(`Period: ${start} to ${end}`,14,36);doc.setFontSize(13);doc.text(`Total Collection: Rs.${collection.toFixed(2)}`,14,52);doc.text(`Total Expenses: Rs.${expenses.toFixed(2)}`,14,62);doc.setFont('helvetica','bold');doc.text(`Net Revenue: Rs.${revenue.toFixed(2)}`,14,74);doc.setFont('helvetica','normal');doc.setFontSize(9);doc.text('Net Revenue = Total Collection - Total Expenses',14,84);await deliver(doc,`GoCanteen-Revenue-${year}-${String(month+1).padStart(2,'0')}.pdf`);
}
