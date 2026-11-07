import { supabase, supabaseEnabled } from '../supabase';
import { getBusinessWeekday } from '../utils/helpers';

/** Missing column/table/function (migration not applied yet) => feature simply absent, not an error. */
export const isMissingSpecialFeature = (e: any) => ['42P01', '42703', '42883', 'PGRST202', 'PGRST204', 'PGRST205'].includes(String(e?.code || '')) || /pooling_special|guest_order|does not exist|schema cache/i.test(String(e?.message || ''));

/** weekday (0=Sunday) -> itemCode -> special price in paise (current menu; used only for NEW selections). */
export type WeeklySpecials = Record<number, Record<string, number>>;
/** date -> itemCode -> paise | null (explicit daily override; null = explicitly NOT special). */
export type DailySpecialOverrides = Record<string, Record<string, number | null>>;
export interface CurrentSpecials { weekly: WeeklySpecials; daily: DailySpecialOverrides }

export async function loadCurrentSpecials(): Promise<CurrentSpecials> {
  const out: CurrentSpecials = { weekly: {}, daily: {} };
  if (!supabaseEnabled || !supabase) return out;
  const [w, d] = await Promise.all([
    supabase.from('pooling_special_items').select('weekday,item_code,price_paise'),
    supabase.from('daily_menu').select('menu_date,item_code,pooling_special,pooling_special_price_paise').not('pooling_special', 'is', null),
  ]);
  if (w.error) { if (isMissingSpecialFeature(w.error)) return out; throw w.error; }
  for (const r of (w.data || []) as any[]) (out.weekly[Number(r.weekday)] ||= {})[r.item_code] = Number(r.price_paise);
  if (!d.error) for (const r of (d.data || []) as any[]) (out.daily[r.menu_date] ||= {})[r.item_code] = r.pooling_special ? Number(r.pooling_special_price_paise) : null;
  else if (!isMissingSpecialFeature(d.error)) throw d.error;
  return out;
}

/** Same precedence as the server (gocanteen_private.effective_pooling_special): explicit daily TRUE/FALSE wins, else weekly. */
export function specialsForDate(s: CurrentSpecials, date: string): Record<string, number> {
  const res: Record<string, number> = { ...(s.weekly[getBusinessWeekday(date)] || {}) };
  for (const [code, v] of Object.entries(s.daily[date] || {})) { if (v == null) delete res[code]; else res[code] = v; }
  return res;
}

/** Rupees text -> paise; throws a friendly error for invalid input. */
export function parsePriceToPaise(text: string): number {
  const t = String(text ?? '').trim();
  const n = Number(t);
  if (t === '' || !Number.isFinite(n) || n < 0) throw new Error('Enter a valid price (0 or more).');
  return Math.round(n * 100);
}

/** Payments admins only (server-enforced). paise=null clears the price. */
export async function savePoolingSpecialItem(weekday: number, itemCode: string, paise: number | null): Promise<void> {
  if (!supabaseEnabled || !supabase) throw new Error('Not connected');
  const { error } = await supabase.rpc('set_pooling_special_item', { p_weekday: weekday, p_item_code: itemCode, p_price_paise: paise });
  if (error) throw error;
}

/** Server-RECORDED prices for already placed orders: orderId -> { member: code->paise, guest: code->paise }. */
export type OrderSpecialSnapshots = Record<string, { member: Record<string, number>; guest: Record<string, number> }>;
export async function loadOrderSpecialSnapshots(orderIds: string[]): Promise<OrderSpecialSnapshots> {
  const ids = [...new Set(orderIds.filter(Boolean))];
  if (!ids.length || !supabaseEnabled || !supabase) return {};
  const { data, error } = await supabase.from('order_items').select('order_id,item_code,item_source,pooling_special_unit_paise').in('order_id', ids).eq('pooling_special', true);
  if (error) { if (isMissingSpecialFeature(error)) return {}; throw error; }
  const out: OrderSpecialSnapshots = {};
  for (const r of (data || []) as any[]) {
    if (r.pooling_special_unit_paise == null) continue;
    const o = (out[r.order_id] ||= { member: {}, guest: {} });
    (r.item_source === 'guest' ? o.guest : o.member)[r.item_code] = Number(r.pooling_special_unit_paise);
  }
  return out;
}

/** Guest orders On/Off for the current canteen (all billing modes). Missing row/table => On (current behaviour). */
export async function loadGuestOrdersEnabled(): Promise<boolean> {
  if (!supabaseEnabled || !supabase) return true;
  const { data, error } = await supabase.from('canteen_guest_order_settings').select('guest_orders_enabled').maybeSingle();
  if (error) { if (isMissingSpecialFeature(error)) return true; throw error; }
  return data ? data.guest_orders_enabled !== false : true;
}
export async function saveGuestOrdersEnabled(enabled: boolean): Promise<boolean> {
  if (!supabaseEnabled || !supabase) throw new Error('Not connected');
  const { data, error } = await supabase.rpc('set_guest_orders_enabled', { p_enabled: enabled });
  if (error) throw error;
  return (data as any)?.guest_orders_enabled !== false;
}
