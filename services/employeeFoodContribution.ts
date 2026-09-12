import { supabase,supabaseEnabled } from '../supabase';
import { calculateEmployeeFoodContribution,normalizeEmployeeContributionPercentage,EmployeeFoodContribution } from '../utils/employeeFoodContribution';

export type EmployeeFoodContributionMode='percentage'|'fixed_amount';
export interface EmployeeFoodContributionSettings { employeeId:string; employeeName?:string; employeeCode?:string; contributionMode:EmployeeFoodContributionMode; employeeContributionPercentage:number; fixedMonthlyAmount:number; }
export interface AdminEmployeeFoodContributionSetting extends EmployeeFoodContributionSettings { scope:'all'|'employee'; hasIndividualOverride:boolean; }
export interface EmployeeFoodContributionPreview { contribution_mode:EmployeeFoodContributionMode; employee_contribution_percentage:number; fixed_monthly_amount:number; previous_eligible_gross:number; gross_amount:number; company_amount:number; employee_amount:number; remaining_allowance_before:number; }

export async function loadEmployeeFoodContributionPercentage():Promise<number>{
  if(!supabaseEnabled||!supabase)return 0;
  const{data,error}=await supabase.rpc('get_employee_food_contribution_percentage');
  if(error)throw error;
  return normalizeEmployeeContributionPercentage(Number(data||0));
}

export async function saveEmployeeFoodContributionPercentage(value:number):Promise<number>{
  if(!supabaseEnabled||!supabase)throw new Error('Supabase is not enabled.');
  const percentage=normalizeEmployeeContributionPercentage(value);
  if(!Number.isFinite(Number(value))||Number(value)<0||Number(value)>100)throw new Error('Member contribution must be between 0% and 100%.');
  const{data,error}=await supabase.rpc('set_employee_food_contribution_percentage',{p_percentage:percentage});
  if(error)throw error;
  return normalizeEmployeeContributionPercentage(Number(data||0));
}

export async function loadEmployeeFoodContributionSettingsForAdmin():Promise<EmployeeFoodContributionSettings[]>{
  if(!supabaseEnabled||!supabase)return[];
  const{data,error}=await supabase.rpc('get_employee_food_contribution_settings_for_admin');
  if(error)throw error;
  return(data||[]).map((row:any)=>({employeeId:String(row.employee_id),employeeName:String(row.employee_name||''),employeeCode:row.employee_code?String(row.employee_code):undefined,contributionMode:(row.contribution_mode==='fixed_amount'?'fixed_amount':'percentage') as EmployeeFoodContributionMode,employeeContributionPercentage:normalizeEmployeeContributionPercentage(Number(row.employee_contribution_percentage||0)),fixedMonthlyAmount:Math.max(0,Number(row.fixed_monthly_amount||0))}));
}

export async function loadAdminEmployeeFoodContributionSettings():Promise<AdminEmployeeFoodContributionSetting[]>{
  if(!supabaseEnabled||!supabase)return[];
  const{data,error}=await supabase.rpc('get_employee_food_contribution_settings_for_admin_v2');
  if(error)throw error;
  return(data||[]).map((row:any)=>({
    scope:(row.scope==='all'?'all':'employee') as 'all'|'employee',
    employeeId:row.employee_id?String(row.employee_id):'all',
    employeeName:row.employee_name?String(row.employee_name):undefined,
    employeeCode:row.employee_code?String(row.employee_code):undefined,
    contributionMode:(row.contribution_mode==='fixed_amount'?'fixed_amount':'percentage') as EmployeeFoodContributionMode,
    employeeContributionPercentage:normalizeEmployeeContributionPercentage(Number(row.employee_contribution_percentage||0)),
    fixedMonthlyAmount:Math.max(0,Number(row.fixed_monthly_amount||0)),
    hasIndividualOverride:Boolean(row.has_individual_override),
  }));
}

