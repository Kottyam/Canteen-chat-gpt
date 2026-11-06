export const ANDROID_PACKAGE_ID='com.gocanteen.app';
export const APK_DOWNLOADED_KEY='gocanteen-apk-downloaded';

export type RelatedAppsStatus='installed'|'not_installed'|'unknown';

export const readApkDownloadedFlag=()=>{try{return localStorage.getItem(APK_DOWNLOADED_KEY)==='1'}catch{return false}};
export const setApkDownloadedFlag=(value:boolean)=>{try{if(value)localStorage.setItem(APK_DOWNLOADED_KEY,'1');else localStorage.removeItem(APK_DOWNLOADED_KEY)}catch{}};

/** Uses navigator.getInstalledRelatedApps when available (needs manifest related_applications). */
export const checkAndroidAppInstalled=async():Promise<RelatedAppsStatus>=>{
  const nav=navigator as Navigator&{getInstalledRelatedApps?:()=>Promise<Array<{id?:string;url?:string;platform?:string}>>};
  if(typeof nav.getInstalledRelatedApps!=='function')return 'unknown';
  try{
    const apps=await nav.getInstalledRelatedApps();
    const hit=(apps||[]).some(a=>a.id===ANDROID_PACKAGE_ID||(typeof a.url==='string'&&a.url.includes(ANDROID_PACKAGE_ID)));
    return hit?'installed':'not_installed';
  }catch{
    return 'unknown';
  }
};

/** Sync download flag with getInstalledRelatedApps when the API can decide. */
export const syncApkInstallState=async():Promise<{installed:boolean;status:RelatedAppsStatus}>=>{
  const status=await checkAndroidAppInstalled();
  if(status==='installed'){setApkDownloadedFlag(true);return{installed:true,status}}
  if(status==='not_installed'){setApkDownloadedFlag(false);return{installed:false,status}}
  return{installed:readApkDownloadedFlag(),status};
};
