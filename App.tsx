import React,{useEffect,useState}from'react';
import{DataProvider}from'./context/DataContext';
import{AuthProvider,useAuth}from'./context/AuthContext';
import Login from'./components/auth/Login';
import CanteenOnboarding from'./components/auth/CanteenOnboarding';
import EmployeeDashboard from'./components/employee/EmployeeDashboard';
import AdminDashboard from'./components/admin/AdminDashboard';
import SuperAdminDashboard from'./components/admin/SuperAdminDashboard';
import ContactUs from'./components/admin/ContactUs';
import InitialPasswordChange from'./components/auth/InitialPasswordChange';
import{CanteenAccessState,loadCanteenAccessState}from'./services/subscriptionPlatform';

const SplashScreen:React.FC=()=> <div className="flex min-h-screen flex-col items-center justify-center bg-white"><span className="text-4xl font-extrabold text-primary-700">Go Canteen</span><span className="mt-2 text-[9px] font-medium text-black">Powered by Alien 1729</span></div>;

const SubscriptionRestrictedScreen:React.FC<{userRole:'admin'|'employee';access:CanteenAccessState|null;onRetry:()=>void}>=({userRole,access,onRetry})=>{
  const status=access?.status;
  const title=status==='suspended'?'Canteen Suspended':status==='expired'?'Subscription Expired':status==='unassigned'?'Subscription Not Assigned':'Subscription Access Restricted';
  const description=status==='suspended'?'Normal canteen operations are currently suspended.':status==='expired'?'Normal canteen operations are restricted because the subscription period has expired.':status==='unassigned'?'No subscription is currently assigned to this canteen.':'Your subscription access could not be verified. Normal operations are temporarily restricted.';
  if(userRole==='admin')return <div className="min-h-screen w-full overflow-x-hidden bg-gray-100"><main className="mx-auto w-full max-w-5xl px-3 py-5 sm:px-6 sm:py-8"><section className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4"><h2 className="text-lg font-extrabold text-amber-900">{title}</h2><p className="mt-1 text-sm text-amber-800">{description}</p>{status&&<p className="mt-2 text-xs font-bold uppercase text-amber-700">Current status: {status.replace('_',' ')}</p>}</section><ContactUs/><button type="button" onClick={onRetry} className="mt-4 min-h-11 w-full rounded-lg bg-gray-800 px-4 py-2.5 font-bold text-white">Refresh Access Status</button></main></div>;
  return <div className="flex min-h-screen w-full items-center justify-center bg-gray-100 px-4"><section className="w-full max-w-md rounded-2xl bg-white p-6 text-center shadow-sm"><div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 text-2xl">!</div><h2 className="mt-4 text-xl font-extrabold text-gray-800">{title}</h2><p className="mt-2 text-sm text-gray-600">{description}</p>{status&&<p className="mt-3 text-xs font-bold uppercase text-gray-500">Current status: {status.replace('_',' ')}</p>}<button type="button" onClick={onRetry} className="mt-5 min-h-11 w-full rounded-lg bg-primary-600 px-4 py-2.5 font-bold text-white">Refresh Access Status</button></section></div>;
};

const SubscriptionAccessBoundary:React.FC<{children:React.ReactNode}>=({children})=>{
  const{user}=useAuth();const[access,setAccess]=useState<CanteenAccessState|null>(null);const[checking,setChecking]=useState(false);const[error,setError]=useState(false);
  const shouldCheck=Boolean(user?.canteenId&&((user.role==='admin'&&!user.needsCanteenSetup)||(user.role==='employee'&&!user.isFirstLogin)));
  const check=async()=>{if(!shouldCheck||!user?.canteenId)return;setChecking(true);setError(false);try{setAccess(await loadCanteenAccessState(user.canteenId))}catch(e){console.warn('Subscription access verification failed.',e);setAccess({allowed:false,status:null,subscription:null,reason:'verification_error'});setError(true)}finally{setChecking(false)}};
  useEffect(()=>{setAccess(null);if(!shouldCheck)return;void check();const onVisible=()=>{if(document.visibilityState==='visible')void check()};window.addEventListener('focus',onVisible);document.addEventListener('visibilitychange',onVisible);const timer=window.setInterval(()=>void check(),30000);return()=>{window.removeEventListener('focus',onVisible);document.removeEventListener('visibilitychange',onVisible);window.clearInterval(timer)}},[user?.canteenId,user?.role,user?.needsCanteenSetup,user?.isFirstLogin,shouldCheck]);
  if(!shouldCheck)return <>{children}</>;
  if(checking&&!access)return <SplashScreen/>;
  if(!access)return <SplashScreen/>;
  if(access.allowed)return <>{children}</>;
  return <SubscriptionRestrictedScreen userRole={user?.role==='admin'?'admin':'employee'} access={error?{...access,reason:'verification_error'}:access} onRetry={()=>void check()}/>;
};

const AppContent:React.FC=()=>{const{user,loading}=useAuth();if(loading)return <SplashScreen/>;if(!user)return <Login/>;if(user.role==='admin'&&user.adminRole==='super_admin')return <SuperAdminDashboard/>;if(user.role==='admin'&&user.needsCanteenSetup)return <CanteenOnboarding/>;if(user.role==='employee'&&user.isFirstLogin)return <InitialPasswordChange/>;if(user.role==='employee')return <EmployeeDashboard/>;if(user.role==='admin')return <AdminDashboard/>;return <Login/>};

const App:React.FC=()=>{const[splash,setSplash]=useState(true);useEffect(()=>{const timer=window.setTimeout(()=>setSplash(false),1000);return()=>window.clearTimeout(timer)},[]);return <AuthProvider><DataProvider>{splash?<SplashScreen/>:<AppContent/>}</DataProvider></AuthProvider>};
export default App;