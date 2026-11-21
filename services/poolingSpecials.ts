import { supabase, supabaseEnabled } from '../supabase';
import { getBusinessWeekday } from '../utils/helpers';

/** Missing column/table/function (migration not applied yet) => feature simply absent, not an error. */
export const isMissingSpecialFeature = (e: any) => ['42P01', '42703', '42883', 'PGRST202', 'PGRST204', 'PGRST205'].includes(String(e?.code || '')) || /pooling_special|guest_order|does not exist|schema cache/i.test(String(e?.message || ''));

export type SpecialPricingMode = 'fixed' | 'shared';
export type SpecialFlag = { mode: 'fixed'; pricePaise: number } | { mode: 'shared' };

function parseFlag(r: any): SpecialFlag | null {
  if (!r) return null;
  const mode = String(r.pricing_mode || r.pooling_special_pricing_mode || 'fixed');
  if (mode === 'shared') return { mode: 'shared' };
  const paise = r.price_paise ?? r.pooling_special_price_paise ?? r.pooling_special_unit_paise;
  if (paise == null || !Number.isFinite(Number(paise))) return null;
  return { mode: 'fixed', pricePaise: Number(paise) };
}

/** weekday (0=Sunday) -> itemCode -> special flag (current menu; used only for NEW selections). */
export type WeeklySpecials = Record<number, Record<string, SpecialFlag>>;
/** date -> itemCode -> flag | null (explicit daily override; null = explicitly NOT special). */
export type DailySpecialOverrides = Record<string, Record<string, SpecialFlag | null>>;
export interface CurrentSpecials { weekly: WeeklySpecials; daily: DailySpecialOverrides }

export async function loadCurrentSpecials(): Promise<CurrentSpecials> {
  const out: CurrentSpecials = { weekly: {}, daily: {} };
  if (!supabaseEnabled || !supabase) return out;
  const [w, d] = await Promise.all([
    supabase.from('pooling_special_items').select('weekday,item_code,price_paise,pricing_mode'),
    supabase.from('daily_menu').select('menu_date,item_code,pooling_special,pooling_special_price_paise,pooling_special_pricing_mode').not('pooling_special', 'is', null),
  ]);
  if (w.error) {
    // Older schema without pricing_mode: fall back so existing specials still load.
    if (isMissingSpecialFeature(w.error) && /pricing_mode/i.test(String(w.error.message || ''))) {
      const w2 = await supabase.from('pooling_special_items').select('weekday,item_code,price_paise');
      if (w2.error) { if (isMissingSpecialFeature(w2.error)) return out; throw w2.error; }
      for (const r of (w2.data || []) as any[]) {
        const f = parseFlag(r);
        if (f) (out.weekly[Number(r.weekday)] ||= {})[r.item_code] = f;
      }
    } else {
      if (isMissingSpecialFeature(w.error)) return out; throw w.error;
    }
  } else {
    for (const r of (w.data || []) as any[]) {
      const f = parseFlag(r);
      if (f) (out.weekly[Number(r.weekday)] ||= {})[r.item_code] = f;
    }
  }
  if (!d.error) {
    for (const r of (d.data || []) as any[]) {
      (out.daily[r.menu_date] ||= {})[r.item_code] = r.pooling_special ? (parseFlag({
        pricing_mode: r.pooling_special_pricing_mode,
        price_paise: r.pooling_special_price_paise,
      }) || (r.pooling_special_price_paise != null ? { mode: 'fixed', pricePaise: Number(r.pooling_special_price_paise) } : { mode: 'shared' })) : null;
    }
  } else if (!isMissingSpecialFeature(d.error)) throw d.error;
  return out;
}

/** Flags for a date (fixed + shared). Same precedence as the server. */
function asFlag(v: any): SpecialFlag | null {
  if (v == null) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return { mode: 'fixed', pricePaise: v };
  if (v.mode === 'shared') return { mode: 'shared' };
  if (typeof v.pricePaise === 'number') return { mode: 'fixed', pricePaise: v.pricePaise };
  if (v.mode === 'fixed' && v.pricePaise != null) return { mode: 'fixed', pricePaise: Number(v.pricePaise) };
  return null;
}

export function specialFlagsForDate(s: CurrentSpecials, date: string): Record<string, SpecialFlag> {
  const res: Record<string, SpecialFlag> = {};
  for (const [code, v] of Object.entries(s.weekly[getBusinessWeekday(date)] || {})) {
    const f = asFlag(v);
    if (f) res[code] = f;
  }
  for (const [code, v] of Object.entries(s.daily[date] || {})) {
    if (v == null) delete res[code];
    else { const f = asFlag(v); if (f) res[code] = f; else delete res[code]; }
  }
  return res;
}

