import { supabase, supabaseEnabled } from '../supabase';

export interface AIForecastFinancialInput {
  month:string;
  revenue:number;
  expenses:number;
  net:number;
}

export interface AIForecastItem {
  name:string;
  estimatedQuantity:number;
  comparableDays:number;
}

export interface AIForecastFinancial {
  currentActual:number;
  projectedMonthEnd:number;
}

export interface AIForecasting {
  businessDate:string;
  nextOrderingDate:string|null;
  nextOrderingDay:string|null;
  nextOrderingState:'available'|'holiday'|'disabled'|'insufficient';
  orderForecast:number|null;
  orderComparableDays:number;
  foodQuantityForecasts:AIForecastItem[];
  guestQuantityForecast:number|null;
  guestComparableDays:number;
  financial:{
    available:boolean;
    currentMonth:string;
    daysElapsed:number;
    daysRemaining:number;
    daysInMonth:number;
    revenue:AIForecastFinancial|null;
    expenses:AIForecastFinancial|null;
    net:AIForecastFinancial|null;
    completedHistoricalMonths:number;
  };
  methodology:string[];
}

type HistoricalOrder={ordered_for:string;status:string;order_items?:Array<{item_code:string;item_name:string|null;quantity:number;item_source:string}>};
type HolidayRow={holiday_date:string};
type WindowRow={enabled:boolean;order_for:'today'|'tomorrow'};

