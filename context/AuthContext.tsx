import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { User } from '../types';
import { supabase, supabaseEnabled, internalEmailForLogin } from '../supabase';
import { resetEmployeePassword } from '../services/supabaseSync';
import { DEFAULT_EMPLOYEE_PASSWORD } from '../constants';

interface AuthContextType { user:User|null; login:(user:User)=>void; loginWithCredentials:(userId:string,password:string,localUsers:User[])=>Promise<{ok:boolean;error?:string}>; logout:()=>void; updateUser:(updatedUser:User)=>void; loading:boolean; }
const AuthContext=createContext<AuthContextType|undefined>(undefined);
export const AuthProvider:React.FC<{children:ReactNode}>=({children})=>{const[user,setUser]=useState<User|null>(null);const[loading,setLoading]=useState(true);useEffect(()=>{const stored=sessionStorage.getItem('canteen_user');if(stored){try{setUser(JSON.parse(stored))}catch{}}setLoading(false)},[]);const login=useCallback((u:User)=>{sessionStorage.setItem('canteen_user',JSON.stringify(u));setUser(u)},[]);
const loginWithCredentials=useCallback(async(userId:string,password:string,localUsers:User[])=>{
  const local=localUsers.find(u=>u.id===userId);
  if(local&&(local.status==='blocked'||local.status==='deleted'))return{ok:false,error:local.status==='deleted'?'This employee account has been deleted. Please contact the administrator.':'Your account is blocked. Please contact the administrator.'};
  if(supabaseEnabled&&supabase){
    let{data,error}=await supabase.auth.signInWithPassword({email:internalEmailForLogin(userId),password});
    if(error&&local?.role!=='admin'){
      const{data:profile}=await supabase.from('profiles').select('id,employee_code,sr_number,full_name,mobile_number,role,status,is_first_login').or(`employee_code.eq.${userId},sr_number.eq.${userId}`).maybeSingle();
      if(profile?.is_first_login&&profile.status!=='blocked'&&profile.status!=='deleted'&&password===DEFAULT_EMPLOYEE_PASSWORD){try{await resetEmployeePassword(userId,DEFAULT_EMPLOYEE_PASSWORD);const retry=await supabase.auth.signInWithPassword({email:internalEmailForLogin(userId),password:DEFAULT_EMPLOYEE_PASSWORD});data=retry.data;error=retry.error}catch{}}
    }
    if(!error&&data.user){
      const{data:profile}=await supabase.from('profiles').select('*').eq('id',data.user.id).maybeSingle();
      if(profile?.status==='deleted'||profile?.status==='blocked')return{ok:false,error:profile.status==='deleted'?'This employee account has been deleted. Please contact the administrator.':'Your account is blocked. Please contact the administrator.'};
      const base:User=local||{id:userId,name:'',mobile:'',password:'',role:profile?.role||'employee',status:profile?.status||'active'};
      const resolved:User={...base,id:profile?.employee_code||profile?.sr_number||userId,name:profile?.full_name||base.name,mobile:profile?.mobile_number||base.mobile,role:profile?.role||base.role,status:profile?.status||base.status,isFirstLogin:Boolean(profile?.is_first_login)};
      login(resolved);return{ok:true}
    }
    return{ok:false,error:error?.message||'Invalid User ID or Password.'};
  }
  if(!local)return{ok:false,error:'Invalid User ID or Password.'};
  if(local.password!==password)return{ok:false,error:'Invalid User ID or Password.'};
  login(local);return{ok:true};
},[login]);
const logout=useCallback(async()=>{if(supabaseEnabled&&supabase)await supabase.auth.signOut();sessionStorage.removeItem('canteen_user');setUser(null)},[]);const updateUser=useCallback((u:User)=>{sessionStorage.setItem('canteen_user',JSON.stringify(u));setUser(u)},[]);return <AuthContext.Provider value={{user,login,loginWithCredentials,logout,updateUser,loading}}>{children}</AuthContext.Provider>};
export const useAuth=()=>{const context=useContext(AuthContext);if(!context)throw new Error('useAuth must be used within an AuthProvider');return context};