export async function saveAdminEmployeeFoodContributionSetting(employeeId:string|null,mode:EmployeeFoodContributionMode,percentage:number,fixedMonthlyAmount:number):Promise<AdminEmployeeFoodContributionSetting>{
  if(!supabaseEnabled||!supabase)throw new Error('Supabase is not enabled.');
  if(mode==='percentage'&&(percentage<0||percentage>100||!Number.isFinite(percentage)))throw new Error('Member contribution must be between 0% and 100%.');
  if(mode==='fixed_amount'&&(fixedMonthlyAmount<0||!Number.isFinite(fixedMonthlyAmount)))throw new Error('Fixed monthly amount must be zero or greater.');
  const{data,error}=await supabase.rpc('set_employee_food_contribution_setting_for_admin',{p_employee_id:employeeId,p_mode:mode,p_percentage:mode==='percentage'?percentage:0,p_fixed_monthly_amount:mode==='fixed_amount'?fixedMonthlyAmount:0});
  if(error)throw error;
  const row=(data||[])[0]||{};
  return{scope:employeeId?'employee':'all',employeeId:employeeId||'all',contributionMode:(row.contribution_mode==='fixed_amount'?'fixed_amount':'percentage') as EmployeeFoodContributionMode,employeeContributionPercentage:normalizeEmployeeContributionPercentage(Number(row.employee_contribution_percentage||0)),fixedMonthlyAmount:Math.max(0,Number(row.fixed_monthly_amount||0)),hasIndividualOverride:Boolean(row.has_individual_override)};
}

export async function clearAdminEmployeeFoodContributionOverride(employeeId:string):Promise<void>{
  if(!supabaseEnabled||!supabase)throw new Error('Supabase is not enabled.');
  if(!employeeId)throw new Error('Employee is required.');
  const{error}=await supabase.rpc('clear_employee_food_contribution_override',{p_employee_id:employeeId});
  if(error)throw error;
}

export async function saveEmployeeFoodContributionSettings(employeeId:string,mode:EmployeeFoodContributionMode,percentage:number,fixedMonthlyAmount:number):Promise<EmployeeFoodContributionSettings>{
  if(!supabaseEnabled||!supabase)throw new Error('Supabase is not enabled.');
  if(!employeeId)throw new Error('Employee is required.');
  if(mode==='percentage'&&(percentage<0||percentage>100||!Number.isFinite(percentage)))throw new Error('Member contribution must be between 0% and 100%.');
  if(mode==='fixed_amount'&&(fixedMonthlyAmount<0||!Number.isFinite(fixedMonthlyAmount)))throw new Error('Fixed monthly amount must be zero or greater.');
  const{data,error}=await supabase.rpc('set_employee_food_contribution_settings',{p_employee_id:employeeId,p_mode:mode,p_percentage:mode==='percentage'?percentage:0,p_fixed_monthly_amount:mode==='fixed_amount'?fixedMonthlyAmount:0});
  if(error)throw error;
  const row=(data||[])[0]||{};
  return{employeeId,contributionMode:(row.contribution_mode==='fixed_amount'?'fixed_amount':'percentage') as EmployeeFoodContributionMode,employeeContributionPercentage:normalizeEmployeeContributionPercentage(Number(row.employee_contribution_percentage||0)),fixedMonthlyAmount:Math.max(0,Number(row.fixed_monthly_amount||0))};
}

export async function loadEmployeeFoodContributionSettingsForEmployee(employeeId:string):Promise<EmployeeFoodContributionSettings>{
  if(!supabaseEnabled||!supabase)throw new Error('Supabase is not enabled.');
  const{data,error}=await supabase.rpc('employee_food_contribution_setting_for_employee',{p_employee_id:employeeId});
  if(error)throw error;
  const row=(data||[])[0];
  if(!row)throw new Error('Employee contribution settings not found.');
  return{employeeId,contributionMode:(row.contribution_mode==='fixed_amount'?'fixed_amount':'percentage') as EmployeeFoodContributionMode,employeeContributionPercentage:normalizeEmployeeContributionPercentage(Number(row.employee_contribution_percentage||0)),fixedMonthlyAmount:Math.max(0,Number(row.fixed_monthly_amount||0))};
}

export async function previewEmployeeFoodContribution(employeeId:string,grossAmount:number,orderDate:string):Promise<EmployeeFoodContributionPreview>{
  if(!supabaseEnabled||!supabase)throw new Error('Supabase is not enabled.');
  const{data,error}=await supabase.rpc('get_employee_food_contribution_preview',{p_employee_id:employeeId,p_gross_amount:grossAmount,p_order_date:orderDate});
  if(error)throw error;
  return{contribution_mode:(data?.contribution_mode==='fixed_amount'?'fixed_amount':'percentage') as EmployeeFoodContributionMode,employee_contribution_percentage:Number(data?.employee_contribution_percentage||0),fixed_monthly_amount:Number(data?.fixed_monthly_amount||0),previous_eligible_gross:Number(data?.previous_eligible_gross||0),gross_amount:Number(data?.gross_amount||0),company_amount:Number(data?.company_amount||0),employee_amount:Number(data?.employee_amount||0),remaining_allowance_before:Number(data?.remaining_allowance_before||0)};
}

export { calculateEmployeeFoodContribution };
export type { EmployeeFoodContribution };
