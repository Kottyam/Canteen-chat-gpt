// Registers the PWA service worker for the web build only (skipped inside the Capacitor native app).
export const registerPWA=()=>{if(typeof window==='undefined'||(window as any).Capacitor?.isNativePlatform?.())return;import('virtual:pwa-register').then(({registerSW})=>registerSW({immediate:true})).catch(e=>console.warn('Service worker registration failed.',e))};
