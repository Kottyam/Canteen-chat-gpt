import { supabase } from '../supabase';

export type SubscriptionStatus='trial'|'active'|'payment_pending'|'expired'|'suspended';
export type PaymentStatus='pending'|'paid'|'failed'|'refunded';
export type BillingCycle='monthly'|'annual';
export type BillingPeriod='monthly'|'quarterly'|'yearly';
export type PaymentProvider='manual'|'razorpay';
export type PricingModel='MEMBER_RANGE'|'FIXED_AMOUNT';
export type PlanSelectionMode='auto_range'|'manual';
export type PaymentType='subscription'|'renewal'|'plan_upgrade';

export interface SubscriptionPlanRange{id:string;plan_id:string;min_members:number;max_members:number;monthly_price:number;annual_price:number;created_at:string;updated_at:string;}
export interface SubscriptionPlan{
 id:string; name:string; description:string|null; pricing_model:PricingModel;
 monthly_price:number; annual_price:number; price:number; billing_period:BillingPeriod; billing_cycle:BillingCycle; billing_availability:'monthly'|'annual'|'monthly_annual';
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
 bank_payment_details:string|null; vendor_contact_email:string|null; created_at:string; updated_at:string;
}
export interface SubscriptionBillingQuote{required:boolean;plan_id?:string;plan_name?:string;pricing_model?:PricingModel;billing_cycle?:BillingCycle;amount?:number;currency?:string;member_count?:number;min_members?:number;max_members?:number;max_exceeded?:boolean;contact_email?:string;message?:string|null;}

export interface UpgradeQuote{
 required:boolean; active_members?:number; current_plan_id?:string; current_plan_name?:string;
 current_monthly_equivalent?:number; new_plan_id?:string; new_plan_name?:string;
 new_monthly_equivalent?:number; monthly_difference?:number; remaining_full_months?:number;
 additional_amount?:number; currency?:string; original_subscription_start?:string|null; original_subscription_end?:string|null;
 reason?:string;
}
const requireClient=()=>{if(!supabase)throw new Error('Supabase is not enabled.');return supabase};
const planPrice=(plan:SubscriptionPlan,cycle:BillingCycle)=>cycle==='annual'?plan.annual_price:plan.monthly_price;