const safeNumber=(value:unknown)=>{const n=Number(value);return Number.isFinite(n)&&n>=0?n:0};
const safeFinancialNumber=(value:unknown)=>{const n=Number(value);return Number.isFinite(n)?n:0};
const iso=(date:Date)=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
const monthKey=(date:Date)=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`;
const median=(values:number[])=>{const sorted=values.filter(Number.isFinite).sort((a,b)=>a-b);if(!sorted.length)return null;const middle=Math.floor(sorted.length/2);return sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2};
const clampQuantity=(value:number)=>Math.max(0,Math.round(Number.isFinite(value)?value:0));

const comparableDailyValues=(daily:Map<string,number>,targetWeekday:number,from:Date,to:Date,holidaySet:Set<string>)=>{
  const values:number[]=[];
  const cursor=new Date(from);
  while(cursor<=to){
    const key=iso(cursor);
    if(!holidaySet.has(key)&&cursor.getDay()===targetWeekday){
      const value=daily.get(key)||0;
      if(value>0)values.push(value);
    }
    cursor.setDate(cursor.getDate()+1);
  }
  return values;
};

export async function loadAIForecasting(financial:AIForecastFinancialInput[],fallbackNow=new Date()):Promise<AIForecasting>{
  if(!supabaseEnabled||!supabase)throw new Error('Supabase is not enabled.');

  const {data:businessTimestamp,error:businessError}=await supabase.rpc('gocanteen_business_timestamp');
  if(businessError)throw businessError;
  const businessDate=String(businessTimestamp||'').slice(0,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(businessDate))throw new Error('Could not determine the application business date.');
  const business=new Date(`${businessDate}T00:00:00`);
  const currentDate=Number.isNaN(business.getTime())?fallbackNow:business;
  const historicalFromDate=new Date(currentDate.getFullYear(),currentDate.getMonth()-5,1);
  const historicalFrom=iso(historicalFromDate);
  const nextWindowEnd=new Date(currentDate.getFullYear(),currentDate.getMonth()+1,15);

  const [ordersResult,holidaysResult,windowResult]=await Promise.all([
    supabase.from('orders').select('ordered_for,status,order_items(item_code,item_name,quantity,item_source)').gte('ordered_for',historicalFrom).lte('ordered_for',iso(currentDate)),
    supabase.from('holidays').select('holiday_date').gte('holiday_date',historicalFrom).lte('holiday_date',iso(nextWindowEnd)),
    supabase.from('order_window_settings').select('enabled,order_for').maybeSingle(),
  ]);
  if(ordersResult.error)throw ordersResult.error;
  if(holidaysResult.error)throw holidaysResult.error;
  if(windowResult.error)throw windowResult.error;

  const holidays=new Set((holidaysResult.data||[]).map((row:HolidayRow)=>String(row.holiday_date).slice(0,10)));
  const orders=(ordersResult.data||[]) as HistoricalOrder[];
  const dailyOrders=new Map<string,number>();
  const dailyGuestQuantity=new Map<string,number>();
  const itemDaily=new Map<string,Map<string,number>>();

  for(const order of orders){
    const date=String(order.ordered_for).slice(0,10);
    if(order.status==='cancelled')continue;
    const items=Array.isArray(order.order_items)?order.order_items:[];
    let hasOrder=false;
    let guestQuantity=0;
    for(const item of items){
      const quantity=safeNumber(item.quantity);
      if(quantity<=0)continue;
      hasOrder=true;
      if(item.item_source==='guest'){
        guestQuantity+=quantity;
      }else{
        const name=String(item.item_name||item.item_code||'').trim();
        if(!name)continue;
        const daily=itemDaily.get(name)||new Map<string,number>();
        daily.set(date,(daily.get(date)||0)+quantity);
        itemDaily.set(name,daily);
      }
    }
    if(hasOrder)dailyOrders.set(date,(dailyOrders.get(date)||0)+1);
    if(guestQuantity>0)dailyGuestQuantity.set(date,(dailyGuestQuantity.get(date)||0)+guestQuantity);
  }

  const window=windowResult.data as WindowRow|null;
  let nextOrderingDate:string|null=null;
  let nextOrderingDay:string|null=null;
  let nextOrderingState:AIForecasting['nextOrderingState']='insufficient';
  if(window?.enabled){
    const candidate=new Date(currentDate);
    candidate.setDate(candidate.getDate()+1);
    for(let i=0;i<31;i++){
      const key=iso(candidate);
      if(!holidays.has(key)){
        nextOrderingDate=key;
        nextOrderingDay=candidate.toLocaleDateString('en-IN',{weekday:'long'});
        break;
      }
      candidate.setDate(candidate.getDate()+1);
    }
    if(!nextOrderingDate)nextOrderingState='holiday';
    else nextOrderingState='available';
  }else{
    nextOrderingState='disabled';
  }

  let orderForecast:number|null=null;
  let orderComparableDays=0;
  const foodQuantityForecasts:AIForecastItem[]=[];
  let guestQuantityForecast:number|null=null;
  let guestComparableDays=0;

  if(nextOrderingDate){
    const target=new Date(`${nextOrderingDate}T00:00:00`);
    const targetWeekday=target.getDay();
    const comparableFrom=new Date(currentDate.getFullYear(),currentDate.getMonth()-6,currentDate.getDate());
    const comparableOrderValues=comparableDailyValues(dailyOrders,targetWeekday,comparableFrom,currentDate,holidays);
    orderComparableDays=comparableOrderValues.length;
    if(comparableOrderValues.length>=3)orderForecast=clampQuantity(median(comparableOrderValues)||0);

    const comparableGuestValues=comparableDailyValues(dailyGuestQuantity,targetWeekday,comparableFrom,currentDate,holidays);
    guestComparableDays=comparableGuestValues.length;
    if(comparableGuestValues.length>=3)guestQuantityForecast=clampQuantity(median(comparableGuestValues)||0);

    for(const [name,daily] of itemDaily){
      const values=comparableDailyValues(daily,targetWeekday,comparableFrom,currentDate,holidays);
      if(values.length>=3)foodQuantityForecasts.push({name,estimatedQuantity:clampQuantity(median(values)||0),comparableDays:values.length});
    }
    foodQuantityForecasts.sort((a,b)=>b.estimatedQuantity-a.estimatedQuantity);
  }

  const currentMonth=monthKey(currentDate);
  const daysInMonth=new Date(currentDate.getFullYear(),currentDate.getMonth()+1,0).getDate();
  const daysElapsed=currentDate.getDate();
  const daysRemaining=Math.max(0,daysInMonth-daysElapsed);
  const completed=financial.filter(row=>row.month<currentMonth&&Number.isFinite(row.revenue)&&Number.isFinite(row.expenses)&&Number.isFinite(row.net));
  const current=financial.find(row=>row.month===currentMonth);
  const historicalDaily=(field:'revenue'|'expenses'|'net')=>median(completed.map(row=>{
    const year=Number(row.month.slice(0,4));
    const month=Number(row.month.slice(5,7));
    const monthDays=new Date(year,month,0).getDate();
    return safeFinancialNumber(row[field])/monthDays;
  }));
  const project=(field:'revenue'|'expenses'|'net')=>{
    if(!current||completed.length<2)return null;
    const actual=safeFinancialNumber(current[field]);
    const dailyRate=historicalDaily(field);
    if(dailyRate===null)return null;
    const projected=actual+dailyRate*daysRemaining;
    return{currentActual:actual,projectedMonthEnd:field==='net'?projected:Math.max(0,projected)};
  };

  const methodology=[
    'Next-day orders and food quantities use the median of observed non-holiday comparable weekdays from the recent six-month window; this reduces the effect of extreme days.',
    'A forecast requires at least 3 observed comparable weekdays. Zero-activity dates are not treated as evidence of demand when historical observations are sparse.',
    'Food quantities use persisted order_items.quantity and are never derived from price, contribution, or payment data. Guest quantity remains separate from member quantity.',
    'Financial month-end projection uses current-month authoritative actuals plus remaining calendar days multiplied by the median daily rate from at least 2 completed historical months.',
  ];

  const revenue=project('revenue');
  const expenses=project('expenses');
  const net=project('net');

  return{
    businessDate:iso(currentDate),
    nextOrderingDate,
    nextOrderingDay,
    nextOrderingState,
    orderForecast,
    orderComparableDays,
    foodQuantityForecasts,
    guestQuantityForecast,
    guestComparableDays,
    financial:{
      available:Boolean(current&&revenue&&expenses&&net),
      currentMonth,
      daysElapsed,
      daysRemaining,
      daysInMonth,
      revenue,
      expenses,
      net,
      completedHistoricalMonths:completed.length,
    },
    methodology,
  };
}
