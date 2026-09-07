import { supabase } from '../supabase';

export interface RevenueTransaction { date:string; particulars:string; type:'Food Revenue'|'Guest Revenue'|'Admin Added'|'Additional Revenue'; amount:number }
export interface RevenueExpense { date:string; particulars:string; type:'Expense'; amount:number }
export interface MonthlyRevenueReport {
  canteen_name:string; start_date:string; end_date:string;
  food_revenue:number; guest_revenue:number; admin_added_revenue:number; additional_revenue:number;
  total_collection:number; total_expenses:number; net_revenue:number;
  transactions:RevenueTransaction[]; expenses:RevenueExpense[];
}

export async function loadMonthlyRevenueReport(month:number,year:number):Promise<MonthlyRevenueReport>{
  if(!supabase)throw new Error('Supabase is not configured.');
  const{data,error}=await supabase.rpc('get_monthly_revenue_report',{p_year:year,p_month:month});
  if(error)throw error;
  const raw:any=data||{};
  return {
    canteen_name:String(raw.canteen_name||'Go Canteen'),start_date:String(raw.start_date||`${year}-${String(month).padStart(2,'0')}-01`),end_date:String(raw.end_date||new Date(year,month,0).toISOString().slice(0,10)),
    food_revenue:Number(raw.food_revenue||0),guest_revenue:Number(raw.guest_revenue||0),admin_added_revenue:Number(raw.admin_added_revenue||0),additional_revenue:Number(raw.additional_revenue||0),
    total_collection:Number(raw.total_collection||0),total_expenses:Number(raw.total_expenses||0),net_revenue:Number(raw.net_revenue||0),
    transactions:Array.isArray(raw.transactions)?raw.transactions.map((x:any)=>({date:String(x.date),particulars:String(x.particulars||''),type:x.type,amount:Number(x.amount||0)})):[],
    expenses:Array.isArray(raw.expenses)?raw.expenses.map((x:any)=>({date:String(x.date),particulars:String(x.particulars||''),type:'Expense' as const,amount:Number(x.amount||0)})):[]
  };
}

export function formatReportDate(value:string){return new Date(`${value}T00:00:00`).toLocaleDateString('en-IN',{day:'2-digit',month:'2-digit',year:'numeric'}).replace(/\//g,'-')}
