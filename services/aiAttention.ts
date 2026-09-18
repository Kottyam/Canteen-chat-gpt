import { supabase, supabaseEnabled } from '../supabase';
import type { User } from '../types';

export type AIAttentionAction =
  | 'payment_verification'
  | 'menu'
  | 'member_behaviour'
  | null;

export interface AIAttentionItem {
  id:string;
  category:'payment_verification'|'outstanding_bill'|'menu'|'order_activity'|'fixed_amount';
  title:string;
  detail:string;
  action:AIAttentionAction;
  weekday?:number;
  memberName?:string;
  amount?:number;
  month?:string;
  dataBasis?:string;
}

export interface AIAttentionResult {
  items:AIAttentionItem[];
  businessDate:string;
  loadingSources:string[];
}

type BillRow={
  id:string;
  employee_id:string;
  bill_month:number;
  bill_year:number;
  total:number;
  published:boolean;
  published_at:string|null;
  member_name_snapshot:string|null;
  created_at:string;
};
type PaymentRow={
  id:string;
  bill_id:string;
  employee_id:string;
  amount:number;
  status:string;
  confirmed_at:string|null;
  approved_at:string|null;
  created_at:string;
};
type OrderRow={
  ordered_for:string;
  status:string;
  employee_id:string;
  order_source:string;
  member_name_snapshot:string|null;
  employee_food_amount:number|null;
  company_food_amount:number|null;
  employee_contribution_mode:string|null;
  fixed_monthly_amount:number|null;
  created_at:string;
  order_items?:Array<{
    item_code:string;
    item_name:string|null;
    quantity:number;
    item_source:string;
  }>;
};
type AdjustmentRow={
  employee_id:string;
  adjustment_date:string;
  amount:number;
  contribution_eligible:boolean;
  employee_food_amount:number|null;
  company_food_amount:number|null;
  fixed_monthly_amount:number|null;
  contribution_mode:string|null;
  member_name_snapshot:string|null;
};
type HolidayRow={holiday_date:string};
type WindowRow={enabled:boolean;order_for:'today'|'tomorrow'};
type MenuRow={weekday:number;item_code:string;active:boolean};

const iso=(d:Date)=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const monthKey=(d:Date)=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
const money=(n:number)=>`₹${n.toFixed(2)}`;
const dayNames=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

const quartile=(values:number[],q:number)=>{
  const sorted=values.filter(Number.isFinite).sort((a,b)=>a-b);
  if(!sorted.length)return null;
  const position=(sorted.length-1)*q;
  const lower=Math.floor(position);
  const upper=Math.ceil(position);
  if(lower===upper)return sorted[lower];
  return sorted[lower]+(sorted[upper]-sorted[lower])*(position-lower);
};

const comparableValues=(daily:Map<string,number>,weekday:number,from:Date,to:Date,holidays:Set<string>)=>{
  const values:number[]=[];
  const cursor=new Date(from);
  while(cursor<=to){
    const key=iso(cursor);
    if(cursor.getDay()===weekday&&!holidays.has(key)){
      const value=daily.get(key)||0;
      values.push(value);
    }
    cursor.setDate(cursor.getDate()+1);
  }
  return values;
};

const historicalOutlier=(actual:number,values:number[])=>{
  if(values.length<5)return null;
  const q1=quartile(values,.25);
  const q3=quartile(values,.75);
  if(q1===null||q3===null)return null;
  const iqr=q3-q1;
  if(iqr===0){
    if(actual===q1)return null;
    return actual>q1?'high':'low';
  }
  if(actual<q1-1.5*iqr)return'low';
  if(actual>q3+1.5*iqr)return'high';
  return null;
};

const memberNameFor=(employeeId:string,snapshot:string|null,usersByIdentity:Map<string,User>)=>{
  return snapshot?.trim()||usersByIdentity.get(employeeId)?.name||'Member';
};

