import { supabase, supabaseEnabled } from '../supabase';
import { User, Order, Prices, OrderItems } from '../types';

const itemCodes: (keyof OrderItems)[] = ['morningTea','lunchMeals','lunchEgg','lunchFishMeat','eveningTea'];

export async function loadSupabaseData() {
  if (!supabaseEnabled || !supabase) return null;
  const [{ data: profiles, error: pErr }, { data: orders, error: oErr }, { data: prices, error: mErr }] = await Promise.all([
    supabase.from('profiles').select('*'),
    supabase.from('orders').select('id,employee_id,ordered_for,status,created_at,updated_at,cancelled_at,order_items(id,item_code,quantity,unit_price)').order('ordered_for', { ascending: false }),
    supabase.from('menu_prices').select('item_code,unit_price,active'),
  ]);
  if (pErr) throw pErr; if (oErr) throw oErr; if (mErr) throw mErr;
  const users: User[] = (profiles || []).map((p: any) => ({ id: p.employee_code || p.sr_number || p.id, name: p.full_name || '', mobile: p.mobile_number || '', password: '', role: p.role, status: 'active', isFirstLogin: false }));
  const profileByUuid = new Map((profiles || []).map((p:any) => [p.id, p]));
  const mappedOrders: Order[] = (orders || []).map((o: any) => {
    const items: OrderItems = { morningTea:false,lunchMeals:false,lunchEgg:false,lunchFishMeat:false,eveningTea:false };
    (o.order_items || []).forEach((i: any) => { if (i.item_code in items) items[i.item_code as keyof OrderItems] = Number(i.quantity) > 0; });
    const ep:any = profileByUuid.get(o.employee_id);
    return { id:o.id, employeeId:ep?.employee_code || ep?.sr_number || o.employee_id, date:o.ordered_for, items };
  });
  const p: Prices = { morningTea:8,lunchMeals:40,lunchEgg:10,lunchFishMeat:25,eveningTea:8 };
  (prices || []).forEach((r:any) => { if (r.item_code in p) p[r.item_code as keyof Prices] = Number(r.unit_price); });
  return { users, orders: mappedOrders, prices: p };
}

export async function upsertOrder(order: Order, prices: Prices) {
  if (!supabaseEnabled || !supabase) return;
  const { data: profile } = await supabase.from('profiles').select('id').or(`employee_code.eq.${order.employeeId},sr_number.eq.${order.employeeId}`).maybeSingle();
  if (!profile) return;
  await supabase.from('orders').upsert({ id: order.id, employee_id: profile.id, ordered_for: order.date, status:'active' }, { onConflict:'id' });
  await supabase.from('order_items').delete().eq('order_id', order.id);
  const rows = itemCodes.filter(k => order.items[k]).map(k => ({ order_id:order.id, item_code:k, quantity:1, unit_price:prices[k] }));
  if (rows.length) await supabase.from('order_items').insert(rows);
}
export async function cancelOrder(order: Order) {
  if (!supabaseEnabled || !supabase) return;
  await supabase.from('orders').update({ status:'cancelled', cancelled_at:new Date().toISOString() }).eq('id', order.id);
}
export async function upsertPrices(prices: Prices) {
  if (!supabaseEnabled || !supabase) return;
  const rows = itemCodes.map(k => ({ item_code:k, item_name:k, unit_price:prices[k], active:true }));
  await supabase.from('menu_prices').upsert(rows, { onConflict:'item_code' });
}
