import { supabase, supabaseEnabled } from '../supabase';
import { CanteenBillingSettings, DEFAULT_BILLING_SETTINGS, normalizeBillingSettings } from '../supabase/functions/_shared/poolingBilling';

const LOCAL_KEY = 'gocanteen.billingSettings.local';

/** Absent row, missing table (migration not applied) or any read error => standard defaults. */
export async function loadBillingSettings(): Promise<CanteenBillingSettings> {
  if (!supabaseEnabled || !supabase) {
    try { return normalizeBillingSettings(JSON.parse(localStorage.getItem(LOCAL_KEY) || 'null')); } catch { return { ...DEFAULT_BILLING_SETTINGS }; }
  }
  try {
    const { data, error } = await supabase.from('canteen_billing_settings').select('billing_model,mess_cut_min_days,bill_send_mode').maybeSingle();
    if (error) return { ...DEFAULT_BILLING_SETTINGS };
    return normalizeBillingSettings(data);
  } catch { return { ...DEFAULT_BILLING_SETTINGS }; }
}

export async function saveBillingSettings(next: CanteenBillingSettings): Promise<CanteenBillingSettings> {
  const clean = normalizeBillingSettings(next);
  if (!supabaseEnabled || !supabase) { localStorage.setItem(LOCAL_KEY, JSON.stringify(clean)); return clean; }
  const { data, error } = await supabase.rpc('set_canteen_billing_settings', { p_billing_model: clean.billingModel, p_mess_cut_min_days: clean.messCutMinDays, p_bill_send_mode: clean.billSendMode });
  if (error) throw error;
  return normalizeBillingSettings(data);
}
