// Loads PoolingInput for one canteen/month from the EXISTING tables (expenses,
// orders/order_items, profiles, holidays, employee_adjustments). Works with the
// browser client (RLS-scoped admin) and the service-role client in the Edge
// Function; canteen_id is ALWAYS filtered explicitly so service-role reads stay
// tenant scoped.
import { POOLING_ENGINE_VERSION, type PoolingInput, type PoolingMember, type SharedSpecialCost, type SharedSpecialOrder, monthStart, monthEnd, toPaise, istBusinessDate, expenseSplitModeOrDefault } from './poolingBilling.ts';

export interface PoolingSource { canteenId: string; year: number; month: number; messCutMinDays: number; messCutMode?: import('./poolingBilling.ts').MessCutMode; /** running-month draft cutoff (inclusive) */ asOf?: string }

async function q<T = any>(p: PromiseLike<{ data: T[] | null; error: any }>): Promise<T[]> {
  const { data, error } = await p; if (error) throw error; return data || [];
}

async function loadSharedCosts(db: any, canteenId: string, start: string, end: string): Promise<any[]> {
  const { data, error } = await db.from('pooling_special_shared_costs').select('special_date,item_code,total_paise').eq('canteen_id', canteenId).gte('special_date', start).lte('special_date', end);
  if (error) {
    if (/pooling_special_shared_costs|42P01|42703|does not exist|schema cache/i.test(String(error.message || error.code || ''))) return [];
    throw error;
  }
  return data || [];
}

function itemIsSharedSpecial(i: any): boolean {
  if (!i?.pooling_special || !(Number(i.quantity) > 0)) return false;
  return String(i.pooling_special_pricing_mode || '') === 'shared';
}

