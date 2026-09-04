import { supabase, supabaseEnabled } from '../supabase';
import { notifyEmployee } from './notifications';

export interface MonthlyBill {
  id:string; employee_id:string; bill_month:number; bill_year:number;
  billing_start_date?:string|null; billing_end_date?:string|null;
  days_ordered:number; food_total:number; guest_food_total:number;
  admin_added_total:number; total:number; published:boolean;
  published_at?:string|null; employee_code?:string;
  upi_name?:string|null; upi_id?:string|null; upi_number?:string|null;
}

export interface BillPublishState {
  employee_id:string; bill_id:string|null; current_total:number;
  requested_total:number; new_amount:number; last_covered_at:string|null;
  last_covered_through:string|null; can_publish:boolean;
  publish_message:string|null;
}

const mapBill=(row:any):MonthlyBill=>({
  ...row,
  employee_code:row.employee_code||row.profiles?.employee_code||row.profiles?.sr_number,
  billing_start_date:row.billing_start_date||null,
  billing_end_date:row.billing_end_date||null,
  days_ordered:Number(row.days_ordered||0),
  food_total:Number(row.food_total||0),
  guest_food_total:Number(row.guest_food_total||0),
  admin_added_total:Number(row.admin_added_total||0),
  total:Number(row.total||0),
  upi_name:row.upi_name||null,upi_id:row.upi_id||null,upi_number:row.upi_number||null,
});

export async function loadPublishedBills():Promise<MonthlyBill[]>{
  if(!supabaseEnabled||!supabase)return[];
  const{data:{user}}=await supabase.auth.getUser(); if(!user)return[];
  const{data,error}=await supabase.from('monthly_bills').select('*').eq('employee_id',user.id).eq('published',true).order('bill_year',{ascending:false}).order('bill_month',{ascending:false});
  if(error)throw error; return(data||[]).map(mapBill);
}

export async function loadAdminBills(month:number,year:number){
  if(!supabaseEnabled||!supabase)return[] as MonthlyBill[];
  const{data,error}=await supabase.from('monthly_bills').select('*, profiles!monthly_bills_employee_id_fkey(employee_code,sr_number,full_name)').eq('bill_month',month).eq('bill_year',year);
  if(error)throw error; return(data||[]).map(mapBill);
}

export async function loadAdminBillPublishStates(month:number,year:number):Promise<Record<string,BillPublishState>>{
  if(!supabaseEnabled||!supabase)return{};
  const{data,error}=await supabase.rpc('get_admin_bill_publish_states',{p_month:month,p_year:year});
  if(error)throw error;
  return Object.fromEntries((data||[]).map((row:any)=>[row.employee_id,{
    employee_id:row.employee_id,bill_id:row.bill_id||null,current_total:Number(row.current_total||0),
    requested_total:Number(row.requested_total||0),new_amount:Number(row.new_amount||0),
    last_covered_at:row.last_covered_at||null,last_covered_through:row.last_covered_through||null,
    can_publish:Boolean(row.can_publish),publish_message:row.publish_message||null,
  }]));
}

async function employeeProfile(employeeCode:string){
  if(!supabaseEnabled||!supabase)return null;
  const{data,error}=await supabase.from('profiles').select('id,employee_code,sr_number,full_name').or(`employee_code.eq.${employeeCode},sr_number.eq.${employeeCode}`).maybeSingle();
  if(error)throw error; return data;
}

export async function loadPaymentSettings(){
  if(!supabaseEnabled||!supabase)return{upi_name:'',upi_id:'',upi_number:''};
  const{data,error}=await supabase.from('payment_settings').select('upi_name,upi_id,upi_number').maybeSingle();
  if(error)throw error; return{upi_name:data?.upi_name||'',upi_id:data?.upi_id||'',upi_number:data?.upi_number||''};
}

export async function savePaymentSettings(upi_name:string,upi_id:string,upi_number=''){
  if(!supabaseEnabled||!supabase)throw new Error('Supabase is not enabled.');
  const{data,error}=await supabase.from('payment_settings').upsert({upi_name:upi_name.trim(),upi_id:upi_id.trim(),upi_number:upi_number.trim()||null,updated_at:new Date().toISOString()},{onConflict:'canteen_id'}).select('upi_name,upi_id,upi_number').single();
  if(error)throw error; return data;
}

export async function publishEmployeeBill(employeeCode:string,month:number,year:number,foodTotal:number,adminAddedTotal:number,guestFoodTotal=0,daysOrdered=0,billingStartDate?:string,billingEndDate?:string){
  if(!supabaseEnabled||!supabase)throw new Error('Supabase is not enabled.');
  const profile=await employeeProfile(employeeCode); if(!profile)throw new Error('Employee profile not found.');
  const{data,error}=await supabase.rpc('publish_employee_bill',{
    p_employee_id:profile.id,p_month:month,p_year:year,
    p_food_total:Number(foodTotal)||0,p_admin_added_total:Number(adminAddedTotal)||0,
    p_guest_food_total:Number(guestFoodTotal)||0,p_days_ordered:Math.max(0,Number(daysOrdered)||0),
    p_billing_start_date:billingStartDate||null,p_billing_end_date:billingEndDate||null,
  });
  if(error)throw error;
  const bill=mapBill(data);
  await notifyEmployee(profile.id,`${new Date(year,month-1,1).toLocaleString('en',{month:'long'})} ${year} bill is now available.`,`Your monthly bill is ₹${bill.total.toFixed(2)}. Tap Bills to view it.`,'monthly_bill_published',{month,year,bill_id:bill.id,billing_start_date:bill.billing_start_date,billing_end_date:bill.billing_end_date});
  return bill;
}
