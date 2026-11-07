import { useEffect, useState } from 'react';
import { CanteenBillingSettings, DEFAULT_BILLING_SETTINGS } from '../supabase/functions/_shared/poolingBilling';
import { loadBillingSettings } from '../services/billingSettings';

interface State { settings: CanteenBillingSettings; loaded: boolean; error: string | null }
let cache: State | null = null;
let inflight: Promise<State> | null = null;
const listeners = new Set<(s: State) => void>();

const emit = (s: State) => { cache = s; listeners.forEach(l => l(s)); };
export function publishBillingSettings(settings: CanteenBillingSettings) { emit({ settings, loaded: true, error: null }); }
export function refreshBillingSettings() {
  inflight = inflight || loadBillingSettings().then(r => {
    inflight = null;
    // On a transient error keep the last successfully loaded settings (never flip pooling -> standard).
    const s: State = r.error && cache?.loaded && !cache.error ? { ...cache, error: r.error } : { settings: r.settings, loaded: true, error: r.error };
    emit(s); return s;
  });
  return inflight;
}

/** Per-canteen billing settings; standard/manual when no settings exist. */
export function useBillingSettings() {
  const [state, setState] = useState<State>(cache || { settings: DEFAULT_BILLING_SETTINGS, loaded: false, error: null });
  useEffect(() => {
    listeners.add(setState);
    void refreshBillingSettings();
    return () => { listeners.delete(setState); };
  }, []);
  return { settings: state.settings, loaded: state.loaded, error: state.error, pooling: state.settings.billingModel === 'pooling' };
}
