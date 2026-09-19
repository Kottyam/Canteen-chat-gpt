import { supabase } from '../supabase';

export type SubscriptionStatus='trial'|'active'|'payment_pending'|'expired'|'suspended';
export type PaymentStatus='pending'|'paid'|'failed'|'refunded';
export type BillingPeriod='monthly'|'quarterly'|'yearly';

export interface SubscriptionPlan{id:string;name:string;description:string|null;price:number;billing_period:BillingPeriod;currency:string;trial_days:number;active:boolean;is_default:boolean;created_at:string;updated_at:string}
export interface CanteenSubscription{id:string;canteen_id:string;plan_id:string;status:SubscriptionStatus;trial_start:string|null;trial_end:string|null;subscription_start:string|null;subscription_end:string|null;amount:number;currency:string;payment_status:PaymentStatus;created_at:string;updated_at:string}
export interface SubscriptionPayment{id:string;canteen_id:string;subscription_id:string;plan_id:string;amount:number;currency:string;payment_date:string|null;payment_status:PaymentStatus;transaction_reference:string|null;billing_period_start:string|null;billing_period_end:string|null;created_at:string;updated_at:string}

const requireClient=()=>{if(!supabase)throw new Error('Supabase is not enabled.');return supabase};

export interface CanteenAccessState{allowed:boolean;status:SubscriptionStatus|null;subscription:CanteenSubscription|null;reason:'trial'|'active'|'payment_pending'|'expired'|'suspended'|'unassigned'|'verification_error'}

export async function loadCanteenAccessState(canteenId:string):Promise<CanteenAccessState>{
  const c=requireClient();
  await syncSubscriptionStatuses(canteenId);
  const {data:allowed,error:accessError}=await c.rpc('can_canteen_operate',{p_canteen_id:canteenId});
  if(accessError)throw accessError;
  const {data:subscription,error}=await c.from('canteen_subscriptions').select('*').eq('canteen_id',canteenId).maybeSingle();
  if(error)throw error;
  if(!subscription){
    return{allowed:Boolean(allowed),status:null,subscription:null,reason:allowed?'payment_pending':'verification_error'};
  }
  const sub=subscription as CanteenSubscription;
  const now=Date.now();
  const dateValid=(sub.status==='trial'&&Boolean(sub.trial_end)&&new Date(sub.trial_end).getTime()>now)||(sub.status==='active'&&Boolean(sub.subscription_end)&&new Date(sub.subscription_end).getTime()>now);
  const effectiveAllowed=sub.status==='payment_pending'||dateValid;
  return{allowed:Boolean(allowed)&&effectiveAllowed,status:sub.status,subscription:sub,reason:sub.status};
}

export async function syncSubscriptionStatuses(canteenId?:string){const {error}=await requireClient().rpc('sync_subscription_statuses',{p_canteen_id:canteenId||null});if(error)throw error}
export async function getPlatformStats(){const {data,error}=await requireClient().rpc('super_admin_platform_stats');if(error)throw error;return data as Record<string,number>}
export async function setSubscription(canteenId:string,action:string,planId?:string,trialDays?:number){const {data,error}=await requireClient().rpc('super_admin_set_subscription',{p_canteen_id:canteenId,p_action:action,p_plan_id:planId||null,p_trial_days:trialDays??null,p_amount:null,p_currency:null});if(error)throw error;return data as CanteenSubscription}
export async function submitSubscriptionPayment(subscriptionId:string,amount:number,reference:string,paymentDate:string){const {data,error}=await requireClient().rpc('canteen_submit_subscription_payment',{p_subscription_id:subscriptionId,p_amount:amount,p_reference:reference,p_payment_date:paymentDate});if(error)throw error;return data as SubscriptionPayment}
export async function reviewSubscriptionPayment(paymentId:string,status:'paid'|'failed'){const {data,error}=await requireClient().rpc('super_admin_review_subscription_payment',{p_payment_id:paymentId,p_status:status});if(error)throw error;return data as SubscriptionPayment}
export async function loadOwnSubscription(canteenId:string){await syncSubscriptionStatuses(canteenId);const c=requireClient();const [{data:subscription,error},{data:payments,paymentError},{data:plans,planError}]=await Promise.all([c.from('canteen_subscriptions').select('*').eq('canteen_id',canteenId).maybeSingle(),c.from('subscription_payments').select('*').eq('canteen_id',canteenId).order('created_at',{ascending:false}),c.from('subscription_plans').select('*').eq('active',true).order('price')]);if(error)throw error;if(paymentError)throw paymentError;if(planError)throw planError;return{subscription:subscription as CanteenSubscription|null,payments:(payments||[]) as SubscriptionPayment[],plans:(plans||[]) as SubscriptionPlan[]}}
export async function loadPlatformData(){await syncSubscriptionStatuses();const c=requireClient();const [stats,can,profiles,plans,subs,payments]=await Promise.all([getPlatformStats(),c.from('canteens').select('id,name,owner_id,created_at,updated_at').order('name'),c.from('profiles').select('id,employee_code,sr_number,full_name,role,admin_role,status,canteen_id').order('full_name'),c.from('subscription_plans').select('*').order('created_at',{ascending:false}),c.from('canteen_subscriptions').select('*'),c.from('subscription_payments').select('*').order('created_at',{ascending:false})]);for(const x of [can,profiles,plans,subs,payments])if(x.error)throw x.error;return{stats,canteens:can.data||[],profiles:profiles.data||[],plans:(plans.data||[]) as SubscriptionPlan[],subscriptions:(subs.data||[]) as CanteenSubscription[],payments:(payments.data||[]) as SubscriptionPayment[]}}
export async function createPlan(input:Pick<SubscriptionPlan,'name'|'description'|'price'|'billing_period'|'currency'|'trial_days'|'active'|'is_default'>){const {data,error}=await requireClient().from('subscription_plans').insert(input).select('*').single();if(error)throw error;return data as SubscriptionPlan}
export async function updatePlan(id:string,input:Partial<Pick<SubscriptionPlan,'name'|'description'|'price'|'billing_period'|'currency'|'trial_days'|'active'|'is_default'>>){const {data,error}=await requireClient().from('subscription_plans').update({...input,updated_at:new Date().toISOString()}).eq('id',id).select('*').single();if(error)throw error;return data as SubscriptionPlan}

export async function setDefaultPlan(id:string){const {data,error}=await requireClient().rpc('super_admin_set_plan_default',{p_plan_id:id});if(error)throw error;return data as SubscriptionPlan}
export async function deletePlan(id:string){const {error}=await requireClient().rpc('super_admin_delete_plan',{p_plan_id:id});if(error)throw error}
