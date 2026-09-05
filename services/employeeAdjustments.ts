import { supabase, supabaseEnabled } from '../supabase';

export interface EmployeeAdjustment { id:string; employee_id:string; adjustment_date:string; amount:number; description:string; created_at?:string; }
export interface EmployeeAdjustmentForReport extends EmployeeAdjustment { employeeCode:string; }

async function employeeProfile(employeeCode:string){
  if(!supabaseEnabled||!supabase) return null;
  const { data,error }=await supabase.from('profiles').select('id').or(`employee_code.eq.${employeeCode},sr_number.eq.${employeeCode}`).maybeSingle();
  if(error) throw error;
  return data;
}

export async function saveEmployeeAdjustment(employeeCode:string,date:string,amount:number,description='') {
  const profile=await employeeProfile(employeeCode); if(!profile) throw new Error('Member profile not found.');
  const { error }=await supabase!.from('employee_adjustments').insert({employee_id:profile.id,adjustment_date:date,amount:Number(amount),description:description.trim()});
  if(error) throw error;
}

export async function updateEmployeeAdjustment(id:string,date:string,amount:number,description='') {
  if(!supabaseEnabled||!supabase) return;
  const { error }=await supabase.from('employee_adjustments').update({adjustment_date:date,amount:Number(amount),description:description.trim()}).eq('id',id);
  if(error) throw error;
}

export async function loadEmployeeAdjustments(employeeCode:string) {
  const profile=await employeeProfile(employeeCode); if(!profile) return [] as EmployeeAdjustment[];
  const { data,error }=await supabase!.from('employee_adjustments').select('id,employee_id,adjustment_date,amount,description,created_at').eq('employee_id',profile.id).order('adjustment_date',{ascending:false}).order('created_at',{ascending:false});
  if(error) throw error;
  return (data||[]).map((x:any)=>({...x,amount:Number(x.amount)})) as EmployeeAdjustment[];
}

export async function deleteEmployeeAdjustment(id:string) {
  if(!supabaseEnabled||!supabase) return;
  const { error }=await supabase.from('employee_adjustments').delete().eq('id',id);
  if(error) throw error;
}

export async function loadEmployeeAdjustmentTotal(employeeCode:string,dateStart:string,dateEnd:string) {
  const profile=await employeeProfile(employeeCode); if(!profile) return 0;
  const { data,error }=await supabase!.from('employee_adjustments').select('amount').eq('employee_id',profile.id).gte('adjustment_date',dateStart).lte('adjustment_date',dateEnd);
  if(error) throw error;
  return (data||[]).reduce((s:number,x:any)=>s+Number(x.amount||0),0);
}

export async function loadEmployeeAdjustmentsForUsers(employeeCodes:string[],dateStart:string,dateEnd:string) {
  const unique=[...new Set(employeeCodes.filter(Boolean))];
  if(!unique.length) return [] as EmployeeAdjustmentForReport[];
  const groups=await Promise.all(unique.map(async employeeCode=>{
    const rows=await loadEmployeeAdjustments(employeeCode);
    return rows.filter(r=>r.adjustment_date>=dateStart&&r.adjustment_date<=dateEnd).map(r=>({...r,employeeCode}));
  }));
  return groups.flat();
}
