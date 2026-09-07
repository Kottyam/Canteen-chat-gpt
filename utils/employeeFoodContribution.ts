export interface EmployeeFoodContribution {
  grossAmount:number;
  employeePercentage:number;
  employeeAmount:number;
  companyPercentage:number;
  companyAmount:number;
}

export const normalizeEmployeeContributionPercentage=(value:number)=>Math.min(100,Math.max(0,Number.isFinite(Number(value))?Number(value):0));

/** Deterministic currency split. 0% intentionally preserves today's full employee payable behaviour. */
export function calculateEmployeeFoodContribution(grossAmount:number,employeeContributionPercentage:number):EmployeeFoodContribution{
  const gross=Math.max(0,Math.round((Number(grossAmount)||0)*100)/100);
  const employeePercentage=normalizeEmployeeContributionPercentage(employeeContributionPercentage);
  const companyPercentage=100-employeePercentage;
  if(employeePercentage===0)return{grossAmount:gross,employeePercentage:0,employeeAmount:gross,companyPercentage:100,companyAmount:0};
  const employeeAmount=Math.round(gross*employeePercentage)/100;
  const companyAmount=Math.round((gross-employeeAmount)*100)/100;
  return{grossAmount:gross,employeePercentage,employeeAmount,companyPercentage,companyAmount};
}

export const orderEmployeeFoodAmount=(grossAmount:number,storedEmployeeAmount?:number|null)=>storedEmployeeAmount==null?Number(grossAmount)||0:Number(storedEmployeeAmount)||0;
