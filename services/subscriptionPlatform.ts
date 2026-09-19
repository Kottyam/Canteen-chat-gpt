import { supabase } from '../supabase';

export type SubscriptionStatus='trial'|'active'|'payment_pending'|'expired'|'suspended';
export type PaymentStatus='pending'|'paid'|'failed'|'refunded';
export type BillingCycle='monthly'|'annual';
export type BillingPeriod='monthly'|'quarterly'|'yearly';
export type PaymentProvider='manual'|'razorpay';
export type PricingModel='MEMBER_RANGE'|'FIXED_AMOUNT';
export type PlanSelectionMode='auto_range'|'manual';

export interface SubscriptionPlan{
  id:string;
  name:string;
  description:string|null;
  pricing_model:PricingModel;
  monthly_price:number;
  annual_price:number;
  price:number;
  billing_period:BillingPeriod;
  currency:string;
  trial_days:number;
  active:boolean;
  is_default:boolean;
  min_members:number|null;
  max_members:number|null;
  created_at:string;
  updated_at:string
}
export interface CanteenSubscription{
  id:string;
  canteen_id:string;
  plan_id:string;
  status:SubscriptionStatus;
  trial_start:string|null;
  trial_end:string|null;
  subscription_start:string|null;
  subscription_end:string|null;
  amount:number;
  currency:string;
  payment_status:PaymentStatus;
  billing_cycle:BillingCycle;
  plan_selection_mode:PlanSelectionMode;
  created_at:string;
  updated_at:string
}
export interface SubscriptionPayment{
  id:string;
  canteen_id:string;
  subscription_id:string;
  plan_id:string;
  amount:number;
  currency:string;
  payment_date:string|null;
  payment_status:PaymentStatus;
  transaction_reference:string|null;
  payment_provider:PaymentProvider;
  payment_note:string|null;
  billing_cycle:BillingCycle|null;
  billing_period_start:string|null;
  billing_period_end:string|null;
  created_at:string;
  updated_at:string
}
export interface SubscriptionPaymentSettings{id:boolean;payment_provider:PaymentProvider;manual_payment_enabled:boolean;razorpay_enabled:boolean;upi_id:string|null;payment_display_name:string|null;payment_instructions:string|null;bank_payment_details:string|null;created_at:string;updated_at:string}

const requireClient=()=>{if(!supabase)throw new Error('Supabase is not enabled.');return supabase};
const planPrice=(plan:SubscriptionPlan,cycle:BillingCycle)=>cycle==='annual'?plan.annual_price:plan.monthly_price;

export interface CanteenAccessState{allowed:boolean;status:SubscriptionStatus|null;subscription:CanteenSubscription|null;reason:'trial'|'active'|'payment_pending'|'expired'|'suspended'|'unassigned'|'verification_error'}

export async function loadCanteenAccessState(canteenId:string):Promise<CanteenAccessState>{
  const c=requireClient();
  await syncSubscriptionStatuses(canteenId);
  const {data:allowed,error:accessError}=await c.rpc('can_canteen_operate',{p_canteen_id:canteenId});
  if(accessError)throw accessError;
  const {data:subscription,error}=await c.from('canteen_subscriptions').select('*').eq('canteen_id',canteenId).maybeSingle();
  if(error)throw error;
  if(!subscription)return{allowed:Boolean(allowed),status:null,subscription:null,reason:allowed?'payment_pending':'verification_error'};
  const sub=subscription as CanteenSubscription;
  const now=Date.now();
  const dateValid=(sub.status==='trial'&&Boolean(sub.trial_end)&&new Date(sub.trial_end).getTime()>now)||(sub.status==='active'&&Boolean(sub.subscription_end)&&new Date(sub.subscription_end).getTime()>now);
  const effectiveAllowed=sub.status==='payment_pending'||dateValid;
  return{allowed:Boolean(allowed)&&effectiveAllowed,status:sub.status,subscription:sub,reason:sub.status};
}

