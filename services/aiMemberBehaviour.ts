import { supabase } from '../supabase';
import type { Order, User } from '../types';

export interface AIMemberBehaviourRow {
  employeeId:string;
  name:string;
  currentFood:number;
  previousFood:number;
  currentOrders:number;
  previousOrders:number;
  currentOrderingDays:number;
  previousOrderingDays:number;
  currentGuestOrders:number;
  previousGuestOrders:number;
  currentGuestFood:number;
  previousGuestFood:number;
  currentCompanyContribution:number;
  previousCompanyContribution:number;
  currentPayable:number;
  previousPayable:number;
  currentAdminAdded:number;
  previousAdminAdded:number;
  currentFixedAllowance:number|null;
  previousFixedAllowance:number|null;
  currentContributionMode:'percentage'|'fixed_amount'|null;
  previousContributionMode:'percentage'|'fixed_amount'|null;
}

type BillRow={employee_id:string;bill_month:number;bill_year:number;total:number};
type AdjustmentRow={employee_id:string;adjustment_date:string;amount:number;contribution_eligible:boolean;employee_food_amount:number|null;company_food_amount:number|null;fixed_monthly_amount:number|null;contribution_mode:string|null};

const monthKey=(date:string)=>date.slice(0,7);
const persistedMemberFood=(o:Order)=>{
  if(o.employeeFoodAmount!=null||o.companyFoodAmount!=null){
    return Math.max(0,Number(o.employeeFoodAmount||0))+Math.max(0,Number(o.companyFoodAmount||0));
  }
  return Object.keys(o.items||{}).reduce((sum,code)=>{
    if(!o.items?.[code])return sum;
    return sum+Math.max(0,Number(o.itemPrices?.[code]||0))*Math.max(1,Number(o.itemQuantities?.[code]||1));
  },0);
};
const persistedGuestFood=(o:Order)=>Object.keys(o.guestItems||{}).reduce((sum,code)=>{
  if(!o.guestItems?.[code])return sum;
  return sum+Math.max(0,Number(o.guestItemPrices?.[code]||0))*Math.max(1,Number(o.guestItemQuantities?.[code]||1));
},0);

