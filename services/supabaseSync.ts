import { supabase, supabaseEnabled } from '../supabase';
import { User, Order, Prices, OrderItems, MenuItem } from '../types';

const itemCodes: (keyof OrderItems)[] = [
  'morningTea',
  'lunchMeals',
  'lunchEgg',
  'lunchFishMeat',
  'eveningTea',
];

const defaultNames: Record<string, string> = {
  morningTea: 'Morning Tea',
  lunchMeals: 'Lunch: Meals',
  lunchEgg: 'Lunch: Egg (add-on)',
  lunchFishMeat: 'Lunch: Fish/Meat (add-on)',
  eveningTea: 'Evening Tea',
};

export async function loadSupabaseData() {
  if (!supabaseEnabled || !supabase) return null;

  const [
    { data: profiles, error: pErr },
    { data: orders, error: oErr },
    { data: menu, error: mErr },
    { data: holidays, error: hErr },
  ] = await Promise.all([
    supabase.from('profiles').select('*'),
    supabase
      .from('orders')
      .select('id,employee_id,ordered_for,status,created_at,updated_at,cancelled_at,order_items(id,item_code,quantity,unit_price)')
      .order('ordered_for', { ascending: false }),
    supabase
      .from('menu_prices')
      .select('item_code,item_name,unit_price,active,updated_at')
      .order('item_code'),
    supabase.from('holidays').select('holiday_date,reason').order('holiday_date'),
  ]);

  if (pErr) throw pErr;
  if (oErr) throw oErr;
  if (mErr) throw mErr;
  if (hErr) throw hErr;

  const users: User[] = (profiles || []).map((p: any) => ({
    id: p.employee_code || p.sr_number || p.id,
    name: p.full_name || '',
    mobile: p.mobile_number || '',
    password: '',
    role: p.role,
    status: 'active',
    isFirstLogin: false,
  }));

  const profileByUuid = new Map((profiles || []).map((p: any) => [p.id, p]));

  const mappedOrders: Order[] = (orders || [])
    .filter((o: any) => o.status !== 'cancelled')
    .map((o: any) => {
      const items: OrderItems = {
        morningTea: false,
        lunchMeals: false,
        lunchEgg: false,
        lunchFishMeat: false,
        eveningTea: false,
      };

      (o.order_items || []).forEach((i: any) => {
        if (i.item_code in items) {
          items[i.item_code as keyof OrderItems] = Number(i.quantity) > 0;
        }
      });

      const ep: any = profileByUuid.get(o.employee_id);

      return {
        id: o.id,
        employeeId: ep?.employee_code || ep?.sr_number || o.employee_id,
        date: o.ordered_for,
        items,
      };
    });

  const prices: Prices = {
    morningTea: 8,
    lunchMeals: 40,
    lunchEgg: 10,
    lunchFishMeat: 25,
    eveningTea: 8,
  };

  const menuItems: MenuItem[] = (menu || []).map((r: any) => {
    if (r.item_code in prices) {
      prices[r.item_code as keyof Prices] = Number(r.unit_price);
    }

    return {
      itemCode: r.item_code,
      itemName: r.item_name || defaultNames[r.item_code] || r.item_code,
      unitPrice: Number(r.unit_price),
      active: Boolean(r.active),
    };
  });

  return {
    users,
    orders: mappedOrders,
    prices,
    menuItems,
    holidays: (holidays || []).map((h: any) => String(h.holiday_date)),
  };
}

export async function upsertOrder(order: Order, prices: Prices) {
  if (!supabaseEnabled || !supabase) return;

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id')
    .or(`employee_code.eq.${order.employeeId},sr_number.eq.${order.employeeId}`)
    .maybeSingle();

  if (profileError) throw profileError;
  if (!profile) return;

  const { error: orderError } = await supabase.from('orders').upsert(
    {
      id: order.id,
      employee_id: profile.id,
      ordered_for: order.date,
      status: 'active',
    },
    { onConflict: 'id' }
  );

  if (orderError) throw orderError;

  const { error: deleteError } = await supabase
    .from('order_items')
    .delete()
    .eq('order_id', order.id);

  if (deleteError) throw deleteError;

  const rows = itemCodes
    .filter(k => order.items[k])
    .map(k => ({
      order_id: order.id,
      item_code: k,
      quantity: 1,
      unit_price: prices[k],
    }));

  if (rows.length) {
    const { error: insertError } = await supabase.from('order_items').insert(rows);
    if (insertError) throw insertError;
  }
}

export async function cancelOrder(order: Order) {
  if (!supabaseEnabled || !supabase) return;

  const { error } = await supabase
    .from('orders')
    .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
    .eq('id', order.id);

  if (error) throw error;
}

export async function upsertPrices(prices: Prices, menuItems: MenuItem[] = []) {
  if (!supabaseEnabled || !supabase) return;

  const existingItems = new Map(menuItems.map(item => [item.itemCode, item]));
  const rows = itemCodes.map(k => {
    const item = existingItems.get(k);
    return {
      item_code: k,
      item_name: item?.itemName || defaultNames[k] || k,
      unit_price: prices[k],
      active: item?.active ?? true,
    };
  });

  const { error } = await supabase
    .from('menu_prices')
    .upsert(rows, { onConflict: 'item_code' });

  if (error) throw error;
}

export async function saveMenuItem(item: MenuItem) {
  if (!supabaseEnabled || !supabase) return;

  const { error } = await supabase.from('menu_prices').upsert(
    {
      item_code: item.itemCode,
      item_name: item.itemName,
      unit_price: item.unitPrice,
      active: item.active,
    },
    { onConflict: 'item_code' }
  );

  if (error) throw error;
}

export async function deactivateMenuItem(itemCode: string) {
  if (!supabaseEnabled || !supabase) return;
  const { error } = await supabase.from('menu_prices').update({ active: false }).eq('item_code', itemCode);
  if (error) throw error;
}

export async function activateMenuItem(itemCode: string) {
  if (!supabaseEnabled || !supabase) return;
  const { error } = await supabase.from('menu_prices').update({ active: true }).eq('item_code', itemCode);
  if (error) throw error;
}

export async function saveHoliday(holidayDate: string, reason = '') {
  if (!supabaseEnabled || !supabase) return;

  const { error } = await supabase.from('holidays').upsert(
    { holiday_date: holidayDate, reason: reason || null },
    { onConflict: 'holiday_date' }
  );

  if (error) throw error;
}

export async function removeHoliday(holidayDate: string) {
  if (!supabaseEnabled || !supabase) return;

  const { error } = await supabase.from('holidays').delete().eq('holiday_date', holidayDate);
  if (error) throw error;
}
