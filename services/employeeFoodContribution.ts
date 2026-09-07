import { supabase,supabaseEnabled } from '../supabase';
import { calculateEmployeeFoodContribution,normalizeEmployeeContributionPercentage,EmployeeFoodContribution } from '../utils/employeeFoodContribution';

export async function loadEmployeeFoodContributionPercentage():Promise<number>{
  if(!supabaseEnabled||!supabase)return 0;
  const{data,error}=await supabase.rpc('get_employee_food_contribution_percentage');
  if(error)throw error;
  return normalizeEmployeeContributionPercentage(Number(data||0));
}

export async function saveEmployeeFoodContributionPercentage(value:number):Promise<number>{
  if(!supabaseEnabled||!supabase)throw new Error('Supabase is not enabled.');
  const percentage=normalizeEmployeeContributionPercentage(value);
  if(!Number.isFinite(Number(value))||Number(value)<0||Number(value)>100)throw new Error('Employee contribution must be between 0% and 100%.');
  const{data,error}=await supabase.rpc('set_employee_food_contribution_percentage',{p_percentage:percentage});
  if(error)throw error;
  return normalizeEmployeeContributionPercentage(Number(data||0));
}

export { calculateEmployeeFoodContribution };
export type { EmployeeFoodContribution };
