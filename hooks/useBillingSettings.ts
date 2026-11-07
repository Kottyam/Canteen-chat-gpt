import { useEffect, useState } from 'react';
import { CanteenBillingSettings, DEFAULT_BILLING_SETTINGS } from '../supabase/functions/_shared/poolingBilling';
import { loadBillingSettings } from '../services/billingSettings';

let cache: CanteenBillingSettings | null = null;
let inflight: Promise<CanteenBillingSettings> | null = null;
const listeners = new Set<(s: CanteenBillingSettings) => void>();

export function publishBillingSettings(s: CanteenBillingSettings) { cache = s; listeners.forEach(l => l(s)); }
export function refreshBillingSettings() {
  inflight = inflight || loadBillingSettings().then(s => { inflight = null; publishBillingSettings(s); return s; });
  return inflight;
}

/** Per-canteen billing settings; standard/manual until loaded or when absent. */
export function useBillingSettings() {
  const [settings, setSettings] = useState<CanteenBillingSettings>(cache || DEFAULT_BILLING_SETTINGS);
  const [loaded, setLoaded] = useState(Boolean(cache));
  useEffect(() => {
    const l = (s: CanteenBillingSettings) => { setSettings(s); setLoaded(true); };
    listeners.add(l);
    void refreshBillingSettings();
    return () => { listeners.delete(l); };
  }, []);
  return { settings, loaded, pooling: settings.billingModel === 'pooling' };
}