export async function loadAIAttention(options:{
  canViewPayments:boolean;
  canViewBills:boolean;
  canViewOrders:boolean;
  canViewMembers:boolean;
  users:User[];
}):Promise<AIAttentionResult>{
  if(!supabaseEnabled||!supabase)throw new Error('Supabase is not enabled.');

  const {data:businessTimestamp,error:businessError}=await supabase.rpc('gocanteen_business_timestamp');
  if(businessError)throw businessError;
  const businessDate=String(businessTimestamp||'').slice(0,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(businessDate))throw new Error('Could not determine the application business date.');
  const business=new Date(`${businessDate}T00:00:00`);
  const currentMonth=monthKey(business);
  const previousHistoryStart=new Date(business.getFullYear(),business.getMonth()-5,1);
  const historyFrom=iso(previousHistoryStart);

  const items:AIAttentionItem[]=[];
  const usersByIdentity=new Map(options.users.filter(u=>u.role==='employee'&&u.status!=='deleted').map(u=>[u.identityId||u.id,u]));

  const queryPromises:Promise<unknown>[]=[];
  const results:{
    bills?:BillRow[];
    payments?:PaymentRow[];
    orders?:OrderRow[];
    adjustments?:AdjustmentRow[];
    holidays?:HolidayRow[];
    window?:WindowRow|null;
    weeklyMenu?:MenuRow[];
  }={};

  const billPromise=options.canViewBills&&options.canViewPayments
    ?Promise.all([
      supabase.from('monthly_bills').select('id,employee_id,bill_month,bill_year,total,published,published_at,member_name_snapshot').eq('published',true),
      supabase.from('bill_payments').select('id,bill_id,employee_id,amount,status,confirmed_at,approved_at,created_at').order('created_at',{ascending:true}),
    ])
    :null;
  if(billPromise)queryPromises.push(billPromise.then(([b,p])=>{
    if(b.error)throw b.error;
    if(p.error)throw p.error;
    results.bills=(b.data||[]) as BillRow[];
    results.payments=(p.data||[]) as PaymentRow[];
  }));

  if(options.canViewOrders){
    queryPromises.push(
      supabase.from('orders')
        .select('ordered_for,status,employee_id,order_source,member_name_snapshot,employee_food_amount,company_food_amount,employee_contribution_mode,fixed_monthly_amount,created_at,order_items(item_code,item_name,quantity,item_source)')
        .gte('ordered_for',historyFrom)
        .lte('ordered_for',businessDate)
        .then(r=>{
          if(r.error)throw r.error;
          results.orders=(r.data||[]) as OrderRow[];
        })
    );
  }

  if(options.canViewMembers){
    queryPromises.push(
      supabase.from('employee_adjustments')
        .select('employee_id,adjustment_date,amount,contribution_eligible,employee_food_amount,company_food_amount,fixed_monthly_amount,contribution_mode,member_name_snapshot,created_at')
        .gte('adjustment_date',`${currentMonth}-01`)
        .lte('adjustment_date',businessDate)
        .then(r=>{
          if(r.error)throw r.error;
          results.adjustments=(r.data||[]) as AdjustmentRow[];
        })
    );
  }

  queryPromises.push(
    supabase.from('holidays')
      .select('holiday_date')
      .gte('holiday_date',businessDate)
      .lte('holiday_date',iso(new Date(business.getFullYear(),business.getMonth()+1,15)))
      .then(r=>{
        if(r.error)throw r.error;
        results.holidays=(r.data||[]) as HolidayRow[];
      })
  );

  queryPromises.push(
    supabase.from('order_window_settings')
      .select('enabled,order_for')
      .maybeSingle()
      .then(r=>{
        if(r.error)throw r.error;
        results.window=(r.data||null) as WindowRow|null;
      })
  );

  queryPromises.push(
    supabase.from('weekly_menu')
      .select('weekday,item_code,active')
      .eq('active',true)
      .then(r=>{
        if(r.error)throw r.error;
        results.weeklyMenu=(r.data||[]) as MenuRow[];
      })
  );

  await Promise.all(queryPromises);

  if(options.canViewPayments&&options.canViewBills){
    const bills=results.bills||[];
    const payments=results.payments||[];
    const paymentsByBill=new Map<string,PaymentRow[]>();
    payments.forEach(payment=>{
      const rows=paymentsByBill.get(payment.bill_id)||[];
      rows.push(payment);
      paymentsByBill.set(payment.bill_id,rows);
    });

    const pending=payments.filter(payment=>payment.status==='pending_verification');
    if(pending.length){
      const memberIds=new Set<string>();
      pending.forEach(payment=>{
        const bill=bills.find(row=>row.id===payment.bill_id);
        const name=memberNameFor(payment.employee_id,bill?.member_name_snapshot||null,usersByIdentity);
        memberIds.add(name);
      });
      items.push({
        id:'payment-verification',
        category:'payment_verification',
        title:'PAYMENTS PENDING VERIFICATION',
        detail:`${pending.length} payment ${pending.length===1?'is':'are'} awaiting Admin verification across ${memberIds.size} member${memberIds.size===1?'':'s'}.`,
        action:'payment_verification',
      });
    }

    const outstanding=bills.map(bill=>{
      const paid=(paymentsByBill.get(bill.id)||[])
        .filter(payment=>payment.status==='paid')
        .reduce((sum,payment)=>sum+Math.max(0,Number(payment.amount||0)),0);
      const total=Math.max(0,Number(bill.total||0));
      return{
        bill,
        outstanding:Math.max(0,total-paid),
      };
    }).filter(row=>Number(row.bill.total||0)>0&&row.outstanding>0);

    outstanding.forEach(row=>{
      const bill=row.bill;
      items.push({
        id:`outstanding-${bill.id}`,
        category:'outstanding_bill',
        title:'OUTSTANDING / UNPAID BILL',
        detail:`${memberNameFor(bill.employee_id,bill.member_name_snapshot,usersByIdentity)} • ${money(row.outstanding)} outstanding • ${new Date(bill.bill_year,bill.bill_month-1,1).toLocaleDateString('en-IN',{month:'short',year:'numeric'})} bill`,
        action:'payment_verification',
        memberName:memberNameFor(bill.employee_id,bill.member_name_snapshot,usersByIdentity),
        amount:row.outstanding,
        month:`${bill.bill_year}-${String(bill.bill_month).padStart(2,'0')}`,
      });
    });

    const totalOutstanding=outstanding.reduce((sum,row)=>sum+row.outstanding,0);const outstandingMembers=new Set(outstanding.map(row=>row.bill.employee_id));
    if(outstanding.length>1){
      items.unshift({
        id:'outstanding-summary',
        category:'outstanding_bill',
        title:'OUTSTANDING BILLS',
        detail:`${money(totalOutstanding)} outstanding across ${outstandingMembers.size} members.`,
        action:'payment_verification',
        amount:totalOutstanding,
      });
    }
  }

  const window=results.window||null;
  if(window?.enabled){
    const targetDate=new Date(business);
    if(window.order_for==='tomorrow')targetDate.setDate(targetDate.getDate()+1);
    const targetKey=iso(targetDate);
    const holidaySet=new Set((results.holidays||[]).map(row=>String(row.holiday_date).slice(0,10)));
    if(!holidaySet.has(targetKey)){
      const weekday=targetDate.getDay();
      const menuConfigured=(results.weeklyMenu||[]).some(row=>Number(row.weekday)===weekday&&row.active);
      if(!menuConfigured){
        items.push({
          id:`menu-${targetKey}`,
          category:'menu',
          title:'MENU NOT CONFIGURED',
          detail:`Menu not configured for ${dayNames[weekday]} (${targetKey}).`,
          action:'menu',
          weekday,
        });
      }
    }
  }

  if(options.canViewOrders){
    const orders=(results.orders||[]).filter(order=>order.status!=='cancelled');
    const dailyOrders=new Map<string,number>();
    const dailyMemberQuantity=new Map<string,number>();
    const dailyGuestQuantity=new Map<string,number>();
    orders.forEach(order=>{
      const date=String(order.ordered_for).slice(0,10);
      let orderHasFood=false;
      let memberQuantity=0;
      let guestQuantity=0;
      (order.order_items||[]).forEach(item=>{
        const quantity=Math.max(0,Number(item.quantity||0));
        if(quantity<=0)return;
        orderHasFood=true;
        if(item.item_source==='guest')guestQuantity+=quantity;
        else memberQuantity+=quantity;
      });
      if(orderHasFood){
        dailyOrders.set(date,(dailyOrders.get(date)||0)+1);
        dailyMemberQuantity.set(date,(dailyMemberQuantity.get(date)||0)+memberQuantity);
        dailyGuestQuantity.set(date,(dailyGuestQuantity.get(date)||0)+guestQuantity);
      }
    });

    const windowEnabled=Boolean(window?.enabled);
    if(windowEnabled&&window?.order_for==='today'&&!new Set((results.holidays||[]).map(row=>String(row.holiday_date).slice(0,10))).has(businessDate)){
      const historyFromComparable=new Date(business.getFullYear(),business.getMonth()-6,business.getDate());
      const weekday=business.getDay();
      const comparableOrders=comparableValues(dailyOrders,weekday,historyFromComparable,new Date(business),new Set((results.holidays||[]).map(row=>String(row.holiday_date).slice(0,10))));
      const currentOrders=dailyOrders.get(businessDate)||0;
      const orderOutlier=historicalOutlier(currentOrders,comparableOrders);
      if(orderOutlier==='low'){
        items.push({
          id:'low-order-activity',
          category:'order_activity',
          title:'LOW ORDER ACTIVITY',
          detail:`Today's ${currentOrders} order${currentOrders===1?'':'s'} is below the historical comparable range for ${dayNames[weekday]}.`,
          action:null,
          dataBasis:`${comparableOrders.length} comparable non-holiday ${dayNames[weekday]} observations; Tukey 1.5×IQR lower fence.`,
        });
      }else if(orderOutlier==='high'){
        items.push({
          id:'unusual-order-activity',
          category:'order_activity',
          title:'UNUSUAL ORDER ACTIVITY',
          detail:`Today's ${currentOrders} orders are above the historical comparable range for ${dayNames[weekday]}.`,
          action:null,
          dataBasis:`${comparableOrders.length} comparable non-holiday ${dayNames[weekday]} observations; Tukey 1.5×IQR upper fence.`,
        });
      }

      const holidaysSet=new Set((results.holidays||[]).map(row=>String(row.holiday_date).slice(0,10)));
      const comparableMemberQuantity=comparableValues(dailyMemberQuantity,weekday,historyFromComparable,new Date(business),holidaysSet);
      const currentMemberQuantity=dailyMemberQuantity.get(businessDate)||0;
      const memberOutlier=historicalOutlier(currentMemberQuantity,comparableMemberQuantity);
      if(memberOutlier==='high'||memberOutlier==='low'){
        items.push({
          id:'unusual-food-quantity',
          category:'order_activity',
          title:'UNUSUAL FOOD QUANTITY',
          detail:`Today's member food quantity (${currentMemberQuantity} portions) is ${memberOutlier==='high'?'above':'below'} the historical comparable range for ${dayNames[weekday]}.`,
          action:null,
          dataBasis:`${comparableMemberQuantity.length} comparable non-holiday ${dayNames[weekday]} observations; Tukey 1.5×IQR fence.`,
        });
      }

      const comparableGuestQuantity=comparableValues(dailyGuestQuantity,weekday,historyFromComparable,new Date(business),holidaysSet);
      const currentGuestQuantity=dailyGuestQuantity.get(businessDate)||0;
      const guestOutlier=historicalOutlier(currentGuestQuantity,comparableGuestQuantity);
      if(guestOutlier==='high'){
        items.push({
          id:'unusual-guest-quantity',
          category:'order_activity',
          title:'UNUSUAL GUEST QUANTITY',
          detail:`Today's guest quantity (${currentGuestQuantity} portions) is above the historical comparable range for ${dayNames[weekday]}.`,
          action:null,
          dataBasis:`${comparableGuestQuantity.length} comparable non-holiday ${dayNames[weekday]} observations; Tukey 1.5×IQR fence.`,
        });
      }
    }
  }

  if(options.canViewOrders&&options.canViewMembers){
    const fixed=new Map<string,{name:string;allowance:number|null;used:number;mode:string|null}>();
    const ensureFixed=(employeeId:string,name:string|null)=>{
      const existing=fixed.get(employeeId);
      if(existing)return existing;
      const row={name:name?.trim()||usersByIdentity.get(employeeId)?.name||'Member',allowance:null as number|null,used:0,mode:null as string|null};
      fixed.set(employeeId,row);
      return row;
    };

    (results.orders||[]).filter(order=>order.status!=='cancelled'&&String(order.ordered_for).slice(0,7)===currentMonth).sort((a,b)=>String(a.ordered_for).localeCompare(String(b.ordered_for))||String(a.created_at||'').localeCompare(String(b.created_at||''))).forEach(order=>{
      if(order.employee_contribution_mode!=='fixed_amount')return;
      const row=ensureFixed(order.employee_id,order.member_name_snapshot);
      if(order.fixed_monthly_amount!=null)row.allowance=Number(order.fixed_monthly_amount);
      row.used+=Math.max(0,Number(order.company_food_amount||0));
      row.mode='fixed_amount';
    });

    (results.adjustments||[]).sort((a,b)=>String(a.adjustment_date).localeCompare(String(b.adjustment_date))||String(a.created_at||'').localeCompare(String(b.created_at||''))).forEach(adjustment=>{
      if(!adjustment.contribution_eligible||adjustment.contribution_mode!=='fixed_amount')return;
      const row=ensureFixed(adjustment.employee_id,adjustment.member_name_snapshot);
      if(adjustment.fixed_monthly_amount!=null)row.allowance=Number(adjustment.fixed_monthly_amount);
      row.used+=Math.max(0,Number(adjustment.company_food_amount||0));
      row.mode='fixed_amount';
    });

    for(const [employeeId,row] of fixed){
      if(row.mode!=='fixed_amount'||row.allowance===null||row.allowance<=0)continue;
      const remaining=Math.max(0,row.allowance-row.used);
      if(remaining<=0){
        items.push({
          id:`fixed-exhausted-${employeeId}`,
          category:'fixed_amount',
          title:'FIXED AMOUNT ALLOWANCE EXHAUSTED',
          detail:`${row.name} has used ${money(row.used)} of the ${money(row.allowance)} monthly company allowance (remaining ₹0.00).`,
          action:'member_behaviour',
          memberName:row.name,
          amount:row.allowance,
        });
      }
    }
  }

  return{items,businessDate,loadingSources:[]};
}
