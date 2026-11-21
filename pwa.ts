// Registers the PWA service worker for the web build only (skipped inside the Capacitor native app,
// which loads a bundled snapshot of `dist` and does not use the live website).
export const registerPWA = () => {
  if (typeof window === 'undefined' || (window as any).Capacitor?.isNativePlatform?.()) return;
  import('virtual:pwa-register').then(({ registerSW }) => {
    const apply = registerSW({
      immediate: true,
      onNeedRefresh() { apply(true); },
      onRegisteredSW(_url, reg) {
        if (!reg) return;
        const check = () => { void reg.update(); };
        window.setInterval(check, 15 * 60 * 1000);
        window.addEventListener('focus', check);
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
      },
    });
  }).catch(e => console.warn('Service worker registration failed.', e));
  if (!('serviceWorker' in navigator)) return;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });
};
