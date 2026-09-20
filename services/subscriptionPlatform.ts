import { supabase } from '../supabase';

export type SubscriptionStatus='trial'|'active'|'payment_pending'|'expired'|'suspended';
export type PaymentStatus='pending'|'paid'|'failed'|'refunded';
export type BillingCycle='monthly'|'annual';
export type BillingPeriod='monthly'|'quarterly'|'yearly';
export type PaymentProvider='manual'|'razorpay';
export type PricingModel='MEMBER_RANGE'|'FIXED_AMOUNT';
export type PlanSelectionMode='auto_range'|'manual';
export type PaymentType='subscription'|'renewal'|'plan_upgrade';

export interface SubscriptionPlan{
 id:string; name:string; description:string|null; pricing_model:PricingModel;
 monthly_price:number; annual_price:number; price:number; billing_period:BillingPeriod;
 currency:string; trial_days:number; active:boolean; is_default:boolean;
 min_members:number|null; max_members:number|null; created_at:string; updated_at:string;
}
export interface CanteenSubscription{
 id:string; canteen_id:string; plan_id:string; status:SubscriptionStatus;
 trial_start:string|null; trial_end:string|null; subscription_start:string|null; subscription_end:string|null;
 amount:number; currency:string; payment_status:PaymentStatus; billing_cycle:BillingCycle;
 plan_selection_mode:PlanSelectionMode; created_at:string; updated_at:string;
}
export interface PaymentMethod{
 id:string; provider:PaymentProvider; method_type:'upi'|'bank'|'razorpay';
 display_name:string; upi_id:string|null; active:boolean; is_default:boolean; created_at:string; updated_at:string;
}
export interface SubscriptionPayment{
 id:string; canteen_id:string; subscription_id:string; plan_id:string; amount:number; currency:string;
 payment_date:string|null; payment_status:PaymentStatus; transaction_reference:string|null;
 payment_provider:PaymentProvider; payment_note:string|null; billing_cycle:BillingCycle|null;
 billing_period_start:string|null; billing_period_end:string|null; payment_type:PaymentType;
 payment_method_id:string|null; payment_method_reference:string|null; payment_method_snapshot:Record<string,unknown>|null;
 provider_order_id:string|null; provider_payment_id:string|null; provider_signature:string|null;
 provider_verification_status:string|null; created_at:string; updated_at:string;
}
export interface SubscriptionPaymentSettings{
 id:boolean; payment_provider:PaymentProvider; manual_payment_enabled:boolean; razorpay_enabled:boolean;
 upi_id:string|null; payment_display_name:string|null; payment_instructions:string|null;
 bank_payment_details:string|null; created_at:string; updated_at:string;
}
export interface UpgradeQuote{
 required:boolean; active_members?:number; current_plan_id?:string; current_plan_name?:string;
 current_monthly_equivalent?:number; new_plan_id?:string; new_plan_name?:string;
 new_monthly_equivalent?:number; monthly_difference?:number; remaining_full_months?:number;
 additional_amount?:number; currency?:string; original_subscription_start?:string|null; original_subscription_end?:string|null;
 reason?:string;
}
const requireClient=()=>{if(!supabase)throw new Error('Supabase is not enabled.');return supabase};
const planPrice=(plan:SubscriptionPlan,cycle:BillingCycle)=>cycle==='annual'?plan.annual_price:plan.monthly_price;

