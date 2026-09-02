import { supabase, supabaseEnabled } from '../supabase';

export interface MonthlyBill {
  id: string;
  employee_id: string;
  bill_month: number;
  bill_year: number;
  food_total: number;
  admin_added_total: number;
  total: number;
  published: boolean;
  published_at?: string | null;
}

export async function loadPublishedBills(): Promise<MonthlyBill[]> {
  if (!supabaseEnabled || !supabase) return [];
  const { data, error } = await supabase.from('monthly_bills').select('*').eq('published', true).order('bill_year', { ascending: false }).order('bill_month', { ascending: false });
  if (error) throw error;
  return (data || []).map((row: any) => ({ ...row, food_total: Number(row.food_total), admin_added_total: Number(row.admin_added_total), total: Number(row.total) }));
}

export async function upsertBill(employeeId: string, month: number, year: number, foodTotal: number, adminAddedTotal: number, publish = false) {
  if (!supabaseEnabled || !supabase) throw new Error('Supabase is not enabled.');
  const payload: any = {
    employee_id: employeeId,
    bill_month: month,
    bill_year: year,
    food_total: Number(foodTotal),
    admin_added_total: Number(adminAddedTotal),
    total: Number(foodTotal) + Number(adminAddedTotal),
    published: publish,
    updated_at: new Date().toISOString(),
  };
  if (publish) payload.published_at = new Date().toISOString();
  const { data, error } = await supabase.from('monthly_bills').upsert(payload, { onConflict: 'employee_id,bill_month,bill_year' }).select('*').single();
  if (error) throw error;
  return data as MonthlyBill;
}

export async function loadAdminBills(month: number, year: number) {
  if (!supabaseEnabled || !supabase) return [] as MonthlyBill[];
  const { data, error } = await supabase.from('monthly_bills').select('*').eq('bill_month', month).eq('bill_year', year);
  if (error) throw error;
  return (data || []).map((row: any) => ({ ...row, food_total: Number(row.food_total), admin_added_total: Number(row.admin_added_total), total: Number(row.total) }));
}