/** Fixed-price map only (backward compatible with existing callers/tests). */
export function specialsForDate(s: CurrentSpecials, date: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [code, v] of Object.entries(specialFlagsForDate(s, date))) if (v.mode === 'fixed') out[code] = v.pricePaise;
  return out;
}

/** Rupees text -> paise; throws a friendly error for invalid input. */
export function parsePriceToPaise(text: string): number {
  const t = String(text ?? '').trim();
  const n = Number(t);
  if (t === '' || !Number.isFinite(n) || n < 0) throw new Error('Enter a valid price (0 or more).');
  return Math.round(n * 100);
}

/** Payments admins only (server-enforced). value=null clears the special. */
export async function savePoolingSpecialItem(weekday: number, itemCode: string, value: SpecialFlag | number | null): Promise<void> {
  if (!supabaseEnabled || !supabase) throw new Error('Not connected');
  let args: { p_weekday: number; p_item_code: string; p_price_paise: number | null; p_pricing_mode?: SpecialPricingMode };
  if (value == null) args = { p_weekday: weekday, p_item_code: itemCode, p_price_paise: null, p_pricing_mode: 'fixed' };
  else if (typeof value === 'number') args = { p_weekday: weekday, p_item_code: itemCode, p_price_paise: value, p_pricing_mode: 'fixed' };
  else if (value.mode === 'shared') args = { p_weekday: weekday, p_item_code: itemCode, p_price_paise: null, p_pricing_mode: 'shared' };
  else args = { p_weekday: weekday, p_item_code: itemCode, p_price_paise: value.pricePaise, p_pricing_mode: 'fixed' };
  const { error } = await supabase.rpc('set_pooling_special_item', args);
  if (error) throw error;
}

/** Payments admins: enter or clear (null) the day's Shared cost total for one special. */
export async function savePoolingSpecialSharedCost(date: string, itemCode: string, totalPaise: number | null): Promise<void> {
  if (!supabaseEnabled || !supabase) throw new Error('Not connected');
  const { error } = await supabase.rpc('set_pooling_special_shared_cost', { p_date: date, p_item_code: itemCode, p_total_paise: totalPaise });
  if (error) throw error;
}

/** Server-RECORDED specials for already placed orders: orderId -> { member: code->flag, guest: code->flag }. */
export type OrderSpecialSnapshots = Record<string, { member: Record<string, SpecialFlag>; guest: Record<string, SpecialFlag> }>;
export async function loadOrderSpecialSnapshots(orderIds: string[]): Promise<OrderSpecialSnapshots> {
  const ids = [...new Set(orderIds.filter(Boolean))];
  if (!ids.length || !supabaseEnabled || !supabase) return {};
  let data: any[] | null = null;
  let error: any = null;
  ({ data, error } = await supabase.from('order_items').select('order_id,item_code,item_source,pooling_special_unit_paise,pooling_special_pricing_mode').in('order_id', ids).eq('pooling_special', true));
  if (error && isMissingSpecialFeature(error) && /pricing_mode/i.test(String(error.message || ''))) {
    ({ data, error } = await supabase.from('order_items').select('order_id,item_code,item_source,pooling_special_unit_paise').in('order_id', ids).eq('pooling_special', true));
  }
  if (error) { if (isMissingSpecialFeature(error)) return {}; throw error; }
  const out: OrderSpecialSnapshots = {};
  for (const r of (data || []) as any[]) {
    const f = parseFlag(r);
    if (!f) continue;
    const o = (out[r.order_id] ||= { member: {}, guest: {} });
    (r.item_source === 'guest' ? o.guest : o.member)[r.item_code] = f;
  }
  return out;
}

export const rupees = (paise: number) => `₹${(paise / 100).toFixed(2)}`;
export function menuSpecialLabel(s: SpecialFlag | undefined | null): string | null {
  if (!s) return null;
  return s.mode === 'shared' ? 'Shared cost' : `${rupees(s.pricePaise)} extra`;
}
export function recordedSpecialLabel(s: SpecialFlag | undefined | null, qty = 1): string | null {
  if (!s) return null;
  return s.mode === 'shared' ? 'Shared cost' : `${rupees(s.pricePaise * Math.max(1, Number(qty) || 1))} extra`;
}
export function recordedFixedTotal(m: Record<string, SpecialFlag> | undefined, q?: Record<string, number>): number {
  return Object.entries(m || {}).reduce((t, [c, s]) => t + (s?.mode === 'fixed' ? s.pricePaise * Math.max(1, Number(q?.[c] || 1)) : 0), 0);
}
export function hasSharedSpecial(m: Record<string, SpecialFlag> | undefined): boolean {
  return Object.values(m || {}).some(s => s?.mode === 'shared');
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