export interface CanteenAccessState{allowed:boolean;status:SubscriptionStatus|null;subscription:CanteenSubscription|null;paymentStatus:PaymentStatus|null;reason:'trial'|'active'|'payment_pending'|'expired'|'suspended'|'unassigned'|'verification_error'}
export async function loadCanteenAccessState(canteenId:string):Promise<CanteenAccessState>{
 const c=requireClient();
 await syncSubscriptionStatuses(canteenId);
 const {data:state,error:stateError}=await c.rpc('get_canteen_subscription_state',{p_canteen_id:canteenId});
 if(stateError)throw stateError;
 const subscription=(state?.subscription||null) as CanteenSubscription|null;
 return{
  allowed:Boolean(state?.allowed),
  status:(state?.status||null) as SubscriptionStatus|null,
  subscription,
  paymentStatus:(state?.payment_status||subscription?.payment_status||null) as PaymentStatus|null,
  reason:(state?.reason||'verification_error') as CanteenAccessState['reason']
 };
}
export async function syncSubscriptionStatuses(canteenId?:string){const{error}=await requireClient().rpc('sync_subscription_statuses',{p_canteen_id:canteenId||null});if(error)throw error}
export async function getPlatformStats(){const{data,error}=await requireClient().rpc('super_admin_platform_stats');if(error)throw error;return data as Record<string,number>}
export async function setSubscription(canteenId:string,action:string,planId?:string,trialDays?:number,billingCycle:BillingCycle='monthly',planSelectionMode?:PlanSelectionMode,amount?:number){const{data,error}=await requireClient().rpc('super_admin_set_subscription',{p_canteen_id:canteenId,p_action:action,p_plan_id:planId||null,p_trial_days:trialDays??null,p_amount:amount??null,p_currency:null,p_billing_cycle:billingCycle,p_plan_selection_mode:planSelectionMode||null});if(error)throw error;return data as CanteenSubscription}
export async function submitSubscriptionPayment(subscriptionId:string,billingCycle:BillingCycle,reference:string,paymentDate:string,note?:string,paymentMethodId?:string){const{data,error}=await requireClient().rpc('canteen_create_subscription_payment',{p_subscription_id:subscriptionId,p_billing_cycle:billingCycle,p_payment_date:paymentDate,p_reference:reference,p_note:note||null,p_payment_method_id:paymentMethodId||null});if(error)throw error;return data as SubscriptionPayment}
export async function submitPlanUpgradePayment(newPlanId:string,paymentDate:string,reference:string,note?:string,paymentMethodId?:string){const{data,error}=await requireClient().rpc('canteen_submit_plan_upgrade_payment',{p_new_plan_id:newPlanId,p_payment_date:paymentDate,p_reference:reference,p_note:note||null,p_payment_method_id:paymentMethodId||null});if(error)throw error;return data as SubscriptionPayment}
export async function getSubscriptionUpgradeQuote(canteenId:string,newPlanId?:string){const{data,error}=await requireClient().rpc('get_subscription_upgrade_quote',{p_canteen_id:canteenId,p_new_plan_id:newPlanId||null});if(error)throw error;return data as UpgradeQuote}
export async function reviewSubscriptionPayment(paymentId:string,status:'paid'|'failed',billingCycle?:BillingCycle){const{data,error}=await requireClient().rpc('super_admin_review_subscription_payment',{p_payment_id:paymentId,p_status:status,p_billing_cycle:billingCycle||null});if(error)throw error;return data as SubscriptionPayment}
export async function getSubscriptionBillingQuote(canteenId:string,billingCycle?:BillingCycle){const{data,error}=await requireClient().rpc('get_subscription_billing_quote',{p_canteen_id:canteenId,p_billing_cycle:billingCycle||null});if(error)throw error;return data as SubscriptionBillingQuote}
export async function loadOwnSubscription(canteenId:string){
 const access=await loadCanteenAccessState(canteenId); const c=requireClient();
 const [{data:subscription,error},{data:payments,paymentError},{data:plans,planError},{data:settings,settingsError},{data:methods,methodsError},{count:memberCount,error:memberError},{data:billingQuote,billingQuoteError}]=await Promise.all([
  c.from('canteen_subscriptions').select('*').eq('canteen_id',canteenId).maybeSingle(),
  c.from('subscription_payments').select('*').eq('canteen_id',canteenId).order('created_at',{ascending:false}),
  c.from('subscription_plans').select('*').eq('active',true).order('monthly_price'),
  c.from('subscription_payment_settings').select('*').eq('id',true).maybeSingle(),
  c.from('subscription_payment_methods').select('*').eq('active',true).order('is_default',{ascending:false}).order('created_at',{ascending:true}),
  c.from('profiles').select('id',{count:'exact',head:true}).eq('canteen_id',canteenId).eq('role','employee').eq('status','active'),
  c.rpc('get_subscription_billing_quote',{p_canteen_id:canteenId})
 ]);
 if(error)throw error;if(paymentError)throw paymentError;if(planError)throw planError;if(settingsError)throw settingsError;if(methodsError)throw methodsError;if(memberError)throw memberError;if(billingQuoteError)throw billingQuoteError;
 let upgradeQuote:UpgradeQuote|null=null;
 if(subscription?.status==='active'&&subscription.billing_cycle==='annual'){try{upgradeQuote=await getSubscriptionUpgradeQuote(canteenId)}catch{upgradeQuote=null}}
 return{access,subscription:(access.subscription||subscription||null) as CanteenSubscription|null,payments:(payments||[]) as SubscriptionPayment[],plans:(plans||[]) as SubscriptionPlan[],settings:settings as SubscriptionPaymentSettings|null,paymentMethods:(methods||[]) as PaymentMethod[],memberCount:memberCount||0,billingQuote:(billingQuote||null) as SubscriptionBillingQuote|null,upgradeQuote};
}
export async function loadSuperAdminUsageAudit(startDate:string,endDate:string,canteenId?:string){const{data,error}=await requireClient().rpc('get_super_admin_usage_audit',{p_start_date:startDate,p_end_date:endDate,p_canteen_id:canteenId||null});if(error)throw error;return data as any}
export async function loadPlatformData(){
 await syncSubscriptionStatuses(); const c=requireClient();
 const [stats,can,profiles,plans,planRanges,subs,payments,settings,methods]=await Promise.all([
  getPlatformStats(),c.from('canteens').select('id,name,owner_id,created_at,updated_at,archived').order('name'),
  c.from('profiles').select('id,employee_code,sr_number,full_name,role,admin_role,status,canteen_id').order('full_name'),
  c.from('subscription_plans').select('*').order('created_at',{ascending:false}),c.from('subscription_plan_ranges').select('*').order('min_members'),c.from('canteen_subscriptions').select('*'),
  c.from('subscription_payments').select('*').order('created_at',{ascending:false}),
  c.from('subscription_payment_settings').select('*').eq('id',true).maybeSingle(),
  c.from('subscription_payment_methods').select('*').order('created_at',{ascending:false})
 ]);
 for(const x of [can,profiles,plans,planRanges,subs,payments,settings,methods])if(x.error)throw x.error;
 return{stats,canteens:can.data||[],profiles:profiles.data||[],plans:(plans.data||[]) as SubscriptionPlan[],planRanges:(planRanges.data||[]) as SubscriptionPlanRange[],subscriptions:(subs.data||[]) as CanteenSubscription[],payments:(payments.data||[]) as SubscriptionPayment[],settings:settings.data as SubscriptionPaymentSettings|null,paymentMethods:(methods.data||[]) as PaymentMethod[]};
}
export type PlanRangeInput={min_members:number;max_members:number;monthly_price:number;annual_price:number};
export type BillingAvailability='monthly'|'annual'|'monthly_annual';\nexport type PlanUpsertInput={name:string;description:string|null;pricing_model:PricingModel;billing_availability:BillingAvailability;currency:string;monthly_price?:number|null;annual_price?:number|null;ranges:PlanRangeInput[];active:boolean;is_default:boolean};
export async function createPlan(input:PlanUpsertInput){const{data,error}=await requireClient().rpc('super_admin_upsert_subscription_plan',{p_plan_id:null,p_name:input.name,p_description:input.description,p_pricing_model:input.pricing_model,p_billing_availability:input.billing_availability,p_currency:input.currency,p_monthly_price:input.monthly_price??null,p_annual_price:input.annual_price??null,p_ranges:input.ranges,p_active:input.active,p_is_default:input.is_default});if(error)throw error;return data as SubscriptionPlan}
export async function updatePlan(id:string,input:PlanUpsertInput){const{data,error}=await requireClient().rpc('super_admin_upsert_subscription_plan',{p_plan_id:id,p_name:input.name,p_description:input.description,p_pricing_model:input.pricing_model,p_billing_availability:input.billing_availability,p_currency:input.currency,p_monthly_price:input.monthly_price??null,p_annual_price:input.annual_price??null,p_ranges:input.ranges,p_active:input.active,p_is_default:input.is_default});if(error)throw error;return data as SubscriptionPlan}
export async function setDefaultPlan(id:string){const{data,error}=await requireClient().rpc('super_admin_set_plan_default',{p_plan_id:id});if(error)throw error;return data as SubscriptionPlan}
export async function deletePlan(id:string){const{error}=await requireClient().rpc('super_admin_delete_plan',{p_plan_id:id});if(error)throw error}
export async function loadPaymentSettings(){const{data,error}=await requireClient().from('subscription_payment_settings').select('*').eq('id',true).maybeSingle();if(error)throw error;return data as SubscriptionPaymentSettings|null}
export async function setVendorContactEmail(email:string){const{data,error}=await requireClient().rpc('super_admin_set_vendor_contact_email',{p_email:email});if(error)throw error;return data as SubscriptionPaymentSettings}
export async function updatePaymentSettings(input:{manual_payment_enabled:boolean;upi_id:string;payment_display_name:string;payment_instructions:string;bank_payment_details:string}){const{data,error}=await requireClient().rpc('super_admin_update_subscription_payment_settings',{p_payment_provider:'manual',p_manual_payment_enabled:input.manual_payment_enabled,p_upi_id:input.upi_id||null,p_payment_display_name:input.payment_display_name||null,p_payment_instructions:input.payment_instructions||null,p_bank_payment_details:input.bank_payment_details||null,p_razorpay_enabled:false});if(error)throw error;return data as SubscriptionPaymentSettings}
export async function savePaymentMethod(input:{id?:string;provider?:PaymentProvider;methodType:'upi'|'bank'|'razorpay';displayName:string;upiId?:string;active:boolean;isDefault:boolean}){const{data,error}=await requireClient().rpc('super_admin_set_payment_method',{p_method_id:input.id||null,p_provider:input.provider||'manual',p_method_type:input.methodType,p_display_name:input.displayName,p_upi_id:input.upiId||null,p_active:input.active,p_is_default:input.isDefault,p_action:'upsert'});if(error)throw error;return data as PaymentMethod}
export async function deactivatePaymentMethod(id:string){const{data,error}=await requireClient().rpc('super_admin_set_payment_method',{p_method_id:id,p_action:'deactivate'});if(error)throw error;return data as PaymentMethod}
export async function deletePaymentMethod(id:string){const{data,error}=await requireClient().rpc('super_admin_set_payment_method',{p_method_id:id,p_action:'delete'});if(error)throw error;return data as PaymentMethod}
export async function archiveCanteen(canteenId:string){const{data,error}=await requireClient().rpc('super_admin_archive_canteen',{p_canteen_id:canteenId});if(error)throw error;return data}
export async function restoreCanteen(canteenId:string){const{data,error}=await requireClient().rpc('super_admin_restore_canteen',{p_canteen_id:canteenId});if(error)throw error;return data}
export{planPrice};
