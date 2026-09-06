import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...corsHeaders,"Content-Type":"application/json"}});
const normalizeMobile=(value:string)=>{const digits=String(value||'').trim().replace(/[^0-9]/g,'');return /^91[6-9][0-9]{9}$/.test(digits)?digits.slice(-10):digits};
const validMobile=(value:string)=>/^[6-9][0-9]{9}$/.test(value);
const duplicateMessage=(sameCanteen:boolean)=>sameCanteen?'This mobile number is already registered as a Member in this Canteen. This Member cannot be created.':'This mobile number is already registered as a Member in another Canteen. This Member cannot be created.';

Deno.serve(async(req:Request)=>{
 if(req.method==='OPTIONS')return new Response('ok',{status:200,headers:corsHeaders});
 try{
  if(req.method!=='POST')return json({error:'Method not allowed'},405);
  const url=Deno.env.get('SUPABASE_URL')!,key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,admin=createClient(url,key,{auth:{autoRefreshToken:false,persistSession:false}});
  const body=await req.json(),action=String(body.action||'create'),employeeCode=String(body.employee_code||'').trim(),password=String(body.password||''),fullName=String(body.full_name||'').trim(),suppliedMobile=String(body.mobile_number||'').trim();
  const authHeader=req.headers.get('Authorization');
  if(!authHeader)return json({error:'Your Admin session has expired. Please log in again.'},401);
  const token=authHeader.replace(/^Bearer\s+/i,'').trim();
  if(!token)return json({error:'Your Admin session has expired. Please log in again.'},401);
  const{data:{user:caller},error:callerError}=await admin.auth.getUser(token);
  if(callerError||!caller)return json({error:'Your Admin session has expired. Please log in again.'},401);
  const{data:callerProfile,error:profileError}=await admin.from('profiles').select('id,role,status,canteen_id,admin_role').eq('id',caller.id).maybeSingle();
  if(profileError)return json({error:'Unable to verify Admin access right now. Please try again.'},500);
  if(callerProfile?.role!=='admin'||callerProfile?.status!=='active'||!callerProfile?.canteen_id)return json({error:'You are not authorized to create Members.'},403);
  const callerCanteenId=callerProfile.canteen_id;
  const{data:ownerCanteen}=await admin.from('canteens').select('id').eq('id',callerCanteenId).eq('owner_id',caller.id).maybeSingle();
  const{data:memberPermission}=await admin.from('admin_permissions').select('admin_id').eq('admin_id',caller.id).eq('canteen_id',callerCanteenId).eq('permission','members').eq('enabled',true).maybeSingle();
  if(!ownerCanteen&&!memberPermission)return json({error:'You are not authorized to create Members.'},403);
  const{data:canteen,error:canteenError}=await admin.from('canteens').select('member_login_mode').eq('id',callerCanteenId).single();
  if(canteenError)return json({error:'Unable to determine the Admin Canteen right now. Please try again.'},500);
  if(canteen.member_login_mode==='mobile'&&action==='create'){
   if(!fullName)return json({error:'Please enter the Member name.'},400);
   const mobile=normalizeMobile(suppliedMobile);
   if(!validMobile(mobile))return json({error:'Please enter a valid mobile number.'},400);
   const{data:existingRows,error:existingError}=await admin.from('profiles').select('id,role,status,canteen_id,mobile_number_normalized').eq('mobile_number_normalized',mobile);
   if(existingError)return json({error:'Unable to validate the mobile number right now. Please try again.'},500);
   const existing=existingRows||[],active=existing.find(p=>p.status==='active');
   if(active)return json({error:duplicateMessage(active.canteen_id===callerCanteenId)},409);
   const nonMember=existing.find(p=>p.role!=='employee');
   if(nonMember)return json({error:'This mobile number is already registered and cannot be used for a Member.'},409);
   for(const deleted of existing.filter(p=>p.role==='employee'&&p.status!=='active')){
    const{error:deleteAuthError}=await admin.auth.admin.deleteUser(deleted.id);
    if(deleteAuthError&&!/not found|user.*does not exist/i.test(deleteAuthError.message||''))return json({error:'Unable to create Member account. Please try again.'},400);
   }
   const email=`${mobile}@gocanteen.local`;
   const{data:created,error:createError}=await admin.auth.admin.createUser({email,password:mobile,email_confirm:true,app_metadata:{role:'employee',member_login_mode:'mobile'},user_metadata:{mobile_number:mobile,full_name:fullName}});
   if(createError){if(/already|exists|duplicate/i.test(createError.message||''))return json({error:'This mobile number is already registered as a Member. This Member cannot be created.'},409);return json({error:'Unable to create Member account. Please try again.'},400)}
   const internalCode=`MOBILE-${created.user.id.replace(/-/g,'')}`;
   const{error:insertError}=await admin.from('profiles').insert({id:created.user.id,employee_code:internalCode,sr_number:null,full_name:fullName,mobile_number:mobile,role:'employee',status:'active',is_first_login:true,canteen_id:callerCanteenId,onboarding_completed:true});
   if(insertError){await admin.auth.admin.deleteUser(created.user.id);if(insertError.code==='23505')return json({error:'This mobile number is already registered as a Member. This Member cannot be created.'},409);return json({error:'Unable to create Member right now. Please try again.'},400)}
   return json({ok:true,employee_id:created.user.id,employee_code:internalCode,is_first_login:true});
  }
  if(canteen.member_login_mode==='mobile'&&action==='reset_password'){
   const mobile=normalizeMobile(String(body.mobile_number||employeeCode));if(!validMobile(mobile))return json({error:'Please enter a valid mobile number.'},400);
   const{data:profile,error:findError}=await admin.from('profiles').select('id,role,status,canteen_id,mobile_number').eq('mobile_number_normalized',mobile).eq('canteen_id',callerCanteenId).maybeSingle();
   if(findError||!profile||profile.role!=='employee')return json({error:'Member profile not found.'},404);if(profile.status!=='active')return json({error:'Member profile is not active.'},400);
   const{error:updateAuthError}=await admin.auth.admin.updateUserById(profile.id,{password:mobile,email:`${mobile}@gocanteen.local`,email_confirm:true,user_metadata:{mobile_number:mobile}});if(updateAuthError)return json({error:'Unable to reset Member password. Please try again.'},400);
   const{error:updateProfileError}=await admin.from('profiles').update({is_first_login:true}).eq('id',profile.id);if(updateProfileError)return json({error:'Unable to reset Member password. Please try again.'},400);return json({ok:true});
  }
  if(canteen.member_login_mode==='mobile'&&action==='update_mobile'){
   if(!fullName)return json({error:'Please enter the Member name.'},400);const oldMobile=normalizeMobile(String(body.current_mobile||'')),newMobile=normalizeMobile(suppliedMobile);if(!validMobile(oldMobile)||!validMobile(newMobile))return json({error:'Please enter a valid mobile number.'},400);
   const{data:profile,error:findError}=await admin.from('profiles').select('id,role,status,canteen_id,mobile_number').eq('mobile_number_normalized',oldMobile).eq('canteen_id',callerCanteenId).maybeSingle();if(findError||!profile||profile.role!=='employee')return json({error:'Member profile not found.'},404);if(profile.status!=='active')return json({error:'Member profile is not active.'},400);
   const{data:duplicate,error:duplicateError}=await admin.from('profiles').select('id,status,canteen_id').eq('mobile_number_normalized',newMobile).neq('id',profile.id).maybeSingle();if(duplicateError)return json({error:'Unable to validate the mobile number right now. Please try again.'},500);if(duplicate&&duplicate.status==='active')return json({error:duplicateMessage(duplicate.canteen_id===callerCanteenId)},409);
   if(newMobile===oldMobile){const{error:e}=await admin.from('profiles').update({full_name:fullName}).eq('id',profile.id);if(e)return json({error:'Could not save Member details.'},400);return json({ok:true})}
   const oldEmail=`${oldMobile}@gocanteen.local`,newEmail=`${newMobile}@gocanteen.local`;const{error:updateAuthError}=await admin.auth.admin.updateUserById(profile.id,{email:newEmail,email_confirm:true,user_metadata:{mobile_number:newMobile,full_name:fullName}});if(updateAuthError){if(/already|exists|duplicate/i.test(updateAuthError.message||''))return json({error:duplicateMessage(false)},409);return json({error:'Could not update Member login identity. Please try again.'},400)}
   const{error:updateProfileError}=await admin.from('profiles').update({full_name:fullName,mobile_number:newMobile}).eq('id',profile.id);if(updateProfileError){await admin.auth.admin.updateUserById(profile.id,{email:oldEmail,email_confirm:true,user_metadata:{mobile_number:oldMobile,full_name:fullName}});if(updateProfileError.code==='23505')return json({error:'This mobile number is already registered as a Member. This Member cannot be created.'},409);return json({error:'Could not save Member details.'},400)}return json({ok:true});
  }
  if(!/^\d{5}$/.test(employeeCode))return json({error:'Please enter a valid 5-digit SR Number.'},400);
  if(password.length<6)return json({error:'Invalid password'},400);
  if(action==='reset_password'){
   const{data:profile,error:findError}=await admin.from('profiles').select('id,canteen_id').or(`employee_code.eq.${employeeCode},sr_number.eq.${employeeCode}`).maybeSingle();if(findError||!profile)return json({error:'Member profile not found'},404);if(profile.canteen_id!==callerCanteenId)return json({error:'You are not authorized to manage this Member.'},403);
   const{error:updateAuthError}=await admin.auth.admin.updateUserById(profile.id,{password});if(updateAuthError)return json({error:'Unable to reset Member password. Please try again.'},400);const{error:updateProfileError}=await admin.from('profiles').update({is_first_login:true}).eq('id',profile.id).eq('canteen_id',callerCanteenId);if(updateProfileError)return json({error:'Unable to reset Member password. Please try again.'},400);return json({ok:true});
  }
  if(!fullName)return json({error:'Please enter the Member name.'},400);
  const{data:existing,error:existingError}=await admin.from('profiles').select('id,role,status,canteen_id').or(`employee_code.eq.${employeeCode},sr_number.eq.${employeeCode}`).maybeSingle();if(existingError)return json({error:'Unable to validate the Member right now. Please try again.'},500);
  if(existing){if(existing.role!=='employee')return json({error:'This SR Number belongs to a non-member profile.'},400);if(existing.canteen_id!==callerCanteenId)return json({error:'This SR Number belongs to another canteen.'},409);if(existing.status!=='deleted')return json({error:'Member already exists.'},409);const{error:updateAuthError}=await admin.auth.admin.updateUserById(existing.id,{password,user_metadata:{employee_code:employeeCode,full_name:fullName}});if(updateAuthError)return json({error:updateAuthError.message},400);const{error:restoreError}=await admin.from('profiles').update({employee_code:employeeCode,sr_number:employeeCode,full_name:fullName,mobile_number:String(body.mobile_number||'').trim()||null,role:'employee',status:'active',is_first_login:true,canteen_id:callerCanteenId}).eq('id',existing.id);if(restoreError)return json({error:restoreError.message},400);return json({ok:true,employee_id:existing.id,employee_code:employeeCode,is_first_login:true})}
  const email=`${employeeCode}@gocanteen.local`;const{data:created,error:createError}=await admin.auth.admin.createUser({email,password,email_confirm:true,app_metadata:{role:'employee'},user_metadata:{employee_code:employeeCode,full_name:fullName}});if(createError)return json({error:createError.message},400);const{error:insertError}=await admin.from('profiles').insert({id:created.user.id,employee_code:employeeCode,sr_number:employeeCode,full_name:fullName,mobile_number:String(body.mobile_number||'').trim()||null,role:'employee',status:'active',is_first_login:true,canteen_id:callerCanteenId,onboarding_completed:true});if(insertError){await admin.auth.admin.deleteUser(created.user.id);return json({error:insertError.message},400)}return json({ok:true,employee_id:created.user.id,employee_code:employeeCode,is_first_login:true});
 }catch(error){return json({error:error instanceof Error?error.message:'Unable to create Member right now. Please try again.'},500)}
});