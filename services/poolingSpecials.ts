import { supabase, supabaseEnabled } from '../supabase';

/** Missing column/table (migration not applied yet) => feature simply absent, not an error. */
const missing = (e: any) => ['42P01', '42703', 'PGRST204', 'PGRST205'].includes(String(e?.code || '')) || /pooling_special|guest_order|does not exist|schema cache/i.test(String(e?.message || ''));

/** itemCode -> special price in paise for menu items the admin opted in ("Add price?"). */
export async function loadPoolingSpecialPrices(): Promise<Record<string, number>> {
  if (!supabaseEnabled || !supabase) return {};
  const { data, error } = await supabase.from('menu_prices').select('item_code,pooling_special,pooling_special_price_paise').eq('pooling_special', true);
  if (error) { if (missing(error)) return {}; throw error; }
  const out: Record<string, number> = {};
  for (const r of (data || []) as any[]) if (r.pooling_special && r.pooling_special_price_paise != null) out[r.item_code] = Number(r.pooling_special_price_paise);
  return out;
}

/** Admin: opt an existing menu item in/out of a special price (Pooling). Price in rupees, validated to paise. */
export async function savePoolingSpecialPrice(itemCode: string, enabled: boolean, priceRupees: string | number): Promise<void> {
  if (!supabaseEnabled || !supabase) throw new Error('Not connected');
  let paise: number | null = null;
  if (enabled) {
    const n = Number(String(priceRupees).trim());
    if (!Number.isFinite(n) || n < 0 || String(priceRupees).trim() === '') throw new Error('Enter a valid price (0 or more).');
    paise = Math.round(n * 100);
  }
  const { error } = await supabase.from('menu_prices').update({ pooling_special: enabled, pooling_special_price_paise: paise }).eq('item_code', itemCode);
  if (error) throw error;
}

/** Guest orders On/Off for the current canteen (all billing modes). Missing row/table => On (current behaviour). */
export async function loadGuestOrdersEnabled(): Promise<boolean> {
  if (!supabaseEnabled || !supabase) return true;
  const { data, error } = await supabase.from('canteen_guest_order_settings').select('guest_orders_enabled').maybeSingle();
  if (error) { if (missing(error)) return true; throw error; }
  return data ? data.guest_orders_enabled !== false : true;
}
export async function saveGuestOrdersEnabled(enabled: boolean): Promise<boolean> {
  if (!supabaseEnabled || !supabase) throw new Error('Not connected');
  const { data, error } = await supabase.rpc('set_guest_orders_enabled', { p_enabled: enabled });
  if (error) throw error;
  return (data as any)?.guest_orders_enabled !== false;
}
