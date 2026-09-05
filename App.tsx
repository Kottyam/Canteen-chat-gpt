import React,{useEffect,useState}from'react';
import{DataProvider}from'./context/DataContext';
import{AuthProvider,useAuth}from'./context/AuthContext';
import Login from'./components/auth/Login';
import CanteenOnboarding from'./components/auth/CanteenOnboarding';
import EmployeeDashboard from'./components/employee/EmployeeDashboard';
import AdminDashboard from'./components/admin/AdminDashboard';
import InitialPasswordChange from'./components/auth/InitialPasswordChange';

const SplashScreen:React.FC=()=> <div className="flex min-h-screen flex-col items-center justify-center bg-white"><span className="text-4xl font-extrabold text-primary-700">Go Canteen</span><span className="mt-2 text-[9px] font-medium text-black">Powered by Alien 1729</span></div>;

const AppContent:React.FC=()=>{const{user,loading}=useAuth();if(loading)return <SplashScreen/>;if(!user)return <Login/>;if(user.role==='admin'&&user.needsCanteenSetup)return <CanteenOnboarding/>;if(user.role==='employee'&&user.isFirstLogin)return <InitialPasswordChange/>;if(user.role==='employee')return <EmployeeDashboard/>;if(user.role==='admin')return <AdminDashboard/>;return <Login/>};

const App:React.FC=()=>{const[splash,setSplash]=useState(true);useEffect(()=>{const timer=window.setTimeout(()=>setSplash(false),1000);return()=>window.clearTimeout(timer)},[]);return <AuthProvider><DataProvider>{splash?<SplashScreen/>:<AppContent/>}</DataProvider></AuthProvider>};
export default App;
