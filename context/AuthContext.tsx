import React,{createContext,useContext,useState,useEffect,useCallback,ReactNode}from'react';
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { User } from '../types';
import { supabase,supabaseEnabled,internalEmailForLogin,GOOGLE_REDIRECT_URL } from '../supabase';
import { resetEmployeePassword } from '../services/supabaseSync';
import { DEFAULT_EMPLOYEE_PASSWORD } from '../constants';

interface AuthContextType{user:User|null;login:(user:User)=>void;loginWithCredentials:(userId:string,password:string,localUsers:User[])=>Promise<{ok:boolean;error?:string}>;loginWithGoogle:()=>Promise<{ok:boolean;error?:string}>;logout:()=>void;updateUser:(updatedUser:User)=>void;loading:boolean;}
const AuthContext=createContext<AuthContextType|undefined>(undefined);
const GENERIC_LOGIN_ERROR='Employee ID or password is incorrect.';

export const AuthProvider:React.FC<{children:ReactNode}>=({children})=>{
 const[user,setUser]=useState<User|null>(null);const[loading,setLoading]=useState(true);
 const clearInvalidSession=useCallback(async()=>{sessionStorage.removeItem('canteen_user');setUser(null);if(supabaseEnabled&&supabase){try{await supabase.auth.signOut()}catch{}}},[]);
 const ensureGoogleAdmin=useCallback(async(authUser:any)=>{if(!supabase||authUser?.app_metadata?.provider!=='google')return null;const{data,error}=await supabase.rpc('ensure_google_admin');if(error)throw error;return data as any},[]);
 const resolveAuthenticatedProfile=useCallback(async(authUser:any,requestedId?:string):Promise<User|null>=>{
   if(!supabase||!authUser?.id)return null;
   if(authUser.app_metadata?.provider==='google')await ensureGoogleAdmin(authUser);
   const{data:profile,error}=await supabase.from('profiles').select('id,employee_code,sr_number,full_name,mobile_number,role,status,is_first_login,canteen_id,onboarding_completed').eq('id',authUser.id).maybeSingle();
   if(error||!profile)return null;
   const employeeMatch=!requestedId||(String(profile.employee_code||'')===requestedId||String(profile.sr_number||'')===requestedId);
   if(!employeeMatch||String(profile.status||'')!=='active'||!['employee','admin'].includes(String(profile.role||'')))return null;
   let canteenName='';
   if(profile.canteen_id){const{data:c}=await supabase.from('canteens').select('name').eq('id',profile.canteen_id).maybeSingle();canteenName=c?.name||'';}
   return{id:profile.employee_code||profile.sr_number||profile.id,name:profile.full_name||'',mobile:profile.mobile_number||'',password:'',role:profile.role,status:profile.status,isFirstLogin:Boolean(profile.is_first_login),canteenId:profile.canteen_id||undefined,canteenName,needsCanteenSetup:profile.role==='admin'&&profile.onboarding_completed===false};
 },[ensureGoogleAdmin]);
 useEffect(()=>{let alive=true;let nativeHandle:{remove:()=>Promise<void>}|null=null;
   const handleUrl=async(url:string)=>{if(!supabase||!url.startsWith('gocanteen://auth/callback'))return;try{const parsed=new URL(url);const code=parsed.searchParams.get('code');if(code)await supabase.auth.exchangeCodeForSession(code);}catch(error){console.warn('Google callback handling failed.',error)}};
   const restore=async()=>{if(!supabaseEnabled||!supabase){const stored=sessionStorage.getItem('canteen_user');if(stored)try{if(alive)setUser(JSON.parse(stored))}catch{sessionStorage.removeItem('canteen_user')}if(alive)setLoading(false);return}
     try{const{data:{session}}=await supabase.auth.getSession();if(!alive)return;if(session?.user){const resolved=await resolveAuthenticatedProfile(session.user);if(alive&&resolved){sessionStorage.setItem('canteen_user',JSON.stringify(resolved));setUser(resolved)}else if(alive){await clearInvalidSession()}}else{sessionStorage.removeItem('canteen_user');setUser(null)}}catch{if(alive){sessionStorage.removeItem('canteen_user');setUser(null)}}if(alive)setLoading(false);
   };
   void restore();
   if(supabase){const{data:{subscription}}=supabase.auth.onAuthStateChange((_event,session)=>{void(async()=>{if(!alive)return;if(session?.user){try{const resolved=await resolveAuthenticatedProfile(session.user);if(resolved){sessionStorage.setItem('canteen_user',JSON.stringify(resolved));setUser(resolved)}else{await clearInvalidSession()}}catch{await clearInvalidSession()}}else{sessionStorage.removeItem('canteen_user');setUser(null)}})()});
     if(Capacitor.isNativePlatform()){void App.getLaunchUrl().then(result=>{if(result?.url)void handleUrl(result.url)});void App.addListener('appUrlOpen',event=>void handleUrl(event.url)).then(handle=>{nativeHandle=handle});}
     return()=>{alive=false;subscription.unsubscribe();if(nativeHandle)void nativeHandle.remove()}
   }
   return()=>{alive=false};
 },[clearInvalidSession,resolveAuthenticatedProfile]);
 const login=useCallback((u:User)=>{sessionStorage.setItem('canteen_user',JSON.stringify(u));setUser(u)},[]);
 const loginWithCredentials=useCallback(async(userId:string,password:string,localUsers:User[])=>{const local=localUsers.find(u=>u.id===userId);if(local&&(local.status==='blocked'||local.status==='deleted'))return{ok:false,error:GENERIC_LOGIN_ERROR};if(supabaseEnabled&&supabase){let{data,error}=await supabase.auth.signInWithPassword({email:internalEmailForLogin(userId),password});if(error&&local?.role==='employee'&&local.status==='active'&&local.isFirstLogin===true&&password===DEFAULT_EMPLOYEE_PASSWORD){try{await resetEmployeePassword(userId,DEFAULT_EMPLOYEE_PASSWORD);const retry=await supabase.auth.signInWithPassword({email:internalEmailForLogin(userId),password:DEFAULT_EMPLOYEE_PASSWORD});data=retry.data;error=retry.error}catch{}}if(!error&&data.user){const resolved=await resolveAuthenticatedProfile(data.user,userId);if(!resolved){await clearInvalidSession();return{ok:false,error:GENERIC_LOGIN_ERROR}}login(resolved);return{ok:true}}return{ok:false,error:GENERIC_LOGIN_ERROR}}if(!local||local.password!==password)return{ok:false,error:GENERIC_LOGIN_ERROR};login(local);return{ok:true}},[clearInvalidSession,login,resolveAuthenticatedProfile]);
 const loginWithGoogle=useCallback(async()=>{if(!supabaseEnabled||!supabase)return{ok:false,error:'Google sign-in is unavailable.'};try{const{error}=await supabase.auth.signInWithOAuth({provider:'google',options:{redirectTo:GOOGLE_REDIRECT_URL}});if(error)return{ok:false,error:error.message};return{ok:true}}catch(error:any){return{ok:false,error:error?.message||'Could not start Google sign-in.'}}},[]);
 const logout=useCallback(async()=>{if(supabaseEnabled&&supabase)await supabase.auth.signOut();sessionStorage.removeItem('canteen_user');setUser(null)},[]);
 const updateUser=useCallback((u:User)=>{sessionStorage.setItem('canteen_user',JSON.stringify(u));setUser(u)},[]);
 return <AuthContext.Provider value={{user,login,loginWithCredentials,loginWithGoogle,logout,updateUser,loading}}>{children}</AuthContext.Provider>;
};
export const useAuth=()=>{const context=useContext(AuthContext);if(!context)throw new Error('useAuth must be used within AuthProvider');return context};
