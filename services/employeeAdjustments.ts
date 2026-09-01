import { supabase, supabaseEnabled } from '../supabase';

export interface EmployeeAdjustment { id:string; employee_id:string; adjustment_date:string; amount:number; description:string; created_at?:string; }

export async function saveEmployeeAdjustment(employeeCode:string,date:string,amount:number,description='') {
  if(!supabaseEnabled||!supabase) return;
  const { data:profile,error:pe }=await supabase.from('profiles').select('id').or(`employee_code.eq.${employeeCode},sr_number.eq.${employeeCode}`).maybeSingle();
  if(pe) throw pe;
  if(!profile) throw new Error('Employee profile not found.');
  const { error }=await supabase.from('employee_adjustments').insert({employee_id:profile.id,adjustment_date:date,amount:Number(amount),description:description.trim()});
  if(error) throw error;
}

export async function loadEmployeeAdjustments(employeeCode:string) {
  if(!supabaseEnabled||!supabase) return [] as EmployeeAdjustment[];
  const { data:profile,error:pe }=await supabase.from('profiles').select('id').or(`employee_code.eq.${employeeCode},sr_number.eq.${employeeCode}`).maybeSingle();
  if(pe) throw pe;
  if(!profile) return [] as EmployeeAdjustment[];
  const { data,error }=await supabase.from('employee_adjustments').select('id,employee_id,adjustment_date,amount,description,created_at').eq('employee_id',profile.id).order('adjustment_date',{ascending:false}).order('created_at',{ascending:false});
  if(error) throw error;
  return (data||[]).map((x:any)=>({...x,amount:Number(x.amount)})) as EmployeeAdjustment[];
}

export async function deleteEmployeeAdjustment(id:string) {
  if(!supabaseEnabled||!supabase) return;
  const { error }=await supabase.from('employee_adjustments').delete().eq('id',id);
  if(error) throw error;
}

export async function loadEmployeeAdjustmentTotal(employeeCode:string,dateStart:string,dateEnd:string) {
  if(!supabaseEnabled||!supabase) return 0;
  const { data:profile,error:pe }=await supabase.from('profiles').select('id').or(`employee_code.eq.${employeeCode},sr_number.eq.${employeeCode}`).maybeSingle();
  if(pe) throw pe;
  if(!profile) return 0;
  const { data,error }=await supabase.from('employee_adjustments').select('amount').eq('employee_id',profile.id).gte('adjustment_date',dateStart).lte('adjustment_date',dateEnd);
  if(error) throw error;
  return (data||[]).reduce((s:number,x:any)=>s+Number(x.amount||0),0);
}