export async function syncSubscriptionStatuses(canteenId?:string){const {error}=await requireClient().rpc('sync_subscription_statuses',{p_canteen_id:canteenId||null});if(error)throw error}
export async function getPlatformStats(){const {data,error}=await requireClient().rpc('super_admin_platform_stats');if(error)throw error;return data as Record<string,number>}
export async function setSubscription(canteenId:string,action:string,planId?:string,trialDays?:number,billingCycle:BillingCycle='monthly',planSelectionMode?:PlanSelectionMode){
  const {data,error}=await requireClient().rpc('super_admin_set_subscription',{p_canteen_id:canteenId,p_action:action,p_plan_id:planId||null,p_trial_days:trialDays??null,p_amount:null,p_currency:null,p_billing_cycle:billingCycle,p_plan_selection_mode:planSelectionMode||null});
  if(error)throw error;
  return data as CanteenSubscription
}
export async function submitSubscriptionPayment(subscriptionId:string,amount:number,reference:string,paymentDate:string,note?:string){
  const {data,error}=await requireClient().rpc('canteen_submit_subscription_payment',{p_subscription_id:subscriptionId,p_amount:amount,p_reference:reference,p_payment_date:paymentDate,p_note:note||null});
  if(error)throw error;
  return data as SubscriptionPayment
}
export async function reviewSubscriptionPayment(paymentId:string,status:'paid'|'failed',billingCycle?:BillingCycle){
  const {data,error}=await requireClient().rpc('super_admin_review_subscription_payment',{p_payment_id:paymentId,p_status:status,p_billing_cycle:billingCycle||null});
  if(error)throw error;
  return data as SubscriptionPayment
}
export async function loadOwnSubscription(canteenId:string){
  await syncSubscriptionStatuses(canteenId);
  const c=requireClient();
  const [{data:subscription,error},{data:payments,paymentError},{data:plans,planError},{data:settings,settingsError},{count:memberCount,error:memberError}]=await Promise.all([
    c.from('canteen_subscriptions').select('*').eq('canteen_id',canteenId).maybeSingle(),
    c.from('subscription_payments').select('*').eq('canteen_id',canteenId).order('created_at',{ascending:false}),
    c.from('subscription_plans').select('*').eq('active',true).order('monthly_price'),
    c.from('subscription_payment_settings').select('*').eq('id',true).maybeSingle(),
    c.from('profiles').select('id',{count:'exact',head:true}).eq('canteen_id',canteenId).eq('role','employee').eq('status','active')
  ]);
  if(error)throw error;if(paymentError)throw paymentError;if(planError)throw planError;if(settingsError)throw settingsError;if(memberError)throw memberError;
  return{subscription:subscription as CanteenSubscription|null,payments:(payments||[]) as SubscriptionPayment[],plans:(plans||[]) as SubscriptionPlan[],settings:settings as SubscriptionPaymentSettings|null,memberCount:memberCount||0}
}
export async function loadPlatformData(){
  await syncSubscriptionStatuses();
  const c=requireClient();
  const [stats,can,profiles,plans,subs,payments,settings]=await Promise.all([
    getPlatformStats(),
    c.from('canteens').select('id,name,owner_id,created_at,updated_at,archived').order('name'),
    c.from('profiles').select('id,employee_code,sr_number,full_name,role,admin_role,status,canteen_id').order('full_name'),
    c.from('subscription_plans').select('*').order('created_at',{ascending:false}),
    c.from('canteen_subscriptions').select('*'),
    c.from('subscription_payments').select('*').order('created_at',{ascending:false}),
    c.from('subscription_payment_settings').select('*').eq('id',true).maybeSingle()
  ]);
  for(const x of [can,profiles,plans,subs,payments,settings])if(x.error)throw x.error;
  return{stats,canteens:can.data||[],profiles:profiles.data||[],plans:(plans.data||[]) as SubscriptionPlan[],subscriptions:(subs.data||[]) as CanteenSubscription[],payments:(payments.data||[]) as SubscriptionPayment[],settings:settings.data as SubscriptionPaymentSettings|null}
}
export async function createPlan(input:Pick<SubscriptionPlan,'name'|'description'|'pricing_model'|'min_members'|'max_members'|'monthly_price'|'annual_price'|'currency'|'trial_days'|'active'|'is_default'>){
  const {data,error}=await requireClient().from('subscription_plans').insert({...input,price:input.monthly_price,billing_period:'monthly'}).select('*').single();
  if(error)throw error;return data as SubscriptionPlan
}
export async function updatePlan(id:string,input:Partial<Pick<SubscriptionPlan,'name'|'description'|'pricing_model'|'min_members'|'max_members'|'monthly_price'|'annual_price'|'currency'|'trial_days'|'active'|'is_default'>>){
  const patch={...input,...(input.monthly_price!==undefined?{price:input.monthly_price,billing_period:'monthly'}:{}) ,updated_at:new Date().toISOString()};
  const {data,error}=await requireClient().from('subscription_plans').update(patch).eq('id',id).select('*').single();
  if(error)throw error;return data as SubscriptionPlan
}
export async function setDefaultPlan(id:string){const {data,error}=await requireClient().rpc('super_admin_set_plan_default',{p_plan_id:id});if(error)throw error;return data as SubscriptionPlan}
export async function deletePlan(id:string){const {error}=await requireClient().rpc('super_admin_delete_plan',{p_plan_id:id});if(error)throw error}
export async function loadPaymentSettings(){const {data,error}=await requireClient().from('subscription_payment_settings').select('*').eq('id',true).maybeSingle();if(error)throw error;return data as SubscriptionPaymentSettings|null}
export async function updatePaymentSettings(input:{manual_payment_enabled:boolean;upi_id:string;payment_display_name:string;payment_instructions:string;bank_payment_details:string}){const {data,error}=await requireClient().rpc('super_admin_update_subscription_payment_settings',{p_payment_provider:'manual',p_manual_payment_enabled:input.manual_payment_enabled,p_upi_id:input.upi_id||null,p_payment_display_name:input.payment_display_name||null,p_payment_instructions:input.payment_instructions||null,p_bank_payment_details:input.bank_payment_details||null,p_razorpay_enabled:false});if(error)throw error;return data as SubscriptionPaymentSettings}
export async function archiveCanteen(canteenId:string){const {data,error}=await requireClient().rpc('super_admin_archive_canteen',{p_canteen_id:canteenId});if(error)throw error;return data}
export async function restoreCanteen(canteenId:string){const {data,error}=await requireClient().rpc('super_admin_restore_canteen',{p_canteen_id:canteenId});if(error)throw error;return data}
export {planPrice};
