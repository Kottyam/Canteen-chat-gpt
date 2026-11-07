import { supabase, supabaseEnabled } from '../supabase';
import { CanteenBillingSettings, DEFAULT_BILLING_SETTINGS, normalizeBillingSettings } from '../supabase/functions/_shared/poolingBilling';

const LOCAL_KEY = 'gocanteen.billingSettings.local';
export interface BillingSettingsLoad { settings: CanteenBillingSettings; error: string | null }

/** Table not deployed yet (migration unapplied) => exact standard behaviour, not an error. */
export const isMissingBillingTable = (e: any) =>
  ['42P01', 'PGRST205', 'PGRST202'].includes(String(e?.code || '')) || /canteen_billing_settings.*(does not exist|schema cache)/i.test(String(e?.message || ''));

/**
 * Absent row or missing table => standard defaults (no error).
 * Any OTHER failure is surfaced as `error` so callers never silently switch a
 * pooling canteen to standard billing.
 */
export async function loadBillingSettings(): Promise<BillingSettingsLoad> {
  if (!supabaseEnabled || !supabase) {
    try { return { settings: normalizeBillingSettings(JSON.parse(localStorage.getItem(LOCAL_KEY) || 'null')), error: null }; }
    catch { return { settings: { ...DEFAULT_BILLING_SETTINGS }, error: null }; }
  }
  try {
    const { data, error } = await supabase.from('canteen_billing_settings').select('billing_model,mess_cut_min_days,bill_send_mode').maybeSingle();
    if (error) return isMissingBillingTable(error) ? { settings: { ...DEFAULT_BILLING_SETTINGS }, error: null } : { settings: { ...DEFAULT_BILLING_SETTINGS }, error: error.message || 'Could not load billing settings.' };
    return { settings: normalizeBillingSettings(data), error: null };
  } catch (e: any) { return { settings: { ...DEFAULT_BILLING_SETTINGS }, error: e?.message || 'Could not load billing settings.' }; }
}

export async function saveBillingSettings(next: CanteenBillingSettings): Promise<CanteenBillingSettings> {
  const clean = normalizeBillingSettings(next);
  if (!supabaseEnabled || !supabase) { localStorage.setItem(LOCAL_KEY, JSON.stringify(clean)); return clean; }
  const { data, error } = await supabase.rpc('set_canteen_billing_settings', { p_billing_model: clean.billingModel, p_mess_cut_min_days: clean.messCutMinDays, p_bill_send_mode: clean.billSendMode });
  if (error) throw error;
  return normalizeBillingSettings(data);
}
