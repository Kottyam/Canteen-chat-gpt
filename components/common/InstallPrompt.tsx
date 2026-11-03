import React,{useEffect,useState}from'react';

type BeforeInstallPromptEvent=Event&{prompt:()=>Promise<void>;userChoice:Promise<{outcome:'accepted'|'dismissed'}>};
const DISMISS_KEY='gocanteen-install-dismissed';
const isNative=()=>Boolean((window as any).Capacitor?.isNativePlatform?.());
const isStandalone=()=>window.matchMedia('(display-mode: standalone)').matches||(navigator as any).standalone===true;
const isIos=()=>/iphone|ipad|ipod/i.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);

const InstallPrompt:React.FC=()=>{const[deferred,setDeferred]=useState<BeforeInstallPromptEvent|null>(null);const[showIos,setShowIos]=useState(false);const[dismissed,setDismissed]=useState(()=>{try{return localStorage.getItem(DISMISS_KEY)==='1'}catch{return false}});
useEffect(()=>{if(isNative()||isStandalone())return;const onPrompt=(e:Event)=>{e.preventDefault();setDeferred(e as BeforeInstallPromptEvent)};const onInstalled=()=>setDeferred(null);window.addEventListener('beforeinstallprompt',onPrompt);window.addEventListener('appinstalled',onInstalled);if(isIos())setShowIos(true);return()=>{window.removeEventListener('beforeinstallprompt',onPrompt);window.removeEventListener('appinstalled',onInstalled)}},[]);
const dismiss=()=>{setDismissed(true);try{localStorage.setItem(DISMISS_KEY,'1')}catch{}};
const install=async()=>{if(!deferred)return;await deferred.prompt();await deferred.userChoice.catch(()=>null);setDeferred(null)};
if(dismissed||(!deferred&&!showIos))return null;
return <div role="dialog" aria-label="Install Go Canteen" className="fixed inset-x-3 bottom-3 z-50 mx-auto flex max-w-md items-center gap-3 rounded-2xl border border-gray-200 bg-white p-3 shadow-lg" style={{marginBottom:'env(safe-area-inset-bottom, 0px)'}}><img src="/pwa-192x192.png" alt="" className="h-10 w-10 rounded-xl"/><div className="min-w-0 flex-1"><p className="text-sm font-bold text-gray-900">Install Go Canteen</p>{deferred?<p className="text-xs text-gray-600">Add the app to your home screen for quick access.</p>:<p className="text-xs text-gray-600">Tap <span className="font-semibold">Share</span> <span aria-hidden="true">⎋</span> then <span className="font-semibold">Add to Home Screen</span>.</p>}</div>{deferred&&<button type="button" onClick={()=>void install()} className="rounded-xl bg-primary-600 px-3 py-2 text-sm font-bold text-white">Install app</button>}<button type="button" onClick={dismiss} aria-label="Dismiss" className="rounded-lg px-2 py-1 text-lg leading-none text-gray-400 hover:text-gray-600">×</button></div>};
export default InstallPrompt;
