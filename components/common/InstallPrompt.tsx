import React,{useEffect,useState}from'react';

type BeforeInstallPromptEvent=Event&{prompt:()=>Promise<void>;userChoice:Promise<{outcome:'accepted'|'dismissed'}>};
// Bump key so an earlier dismiss of the old PWA-only card does not hide the APK banner.
const DISMISS_KEY='gocanteen-install-dismissed-v2';
const APK_DOWNLOADED_KEY='gocanteen-apk-downloaded';
const APK_URL='/GoCanteen.apk';
const isNative=()=>Boolean((window as any).Capacitor?.isNativePlatform?.());
const isStandalone=()=>window.matchMedia('(display-mode: standalone)').matches||(navigator as any).standalone===true;
const isIos=()=>/iphone|ipad|ipod/i.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
const readFlag=(key:string)=>{try{return localStorage.getItem(key)==='1'}catch{return false}};
const writeFlag=(key:string)=>{try{localStorage.setItem(key,'1')}catch{}};

const InstallPrompt:React.FC=()=>{const[deferred,setDeferred]=useState<BeforeInstallPromptEvent|null>(null);const[showIos,setShowIos]=useState(false);const[apkEligible,setApkEligible]=useState(false);const[apkDownloaded,setApkDownloaded]=useState(()=>readFlag(APK_DOWNLOADED_KEY));const[dismissed,setDismissed]=useState(()=>readFlag(DISMISS_KEY));
useEffect(()=>{if(isNative())return;const onPrompt=(e:Event)=>{e.preventDefault();setDeferred(e as BeforeInstallPromptEvent)};const onInstalled=()=>setDeferred(null);window.addEventListener('beforeinstallprompt',onPrompt);window.addEventListener('appinstalled',onInstalled);if(isIos()){if(!isStandalone())setShowIos(true)}else{setApkEligible(true)}return()=>{window.removeEventListener('beforeinstallprompt',onPrompt);window.removeEventListener('appinstalled',onInstalled)}},[]);
const dismiss=()=>{setDismissed(true);writeFlag(DISMISS_KEY)};
const markApkDownloaded=()=>{setApkDownloaded(true);writeFlag(APK_DOWNLOADED_KEY)};
const installPwa=async()=>{if(!deferred)return;await deferred.prompt();await deferred.userChoice.catch(()=>null);setDeferred(null)};
const showApk=apkEligible&&!apkDownloaded;
const showPwa=Boolean(deferred)&&!isStandalone();
if(dismissed||isNative()||(!showPwa&&!showIos&&!showApk))return null;
return <div role="dialog" aria-label="Install Go Canteen" className="fixed inset-x-3 z-[60] mx-auto flex max-w-md flex-col gap-2 rounded-2xl border border-gray-200 bg-white p-3 shadow-lg" style={{bottom:'calc(5.5rem + env(safe-area-inset-bottom, 0px))'}}><div className="flex items-start gap-3"><img src="/pwa-192x192.png" alt="" className="h-10 w-10 shrink-0 rounded-xl"/><div className="min-w-0 flex-1"><p className="text-sm font-bold text-gray-900">Install Go Canteen</p>{showApk&&<p className="mt-0.5 text-xs text-gray-600">Download the Android app. You may need to allow installing from this browser / unknown sources.</p>}{showIos&&!showApk&&<p className="mt-0.5 text-xs text-gray-600">Tap <span className="font-semibold">Share</span> <span aria-hidden="true">⎋</span> then <span className="font-semibold">Add to Home Screen</span>.</p>}{showPwa&&!showApk&&!showIos&&<p className="mt-0.5 text-xs text-gray-600">Add the app to your home screen for quick access.</p>}{showPwa&&showApk&&<p className="mt-0.5 text-xs text-gray-500">Or install as a web app on this device.</p>}{showPwa&&apkEligible&&apkDownloaded&&!showIos&&<p className="mt-0.5 text-xs text-gray-600">Add the app to your home screen for quick access.</p>}</div><button type="button" onClick={dismiss} aria-label="Dismiss" className="rounded-lg px-2 py-1 text-lg leading-none text-gray-400 hover:text-gray-600">×</button></div><div className="flex flex-wrap gap-2 pl-[3.25rem]">{showApk&&<a href={APK_URL} download="GoCanteen.apk" onClick={markApkDownloaded} className="inline-flex min-h-10 items-center justify-center rounded-xl bg-primary-600 px-3 py-2 text-sm font-bold text-white">Download Android app</a>}{showPwa&&<button type="button" onClick={()=>void installPwa()} className={`inline-flex min-h-10 items-center justify-center rounded-xl px-3 py-2 text-sm font-bold ${showApk?'border border-primary-600 bg-white text-primary-700':'bg-primary-600 text-white'}`}>Install app</button>}</div></div>};
export default InstallPrompt;