export interface CanteenAccessState{allowed:boolean;status:SubscriptionStatus|null;subscription:CanteenSubscription|null;reason:'trial'|'active'|'payment_pending'|'expired'|'suspended'|'unassigned'|'verification_error'}
export async function loadCanteenAccessState(canteenId:string):Promise<CanteenAccessState>{
 const c=requireClient(); await syncSubscriptionStatuses(canteenId);
 const {data:allowed,error:accessError}=await c.rpc('can_canteen_operate',{p_canteen_id:canteenId}); if(accessError)throw accessError;
 const {data:subscription,error}=await c.from('canteen_subscriptions').select('*').eq('canteen_id',canteenId).maybeSingle(); if(error)throw error;
 if(!subscription)return{allowed:Boolean(allowed),status:null,subscription:null,reason:allowed?'payment_pending':'verification_error'};
 const sub=subscription as CanteenSubscription; const now=Date.now();
 const dateValid=(sub.status==='trial'&&!!sub.trial_end&&new Date(sub.trial_end).getTime()>now)||(sub.status==='active'&&!!sub.subscription_end&&new Date(sub.subscription_end).getTime()>now);
 const effectiveAllowed=dateValid||(sub.status==='payment_pending'&&((sub.trial_end&&new Date(sub.trial_end).getTime()>now)||(sub.subscription_end&&new Date(sub.subscription_end).getTime()>now)));
 return{allowed:Boolean(allowed)&&effectiveAllowed,status:sub.status,subscription:sub,reason:sub.status};
}
export async function syncSubscriptionStatuses(canteenId?:string){const{error}=await requireClient().rpc('sync_subscription_statuses',{p_canteen_id:canteenId||null});if(error)throw error}
export async function getPlatformStats(){const{data,error}=await requireClient().rpc('super_admin_platform_stats');if(error)throw error;return data as Record<string,number>}
export async function setSubscription(canteenId:string,action:string,planId?:string,trialDays?:number,billingCycle:BillingCycle='monthly',planSelectionMode?:PlanSelectionMode){const{data,error}=await requireClient().rpc('super_admin_set_subscription',{p_canteen_id:canteenId,p_action:action,p_plan_id:planId||null,p_trial_days:trialDays??null,p_amount:null,p_currency:null,p_billing_cycle:billingCycle,p_plan_selection_mode:planSelectionMode||null});if(error)throw error;return data as CanteenSubscription}
export async function submitSubscriptionPayment(subscriptionId:string,billingCycle:BillingCycle,reference:string,paymentDate:string,note?:string,paymentMethodId?:string){const{data,error}=await requireClient().rpc('canteen_create_subscription_payment',{p_subscription_id:subscriptionId,p_billing_cycle:billingCycle,p_payment_date:paymentDate,p_reference:reference,p_note:note||null,p_payment_method_id:paymentMethodId||null});if(error)throw error;return data as SubscriptionPayment}
export async function submitPlanUpgradePayment(newPlanId:string,paymentDate:string,reference:string,note?:string,paymentMethodId?:string){const{data,error}=await requireClient().rpc('canteen_submit_plan_upgrade_payment',{p_new_plan_id:newPlanId,p_payment_date:paymentDate,p_reference:reference,p_note:note||null,p_payment_method_id:paymentMethodId||null});if(error)throw error;return data as SubscriptionPayment}
export async function getSubscriptionUpgradeQuote(canteenId:string,newPlanId?:string){const{data,error}=await requireClient().rpc('get_subscription_upgrade_quote',{p_canteen_id:canteenId,p_new_plan_id:newPlanId||null});if(error)throw error;return data as UpgradeQuote}
export async function reviewSubscriptionPayment(paymentId:string,status:'paid'|'failed',billingCycle?:BillingCycle){const{data,error}=await requireClient().rpc('super_admin_review_subscription_payment',{p_payment_id:paymentId,p_status:status,p_billing_cycle:billingCycle||null});if(error)throw error;return data as SubscriptionPayment}
export async function loadOwnSubscription(canteenId:string){
 await syncSubscriptionStatuses(canteenId); const c=requireClient();
 const [{data:subscription,error},{data:payments,paymentError},{data:plans,planError},{data:settings,settingsError},{data:methods,methodsError},{count:memberCount,error:memberError}]=await Promise.all([
  c.from('canteen_subscriptions').select('*').eq('canteen_id',canteenId).maybeSingle(),
  c.from('subscription_payments').select('*').eq('canteen_id',canteenId).order('created_at',{ascending:false}),
  c.from('subscription_plans').select('*').eq('active',true).order('monthly_price'),
  c.from('subscription_payment_settings').select('*').eq('id',true).maybeSingle(),
  c.from('subscription_payment_methods').select('*').eq('active',true).order('is_default',{ascending:false}).order('created_at',{ascending:true}),
  c.from('profiles').select('id',{count:'exact',head:true}).eq('canteen_id',canteenId).eq('role','employee').eq('status','active')
 ]);
 if(error)throw error;if(paymentError)throw paymentError;if(planError)throw planError;if(settingsError)throw settingsError;if(methodsError)throw methodsError;if(memberError)throw memberError;
 let upgradeQuote:UpgradeQuote|null=null;
 if(subscription?.status==='active'&&subscription.billing_cycle==='annual'){try{upgradeQuote=await getSubscriptionUpgradeQuote(canteenId)}catch{upgradeQuote=null}}
 return{subscription:subscription as CanteenSubscription|null,payments:(payments||[]) as SubscriptionPayment[],plans:(plans||[]) as SubscriptionPlan[],settings:settings as SubscriptionPaymentSettings|null,paymentMethods:(methods||[]) as PaymentMethod[],memberCount:memberCount||0,upgradeQuote};
}
export async function loadPlatformData(){
 await syncSubscriptionStatuses(); const c=requireClient();
 const [stats,can,profiles,plans,subs,payments,settings,methods]=await Promise.all([
  getPlatformStats(),c.from('canteens').select('id,name,owner_id,created_at,updated_at,archived').order('name'),
  c.from('profiles').select('id,employee_code,sr_number,full_name,role,admin_role,status,canteen_id').order('full_name'),
  c.from('subscription_plans').select('*').order('created_at',{ascending:false}),c.from('canteen_subscriptions').select('*'),
  c.from('subscription_payments').select('*').order('created_at',{ascending:false}),
  c.from('subscription_payment_settings').select('*').eq('id',true).maybeSingle(),
  c.from('subscription_payment_methods').select('*').order('created_at',{ascending:false})
 ]);
 for(const x of [can,profiles,plans,subs,payments,settings,methods])if(x.error)throw x.error;
 return{stats,canteens:can.data||[],profiles:profiles.data||[],plans:(plans.data||[]) as SubscriptionPlan[],subscriptions:(subs.data||[]) as CanteenSubscription[],payments:(payments.data||[]) as SubscriptionPayment[],settings:settings.data as SubscriptionPaymentSettings|null,paymentMethods:(methods.data||[]) as PaymentMethod[]};
}
export async function createPlan(input:Pick<SubscriptionPlan,'name'|'description'|'pricing_model'|'min_members'|'max_members'|'monthly_price'|'annual_price'|'currency'|'trial_days'|'active'|'is_default'>){const{data,error}=await requireClient().from('subscription_plans').insert({...input,price:input.monthly_price,billing_period:'monthly'}).select('*').single();if(error)throw error;return data as SubscriptionPlan}
export async function updatePlan(id:string,input:Partial<Pick<SubscriptionPlan,'name'|'description'|'pricing_model'|'min_members'|'max_members'|'monthly_price'|'annual_price'|'currency'|'trial_days'|'active'|'is_default'>>){const patch={...input,...(input.monthly_price!==undefined?{price:input.monthly_price,billing_period:'monthly'}:{}),updated_at:new Date().toISOString()};const{data,error}=await requireClient().from('subscription_plans').update(patch).eq('id',id).select('*').single();if(error)throw error;return data as SubscriptionPlan}
export async function setDefaultPlan(id:string){const{data,error}=await requireClient().rpc('super_admin_set_plan_default',{p_plan_id:id});if(error)throw error;return data as SubscriptionPlan}
export async function deletePlan(id:string){const{error}=await requireClient().rpc('super_admin_delete_plan',{p_plan_id:id});if(error)throw error}
export async function loadPaymentSettings(){const{data,error}=await requireClient().from('subscription_payment_settings').select('*').eq('id',true).maybeSingle();if(error)throw error;return data as SubscriptionPaymentSettings|null}
export async function updatePaymentSettings(input:{manual_payment_enabled:boolean;upi_id:string;payment_display_name:string;payment_instructions:string;bank_payment_details:string}){const{data,error}=await requireClient().rpc('super_admin_update_subscription_payment_settings',{p_payment_provider:'manual',p_manual_payment_enabled:input.manual_payment_enabled,p_upi_id:input.upi_id||null,p_payment_display_name:input.payment_display_name||null,p_payment_instructions:input.payment_instructions||null,p_bank_payment_details:input.bank_payment_details||null,p_razorpay_enabled:false});if(error)throw error;return data as SubscriptionPaymentSettings}
export async function savePaymentMethod(input:{id?:string;provider?:PaymentProvider;methodType:'upi'|'bank'|'razorpay';displayName:string;upiId?:string;active:boolean;isDefault:boolean}){const{data,error}=await requireClient().rpc('super_admin_set_payment_method',{p_method_id:input.id||null,p_provider:input.provider||'manual',p_method_type:input.methodType,p_display_name:input.displayName,p_upi_id:input.upiId||null,p_active:input.active,p_is_default:input.isDefault,p_action:'upsert'});if(error)throw error;return data as PaymentMethod}
export async function deactivatePaymentMethod(id:string){const{data,error}=await requireClient().rpc('super_admin_set_payment_method',{p_method_id:id,p_action:'deactivate'});if(error)throw error;return data as PaymentMethod}
export async function deletePaymentMethod(id:string){const{data,error}=await requireClient().rpc('super_admin_set_payment_method',{p_method_id:id,p_action:'delete'});if(error)throw error;return data as PaymentMethod}
export async function archiveCanteen(canteenId:string){const{data,error}=await requireClient().rpc('super_admin_archive_canteen',{p_canteen_id:canteenId});if(error)throw error;return data}
export async function restoreCanteen(canteenId:string){const{data,error}=await requireClient().rpc('super_admin_restore_canteen',{p_canteen_id:canteenId});if(error)throw error;return data}
export{planPrice};
