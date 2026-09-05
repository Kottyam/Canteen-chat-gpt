import React,{createContext,useContext,useState,useEffect,useCallback,useRef,ReactNode}from'react';
import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';
import { User } from '../types';
import { supabase,supabaseEnabled,internalEmailForLogin,normalizeMobileNumber,GOOGLE_REDIRECT_URL } from '../supabase';
import { resetEmployeePassword } from '../services/supabaseSync';
import { DEFAULT_EMPLOYEE_PASSWORD } from '../constants';

interface AuthContextType{user:User|null;login:(user:User)=>void;loginWithCredentials:(userId:string,password:string,localUsers:User[])=>Promise<{ok:boolean;error?:string}>;loginWithGoogle:()=>Promise<{ok:boolean;error?:string}>;logout:()=>void;updateUser:(updatedUser:User)=>void;loading:boolean;}
const AuthContext=createContext<AuthContextType|undefined>(undefined);
const GENERIC_LOGIN_ERROR='Employee ID or password is incorrect.';
const MOBILE_LOGIN_ERROR='Invalid Mobile Number or Password.';
const IS_NATIVE_OAUTH=Capacitor.isNativePlatform()||import.meta.env.VITE_CAPACITOR_ANDROID_BUILD==='true';

export const AuthProvider:React.FC<{children:ReactNode}>=({children})=>{
 const[user,setUser]=useState<User|null>(null);const[loading,setLoading]=useState(true);const restoringRef=useRef(true);
 const clearInvalidSession=useCallback(async()=>{sessionStorage.removeItem('canteen_user');setUser(null);if(supabaseEnabled&&supabase){try{await supabase.auth.signOut()}catch{}}},[]);
 const ensureGoogleAdmin=useCallback(async(authUser:any)=>{if(!supabase||authUser?.app_metadata?.provider!=='google')return null;const{data,error}=await supabase.rpc('ensure_google_admin');if(error)throw error;return data as any},[]);
 const resolveAuthenticatedProfile=useCallback(async(authUser:any,requestedId?:string):Promise<User|null>=>{
   if(!supabase||!authUser?.id)return null;
   const provider=authUser.app_metadata?.provider==='google'?'google':'password';
   if(provider==='google')await ensureGoogleAdmin(authUser);
   const{data:profile,error}=await supabase.from('profiles').select('id,employee_code,sr_number,full_name,mobile_number,role,status,is_first_login,canteen_id,onboarding_completed').eq('id',authUser.id).maybeSingle();
   if(error)throw error;
   if(!profile)return null;
   const requestedLegacyAdmin=requestedId==='229132'&&String(profile.employee_code||'')==='admin'&&String(profile.role||'')==='admin';
   const employeeMatch=!requestedId||String(profile.employee_code||'')===requestedId||String(profile.sr_number||'')===requestedId||requestedLegacyAdmin;
   if(!employeeMatch||String(profile.status||'')!=='active'||!['employee','admin'].includes(String(profile.role||'')))return null;
   let canteenName='';let memberLoginMode:'sr'|'mobile'='sr';
   if(profile.canteen_id){const{data:c,error:canteenError}=await supabase.from('canteens').select('name,member_login_mode').eq('id',profile.canteen_id).maybeSingle();if(canteenError)throw canteenError;canteenName=c?.name||'';memberLoginMode=c?.member_login_mode==='mobile'?'mobile':'sr';}
   return{id:profile.employee_code||profile.sr_number||profile.id,name:profile.full_name||'',mobile:profile.mobile_number||'',password:'',role:profile.role,status:profile.status,isFirstLogin:Boolean(profile.is_first_login),canteenId:profile.canteen_id||undefined,canteenName,needsCanteenSetup:profile.role==='admin'&&profile.onboarding_completed===false,authProvider:provider,memberLoginMode};
 },[ensureGoogleAdmin]);
 const applyCurrentSession=useCallback(async()=>{if(!supabase)return false;const{data:{session}}=await supabase.auth.getSession();if(!session?.user){sessionStorage.removeItem('canteen_user');setUser(null);return false}const resolved=await resolveAuthenticatedProfile(session.user);if(!resolved){await clearInvalidSession();return false}sessionStorage.setItem('canteen_user',JSON.stringify(resolved));setUser(resolved);return true},[clearInvalidSession,resolveAuthenticatedProfile]);
 useEffect(()=>{let alive=true;let nativeHandle:{remove:()=>Promise<void>}|null=null;
   const exchangeNativeCallback=async(url:string)=>{if(!supabase||!url.startsWith('gocanteen://auth/callback'))return false;const parsed=new URL(url);const errorDescription=parsed.searchParams.get('error_description')||parsed.searchParams.get('error');if(errorDescription)throw new Error(errorDescription);const code=parsed.searchParams.get('code');if(code){const{error}=await supabase.auth.exchangeCodeForSession(code);if(error)throw error}return Boolean(code)};
   const restore=async()=>{if(!supabaseEnabled||!supabase){const stored=sessionStorage.getItem('canteen_user');if(stored)try{if(alive)setUser(JSON.parse(stored))}catch{sessionStorage.removeItem('canteen_user')}if(alive)setLoading(false);restoringRef.current=false;return}try{if(IS_NATIVE_OAUTH){const launch=await App.getLaunchUrl();if(launch?.url)await exchangeNativeCallback(launch.url)}if(alive)await applyCurrentSession()}catch(error){if(alive){console.warn('OAuth callback/session restore failed.',error);sessionStorage.removeItem('canteen_user');setUser(null)}}if(alive)setLoading(false);restoringRef.current=false};
   void restore();
   if(supabase){const{data:{subscription}}=supabase.auth.onAuthStateChange((_event,session)=>{if(restoringRef.current)return;void(async()=>{if(!alive)return;if(session?.user){try{const resolved=await resolveAuthenticatedProfile(session.user);if(resolved){sessionStorage.setItem('canteen_user',JSON.stringify(resolved));setUser(resolved)}else{await clearInvalidSession()}}catch(error){console.warn('Authenticated profile resolution failed after auth state change.',error)}}else{sessionStorage.removeItem('canteen_user');setUser(null)}})()});if(IS_NATIVE_OAUTH){void App.addListener('appUrlOpen',event=>void(async()=>{try{const handled=await exchangeNativeCallback(event.url);if(handled&&alive){await applyCurrentSession();try{await Browser.close()}catch{}}}catch(error){console.warn('Google callback handling failed.',error)}})()).then(handle=>{nativeHandle=handle})}return()=>{alive=false;subscription.unsubscribe();if(nativeHandle)void nativeHandle.remove()}}return()=>{alive=false};
 },[applyCurrentSession,clearInvalidSession,resolveAuthenticatedProfile]);
 const login=useCallback((u:User)=>{sessionStorage.setItem('canteen_user',JSON.stringify(u));setUser(u)},[]);
 const loginWithCredentials=useCallback(async(userId:string,password:string,localUsers:User[])=>{
   const trimmed=userId.trim();
   const local=localUsers.find(u=>u.id===trimmed);
   const normalizedMobile=normalizeMobileNumber(trimmed);
   const isValidMobile=/^[6-9][0-9]{9}$/.test(normalizedMobile);
   const isLegacyLogin=Boolean(local)||!isValidMobile;
   if(isLegacyLogin&&local&&(local.status==='blocked'||local.status==='deleted'))return{ok:false,error:GENERIC_LOGIN_ERROR};
   if(!isLegacyLogin&&!isValidMobile)return{ok:false,error:'Please enter a valid Mobile Number.'};
   const loginId=isLegacyLogin?trimmed:normalizedMobile;
   if(supabaseEnabled&&supabase){let{data,error}=await supabase.auth.signInWithPassword({email:internalEmailForLogin(loginId),password});if(error&&isLegacyLogin&&local?.role==='employee'&&local.status==='active'&&local.isFirstLogin===true&&password===DEFAULT_EMPLOYEE_PASSWORD){try{await resetEmployeePassword(loginId,DEFAULT_EMPLOYEE_PASSWORD);const retry=await supabase.auth.signInWithPassword({email:internalEmailForLogin(loginId),password:DEFAULT_EMPLOYEE_PASSWORD});data=retry.data;error=retry.error}catch{}}if(!error&&data.user){const resolved=await resolveAuthenticatedProfile(data.user,isLegacyLogin?trimmed:undefined);if(!resolved){await clearInvalidSession();return{ok:false,error:isLegacyLogin?GENERIC_LOGIN_ERROR:MOBILE_LOGIN_ERROR}}login(resolved);return{ok:true}}return{ok:false,error:isLegacyLogin?GENERIC_LOGIN_ERROR:MOBILE_LOGIN_ERROR}}
   if(!local||local.password!==password)return{ok:false,error:isLegacyLogin?GENERIC_LOGIN_ERROR:MOBILE_LOGIN_ERROR};login(local);return{ok:true};
 },[clearInvalidSession,login,resolveAuthenticatedProfile]);
 const loginWithGoogle=useCallback(async()=>{if(!supabaseEnabled||!supabase)return{ok:false,error:'Google sign-in is unavailable.'};try{const{data,error}=await supabase.auth.signInWithOAuth({provider:'google',options:{redirectTo:GOOGLE_REDIRECT_URL,skipBrowserRedirect:true}});if(error)return{ok:false,error:error.message};if(IS_NATIVE_OAUTH){if(!data?.url)return{ok:false,error:'Google sign-in did not return an authorization URL.'};await Browser.open({url:data.url});}else if(data?.url){window.location.assign(data.url)}else{return{ok:false,error:'Google sign-in did not return an authorization URL.'}}return{ok:true}}catch(error:any){return{ok:false,error:error?.message||'Could not start Google sign-in.'}}},[]);
 const logout=useCallback(async()=>{if(supabaseEnabled&&supabase)await supabase.auth.signOut();sessionStorage.removeItem('canteen_user');setUser(null)},[]);
 const updateUser=useCallback((u:User)=>{sessionStorage.setItem('canteen_user',JSON.stringify(u));setUser(u)},[]);
 return <AuthContext.Provider value={{user,login,loginWithCredentials,loginWithGoogle,logout,updateUser,loading}}>{children}</AuthContext.Provider>;
};
export const useAuth=()=>{const context=useContext(AuthContext);if(!context)throw new Error('useAuth must be used within AuthProvider');return context};
