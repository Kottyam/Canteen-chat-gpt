const READY_KEY = 'gocanteen_ui_ready';

let presented = false;

export function markAppPresented(): void {
  presented = true;
  try { sessionStorage.setItem(READY_KEY, '1'); } catch { /* private mode / SSR */ }
}

export function hasAppPresented(): boolean {
  if (presented) return true;
  try {
    if (sessionStorage.getItem(READY_KEY) === '1') {
      presented = true;
      return true;
    }
  } catch { /* private mode / SSR */ }
  return false;
}

export function resetAppPresentedForTests(): void {
  presented = false;
  try { sessionStorage.removeItem(READY_KEY); } catch { /* private mode / SSR */ }
}

export const APP_SESSION_READY_KEY = READY_KEY;
