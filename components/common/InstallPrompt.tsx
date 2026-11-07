import React,{useEffect,useState}from'react';
import{readApkDownloadedFlag,setApkDownloadedFlag,syncApkInstallState}from'../../utils/androidAppInstall';

type BeforeInstallPromptEvent=Event&{prompt:()=>Promise<void>;userChoice:Promise<{outcome:'accepted'|'dismissed'}>};
const SNOOZE_UNTIL_KEY='gocanteen-install-dismissed-until';
const LEGACY_DISMISS_KEY='gocanteen-install-dismissed-v2';
const SNOOZE_MS=3*24*60*60*1000;
const APK_DOWNLOAD_HREF='/GoCanteen.apk';
const isNative=()=>Boolean((window as any).Capacitor?.isNativePlatform?.());
const isStandalone=()=>window.matchMedia('(display-mode: standalone)').matches||(navigator as any).standalone===true;
const isIos=()=>/iphone|ipad|ipod/i.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
const isAndroid=()=>/android/i.test(navigator.userAgent);
const isSnoozed=()=>{try{const raw=localStorage.getItem(SNOOZE_UNTIL_KEY);if(!raw)return false;const until=Number(raw);return Number.isFinite(until)&&Date.now()<until}catch{return false}};
const snooze=()=>{try{localStorage.setItem(SNOOZE_UNTIL_KEY,String(Date.now()+SNOOZE_MS));localStorage.removeItem(LEGACY_DISMISS_KEY)}catch{}};

const pwaHint=()=>{if(isIos())return <>Tap <span className="font-semibold">Share</span> <span aria-hidden="true">⎋</span> then <span className="font-semibold">Add to Home Screen</span>.</>;if(isAndroid())return <>Tap the browser menu (⋮), then choose <span className="font-semibold">Install app</span> or <span className="font-semibold">Add to Home screen</span>.</>;return <>Use <span className="font-semibold">Install app</span> in the address bar or your browser menu to add Go Canteen.</>};

const InstallPrompt:React.FC=()=>{const[deferred,setDeferred]=useState<BeforeInstallPromptEvent|null>(null);const[apkEligible,setApkEligible]=useState(false);const[hasAndroidApp,setHasAndroidApp]=useState(()=>!isIos()&&readApkDownloadedFlag());const[hidden,setHidden]=useState(()=>isSnoozed()||isStandalone());const[ready,setReady]=useState(false);
useEffect(()=>{if(isNative())return;if(isStandalone()){setHidden(true);return}const onPrompt=(e:Event)=>{e.preventDefault();setDeferred(e as BeforeInstallPromptEvent)};const onInstalled=()=>{setDeferred(null);setHidden(true)};window.addEventListener('beforeinstallprompt',onPrompt);window.addEventListener('appinstalled',onInstalled);setApkEligible(!isIos());let cancelled=false;void(async()=>{if(!isIos()){const{installed}=await syncApkInstallState();if(!cancelled)setHasAndroidApp(installed)}if(!cancelled)setReady(true)})();return()=>{cancelled=true;window.removeEventListener('beforeinstallprompt',onPrompt);window.removeEventListener('appinstalled',onInstalled)}},[]);
const dismiss=()=>{snooze();setHidden(true)};
const markApkDownloaded=()=>{setApkDownloadedFlag(true);setHasAndroidApp(true)};
const installPwa=async()=>{if(!deferred)return;await deferred.prompt();await deferred.userChoice.catch(()=>null);setDeferred(null)};
// After APK install/download, hide BOTH PWA and APK offers (user already has the native app).
const showApk=apkEligible&&!hasAndroidApp;
const showPwaOffer=!isStandalone()&&!(apkEligible&&hasAndroidApp);
if(!ready||hidden||isNative()||isStandalone()||(!showPwaOffer&&!showApk))return null;
return <div role="dialog" aria-label="Install Go Canteen" className="fixed inset-x-3 z-[60] mx-auto flex max-w-md flex-col gap-2 rounded-2xl border border-gray-200 bg-white p-3 shadow-lg" style={{bottom:'calc(5.5rem + env(safe-area-inset-bottom, 0px))'}}><div className="flex items-start gap-3"><img src="/pwa-192x192.png" alt="" className="h-10 w-10 shrink-0 rounded-xl"/><div className="min-w-0 flex-1"><p className="text-sm font-bold text-gray-900">Install Go Canteen</p><p className="mt-0.5 text-xs text-gray-600">{deferred?<>Add the app to your home screen for quick access.</>:pwaHint()}</p>{showApk&&<p className="mt-1 text-xs text-gray-600">Prefer the Android APK? Use the secondary button below (you may need to allow installs from this browser).</p>}</div><button type="button" onClick={dismiss} aria-label="Dismiss" className="rounded-lg px-2 py-1 text-lg leading-none text-gray-400 hover:text-gray-600">×</button></div><div className="flex flex-wrap gap-2 pl-[3.25rem]">{showPwaOffer&&deferred&&<button type="button" onClick={()=>void installPwa()} className="inline-flex min-h-10 items-center justify-center rounded-xl bg-primary-600 px-3 py-2 text-sm font-bold text-white shadow-sm">Install app</button>}{showApk&&<a href={APK_DOWNLOAD_HREF} download="GoCanteen.apk" onClick={markApkDownloaded} className="inline-flex min-h-10 items-center justify-center rounded-xl border border-primary-600 bg-white px-3 py-2 text-sm font-bold text-primary-700">Download Android app</a>}</div></div>};
export default InstallPrompt;
