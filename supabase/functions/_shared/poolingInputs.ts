// Loads PoolingInput for one canteen/month from the EXISTING tables (expenses,
// orders/order_items, profiles, holidays, employee_adjustments). Works with the
// browser client (RLS-scoped admin) and the service-role client in the Edge
// Function; canteen_id is ALWAYS filtered explicitly so service-role reads stay
// tenant scoped.
import { type PoolingInput, monthStart, monthEnd, toPaise, istBusinessDate } from './poolingBilling.ts';

export interface PoolingSource { canteenId: string; year: number; month: number; messCutMinDays: number }

async function q<T = any>(p: PromiseLike<{ data: T[] | null; error: any }>): Promise<T[]> {
  const { data, error } = await p; if (error) throw error; return data || [];
}

export async function loadPoolingInput(db: any, src: PoolingSource): Promise<PoolingInput & { memberNames: Record<string, string> }> {
  const start = monthStart(src.year, src.month), end = monthEnd(src.year, src.month);
  const [expenses, orders, profiles, holidays, holidaySettings, adjustments] = await Promise.all([
    q(db.from('expenses').select('id,expense_date,amount').eq('canteen_id', src.canteenId).gte('expense_date', start).lte('expense_date', end)),
    q(db.from('orders').select('id,employee_id,ordered_for,status,order_items(item_source)').eq('canteen_id', src.canteenId).gte('ordered_for', start).lte('ordered_for', end)),
    q(db.from('profiles').select('id,full_name,role,status,created_at').eq('canteen_id', src.canteenId).eq('role', 'employee')),
    q(db.from('holiday_dates').select('holiday_date').eq('canteen_id', src.canteenId).gte('holiday_date', start).lte('holiday_date', end)),
    q(db.from('holiday_settings').select('recurring_weekdays').eq('canteen_id', src.canteenId)),
    q(db.from('employee_adjustments').select('employee_id,amount,adjustment_date').eq('canteen_id', src.canteenId).gte('adjustment_date', start).lte('adjustment_date', end)),
  ]);
  const adminAdded = new Map<string, number>();
  for (const a of adjustments as any[]) adminAdded.set(a.employee_id, (adminAdded.get(a.employee_id) || 0) + toPaise(a.amount));
  const members = (profiles as any[]).filter(p => p.status !== 'deleted').map(p => ({
    memberId: p.id,
    activeFrom: p.created_at ? istBusinessDate(new Date(p.created_at)) : null,
    activeTo: null,
    adminAddedPaise: Math.max(0, adminAdded.get(p.id) || 0),
  }));
  return {
    year: src.year, month: src.month, messCutMinDays: src.messCutMinDays,
    expenses: (expenses as any[]).map(e => ({ id: e.id, date: String(e.expense_date).slice(0, 10), amountPaise: toPaise(e.amount) })).filter(e => e.amountPaise > 0),
    orders: (orders as any[]).map(o => {
      const items = Array.isArray(o.order_items) ? o.order_items : [];
      return { memberId: o.employee_id, date: String(o.ordered_for).slice(0, 10), status: o.status || 'active', guestOnly: items.length === 0 || items.every((i: any) => i.item_source === 'guest') };
    }),
    members,
    holidayDates: (holidays as any[]).map(h => String(h.holiday_date).slice(0, 10)),
    recurringWeekdays: ((holidaySettings as any[])[0]?.recurring_weekdays || []).map(Number),
    memberNames: Object.fromEntries((profiles as any[]).map(p => [p.id, p.full_name || ''])),
  };
}

/** Serializable snapshot sent to save_pooling_bill_run (server re-validates totals). */
export function poolingPayload(r: import('./poolingBilling.ts').PoolingResult) {
  return { ...r, engineVersion: 1 };
}
