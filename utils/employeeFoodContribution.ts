export type EmployeeFoodContributionMode='percentage'|'fixed_amount';
export interface EmployeeFoodContribution { grossAmount:number; employeePercentage:number; employeeAmount:number; companyPercentage:number; companyAmount:number; contributionMode?:EmployeeFoodContributionMode; fixedMonthlyAmount?:number; previousEligibleGross?:number; }

export const DEFAULT_MEMBER_CONTRIBUTION_PERCENTAGE=100;
export const normalizeEmployeeContributionPercentage=(value:number)=>Math.min(100,Math.max(0,Number.isFinite(Number(value))?Number(value):DEFAULT_MEMBER_CONTRIBUTION_PERCENTAGE));
export const normalizeFixedMonthlyAmount=(value:number)=>Math.max(0,Number.isFinite(Number(value))?Number(value):0);

/** Deterministic Percentage rule: Member Contribution is the configured member share. 0% means Company pays 100%; no configuration is handled separately as the 100% member-pay default. */
export function calculateEmployeeFoodContribution(grossAmount:number,employeeContributionPercentage:number):EmployeeFoodContribution{
 const gross=Math.max(0,Math.round((Number(grossAmount)||0)*100)/100);const employeePercentage=normalizeEmployeeContributionPercentage(employeeContributionPercentage);const companyPercentage=100-employeePercentage;
 const employeeAmount=Math.round(gross*employeePercentage)/100;const companyAmount=Math.max(0,Math.round((gross-employeeAmount)*100)/100);
 return{grossAmount:gross,employeePercentage,employeeAmount,companyPercentage,companyAmount,contributionMode:'percentage'};
}

/** Fixed Amount is a monthly company-covered allowance, never an order-size limit. */
export function calculateFixedEmployeeFoodContribution(grossAmount:number,fixedMonthlyAmount:number,previousEligibleGross:number):EmployeeFoodContribution{
 const gross=Math.max(0,Math.round((Number(grossAmount)||0)*100)/100);const allowance=normalizeFixedMonthlyAmount(fixedMonthlyAmount);const previous=Math.max(0,Math.round((Number(previousEligibleGross)||0)*100)/100);const companyAmount=Math.min(gross,Math.max(0,Math.round((allowance-previous)*100)/100));const employeeAmount=Math.max(0,Math.round((gross-companyAmount)*100)/100);const employeePercentage=gross===0?0:Math.round(employeeAmount/gross*10000)/100;const companyPercentage=gross===0?0:Math.round(companyAmount/gross*10000)/100;
 return{grossAmount:gross,employeePercentage,employeeAmount,companyPercentage,companyAmount,contributionMode:'fixed_amount',fixedMonthlyAmount:allowance,previousEligibleGross:previous};
}

/** Apply the central Percentage rule to each individual food entry before summing. */
export const calculateEmployeeFoodAmountFromEntries=(grossAmounts:number[],employeeContributionPercentage:number)=>grossAmounts.reduce((sum,gross)=>sum+calculateEmployeeFoodContribution(gross,employeeContributionPercentage).employeeAmount,0);
export const orderEmployeeFoodAmount=(grossAmount:number,storedEmployeeAmount?:number|null)=>storedEmployeeAmount==null?Number(grossAmount)||0:Number(storedEmployeeAmount)||0;