export async function loadPoolingInput(db: any, src: PoolingSource): Promise<PoolingInput & { memberNames: Record<string, string> }> {
  const start = monthStart(src.year, src.month), fullEnd = monthEnd(src.year, src.month);
  const end = src.asOf && src.asOf < fullEnd ? src.asOf : fullEnd;
  const inWin = (d: any) => { const x = String(d ?? '').slice(0, 10); return x >= start && x <= end; };
  const [expenses0, orders0, profiles, holidays0, holidaySettings, adjustments0, sharedCosts0] = await Promise.all([
    q(db.from('expenses').select('id,expense_date,amount,split_mode').eq('canteen_id', src.canteenId).gte('expense_date', start).lte('expense_date', end)),
    q(db.from('orders').select('id,employee_id,ordered_for,status,order_items(item_source,item_code,item_name,quantity,pooling_special,pooling_special_unit_paise,pooling_special_pricing_mode)').eq('canteen_id', src.canteenId).gte('ordered_for', start).lte('ordered_for', end)),
    q(db.from('profiles').select('id,full_name,role,status,created_at').eq('canteen_id', src.canteenId).eq('role', 'employee')),
    q(db.from('holiday_dates').select('holiday_date').eq('canteen_id', src.canteenId).gte('holiday_date', start).lte('holiday_date', end)),
    q(db.from('holiday_settings').select('recurring_weekdays').eq('canteen_id', src.canteenId)),
    q(db.from('employee_adjustments').select('employee_id,amount,adjustment_date').eq('canteen_id', src.canteenId).gte('adjustment_date', start).lte('adjustment_date', end)),
    loadSharedCosts(db, src.canteenId, start, end),
  ]);
  // Same window enforced client-side too, so nothing after the cutoff can leak into a draft.
  const expenses = expenses0.filter((e: any) => inWin(e.expense_date)), orders = orders0.filter((o: any) => inWin(o.ordered_for));
  const holidays = holidays0.filter((h: any) => inWin(h.holiday_date)), adjustments = adjustments0.filter((a: any) => inWin(a.adjustment_date));
  // Membership periods (join/leave dates). Missing table (migration not applied) => legacy behaviour.
  let periods: any[] | null = null;
  { const { data, error } = await db.from('pooling_member_periods').select('employee_id,joined_on,left_on').eq('canteen_id', src.canteenId).lte('joined_on', end);
    if (error) { if (!/pooling_member_periods|42P01|does not exist|schema cache/i.test(String(error.message || error.code || ''))) throw error; }
    else periods = data || []; }
  // Fixed-price specials: only server snapshots (pooling_special + unit_paise) on ACTIVE orders count.
  // Shared-cost specials: distinct members who ordered that item that day (qty ignored; member+guests = one share).
  const specials: Record<string, { memberPaise: number; guestPaise: number }> = {};
  const sharedSpecialOrders: SharedSpecialOrder[] = [];
  const seenShared = new Set<string>();
  for (const o of orders as any[]) {
    if ((o.status || 'active') !== 'active') continue;
    for (const i of (Array.isArray(o.order_items) ? o.order_items : [])) {
      if (!i.pooling_special || !(Number(i.quantity) > 0)) continue;
      if (itemIsSharedSpecial(i)) {
        const key = `${o.employee_id}|${String(o.ordered_for).slice(0, 10)}|${i.item_code}`;
        if (seenShared.has(key)) continue;
        seenShared.add(key);
        sharedSpecialOrders.push({ memberId: o.employee_id, date: String(o.ordered_for).slice(0, 10), itemCode: i.item_code, itemName: i.item_name || i.item_code });
        continue;
      }
      if (i.pooling_special_unit_paise == null) continue;
      const amt = Math.round(Number(i.quantity)) * Math.round(Number(i.pooling_special_unit_paise));
      const s0 = specials[o.employee_id] || (specials[o.employee_id] = { memberPaise: 0, guestPaise: 0 });
      if (i.item_source === 'guest') s0.guestPaise += amt; else s0.memberPaise += amt;
    }
  }
  const sharedSpecialCosts: SharedSpecialCost[] = (sharedCosts0 as any[]).filter(c => inWin(c.special_date)).map(c => ({
    date: String(c.special_date).slice(0, 10), itemCode: c.item_code, totalPaise: Math.round(Number(c.total_paise) || 0),
  }));
  const adminAdded = new Map<string, number>();
  for (const a of adjustments as any[]) adminAdded.set(a.employee_id, (adminAdded.get(a.employee_id) || 0) + toPaise(a.amount));
  const byMember = new Map<string, { from: string; to: string | null }[]>();
  for (const r of periods || []) {
    const list = byMember.get(r.employee_id) || []; list.push({ from: String(r.joined_on).slice(0, 10), to: r.left_on ? String(r.left_on).slice(0, 10) : null }); byMember.set(r.employee_id, list);
  }
  const members: PoolingMember[] = (profiles as any[]).flatMap((p): PoolingMember[] => {
    const ps = byMember.get(p.id);
    if (ps?.length) return [{ memberId: p.id, periods: ps, adminAddedPaise: adminAdded.get(p.id) || 0 }];
    if (p.status === 'deleted') return []; // removed before periods were recorded: leave date unknown, not guessed
    return [{ memberId: p.id, activeFrom: p.created_at ? istBusinessDate(new Date(p.created_at)) : null, activeTo: null, adminAddedPaise: adminAdded.get(p.id) || 0 }];
  });
  return {
    year: src.year, month: src.month, messCutMinDays: src.messCutMinDays, messCutMode: src.messCutMode, ...(src.asOf ? { asOf: src.asOf } : {}),
    expenses: (expenses as any[]).map(e => ({ id: e.id, date: String(e.expense_date).slice(0, 10), amountPaise: toPaise(e.amount), splitMode: expenseSplitModeOrDefault(e.split_mode) })).filter(e => e.amountPaise > 0),
    orders: (orders as any[]).map(o => {
      const items = Array.isArray(o.order_items) ? o.order_items : [];
      return { memberId: o.employee_id, date: String(o.ordered_for).slice(0, 10), status: o.status || 'active', guestOnly: items.length === 0 || items.every((i: any) => i.item_source === 'guest') };
    }),
    members,
    specials,
    sharedSpecialCosts,
    sharedSpecialOrders,
    holidayDates: (holidays as any[]).map(h => String(h.holiday_date).slice(0, 10)),
    recurringWeekdays: ((holidaySettings as any[])[0]?.recurring_weekdays || []).map(Number),
    memberNames: Object.fromEntries((profiles as any[]).map(p => [p.id, p.full_name || ''])),
  };
}

/** Serializable snapshot sent to save_pooling_bill_run (server re-validates totals). */
export function poolingPayload(r: import('./poolingBilling.ts').PoolingResult) {
  return { ...r, engineVersion: POOLING_ENGINE_VERSION };
}