export async function loadAIMemberBehaviour(
  orders:Order[],
  users:User[],
  currentMonth:string,
  previousMonth:string,
):Promise<AIMemberBehaviourRow[]>{
  if(!supabase)return[];

  const start=`${previousMonth}-01`;
  const [year,month]=currentMonth.split('-').map(Number);
  const endDate=new Date(year,month,0);
  const end=`${endDate.getFullYear()}-${String(endDate.getMonth()+1).padStart(2,'0')}-${String(endDate.getDate()).padStart(2,'0')}`;

  const [billResult,adjustmentResult]=await Promise.all([
    supabase.from('monthly_bills').select('employee_id,bill_month,bill_year,total').gte('bill_year',Number(previousMonth.slice(0,4))).lte('bill_year',year),
    supabase.from('employee_adjustments').select('employee_id,adjustment_date,amount,contribution_eligible,employee_food_amount,company_food_amount,fixed_monthly_amount,contribution_mode').gte('adjustment_date',start).lte('adjustment_date',end),
  ]);

  const bills=(billResult.error?[]:(billResult.data||[])) as BillRow[];
  if(adjustmentResult.error)throw adjustmentResult.error;
  const adjustments=(adjustmentResult.data||[]) as AdjustmentRow[];

  const relevantOrders=orders.filter(o=>o.status!=='cancelled'&&(monthKey(o.date)===currentMonth||monthKey(o.date)===previousMonth));
  const usersByIdentity=new Map(users.filter(u=>u.role==='employee'&&u.status!=='deleted').map(u=>[u.identityId||u.id,u]));
  const usersByCode=new Map(users.filter(u=>u.role==='employee'&&u.status!=='deleted').map(u=>[u.id,u]));
  const relevantEmployees=new Set(relevantOrders.map(o=>o.memberIdentityId||o.employeeId));
  const rows=new Map<string,AIMemberBehaviourRow>();

  const ensure=(employeeId:string,user?:User)=>{
    const existing=rows.get(employeeId);
    if(existing)return existing;
    const row:AIMemberBehaviourRow={
      employeeId,name:user?.name||'Member',
      currentFood:0,previousFood:0,currentOrders:0,previousOrders:0,
      currentOrderingDays:0,previousOrderingDays:0,currentGuestOrders:0,previousGuestOrders:0,
      currentGuestFood:0,previousGuestFood:0,currentCompanyContribution:0,previousCompanyContribution:0,
      currentPayable:0,previousPayable:0,currentAdminAdded:0,previousAdminAdded:0,
      currentFixedAllowance:null,previousFixedAllowance:null,currentContributionMode:null,previousContributionMode:null,
    };
    rows.set(employeeId,row);
    return row;
  };

  const orderingDays=new Map<string,Set<string>>();

  for(const order of relevantOrders){
    const employeeId=order.memberIdentityId||order.employeeId;
    const user=usersByIdentity.get(employeeId)||usersByCode.get(order.employeeId);
    const row=ensure(employeeId,user);
    const current=monthKey(order.date)===currentMonth;
    const memberFood=persistedMemberFood(order);
    const guestFood=persistedGuestFood(order);
    const dayKey=`${employeeId}:${monthKey(order.date)}`;
    if(!orderingDays.has(dayKey))orderingDays.set(dayKey,new Set());
    orderingDays.get(dayKey)!.add(order.date);

    if(current){
      row.currentFood+=memberFood;
      row.currentOrders+=1;
      row.currentGuestOrders+=guestFood>0?1:0;
      row.currentGuestFood+=guestFood;
      row.currentCompanyContribution+=Math.max(0,Number(order.companyFoodAmount||0));
      if(order.fixedMonthlyAmount!=null)row.currentFixedAllowance=Number(order.fixedMonthlyAmount);
      if(order.employeeContributionMode)row.currentContributionMode=order.employeeContributionMode;
    }else{
      row.previousFood+=memberFood;
      row.previousOrders+=1;
      row.previousGuestOrders+=guestFood>0?1:0;
      row.previousGuestFood+=guestFood;
      row.previousCompanyContribution+=Math.max(0,Number(order.companyFoodAmount||0));
      if(order.fixedMonthlyAmount!=null)row.previousFixedAllowance=Number(order.fixedMonthlyAmount);
      if(order.employeeContributionMode)row.previousContributionMode=order.employeeContributionMode;
    }
  }

  for(const adjustment of adjustments){
    const key=monthKey(String(adjustment.adjustment_date));
    if(key!==currentMonth&&key!==previousMonth)continue;
    if(!relevantEmployees.has(adjustment.employee_id))continue;
    const row=ensure(adjustment.employee_id,usersByIdentity.get(adjustment.employee_id));
    const current=key===currentMonth;
    if(adjustment.contribution_eligible){
      const employeeFood=Math.max(0,Number(adjustment.employee_food_amount??adjustment.amount??0));
      const company=Math.max(0,Number(adjustment.company_food_amount||0));
      if(current){row.currentFood+=employeeFood+company;row.currentCompanyContribution+=company;}
      else{row.previousFood+=employeeFood+company;row.previousCompanyContribution+=company;}
    }else{
      if(current)row.currentAdminAdded+=Math.max(0,Number(adjustment.amount||0));
      else row.previousAdminAdded+=Math.max(0,Number(adjustment.amount||0));
    }
    if(adjustment.fixed_monthly_amount!=null){
      if(current)row.currentFixedAllowance=Number(adjustment.fixed_monthly_amount);
      else row.previousFixedAllowance=Number(adjustment.fixed_monthly_amount);
    }
    if(adjustment.contribution_mode==='fixed_amount'||adjustment.contribution_mode==='percentage'){
      if(current)row.currentContributionMode=adjustment.contribution_mode;
      else row.previousContributionMode=adjustment.contribution_mode;
    }
  }

  rows.forEach((row,employeeId)=>{
    row.currentOrderingDays=orderingDays.get(`${employeeId}:${currentMonth}`)?.size||0;
    row.previousOrderingDays=orderingDays.get(`${employeeId}:${previousMonth}`)?.size||0;
  });

  const billMap=new Map<string,number>();
  bills.forEach(b=>{
    const key=`${b.employee_id}:${Number(b.bill_year)}-${String(Number(b.bill_month)).padStart(2,'0')}`;
    billMap.set(key,Number(b.total||0));
  });

  rows.forEach((row,employeeId)=>{
    const currentBill=billMap.get(`${employeeId}:${currentMonth}`);
    const previousBill=billMap.get(`${employeeId}:${previousMonth}`);
    row.currentPayable=currentBill!=null
      ?currentBill
      :Math.max(0,row.currentFood-row.currentCompanyContribution)+row.currentGuestFood+row.currentAdminAdded;
    row.previousPayable=previousBill!=null
      ?previousBill
      :Math.max(0,row.previousFood-row.previousCompanyContribution)+row.previousGuestFood+row.previousAdminAdded;
  });

  return [...rows.values()].filter(row=>row.currentOrders>0||row.previousOrders>0).sort((a,b)=>a.name.localeCompare(b.name));
}
