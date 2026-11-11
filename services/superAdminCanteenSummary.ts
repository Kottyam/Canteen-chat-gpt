import { supabase } from '../supabase';

export interface CanteenSummaryMoney {
  published_bills: number; billed_total: number; paid: number; pending_verification: number; outstanding: number; last_published_at: string | null;
}
export interface CanteenSummaryMonth { key: string; year: number; month: number; bills: number; billed_total: number; paid: number; outstanding: number; last_published_at: string | null }
export interface SuperAdminCanteenSummary {
  canteen: { id: string; name: string; created_at: string; archived: boolean; member_login_mode?: string | null };
  settings: { billing_model: 'standard' | 'pooling' | string; bill_send_mode: string; mess_cut_min_days: number | null };
  members: { active: number; total: number; admins: number };
  period: { year: number; month: number; start: string; end: string; is_current: boolean; today: string };
  month: CanteenSummaryMoney & { fully_paid_bills: number; orders: number; cancelled_orders: number; admin_orders: number; members_ordered: number; admin_added: number; expenses: number; unbilled: number | null };
  all_time: CanteenSummaryMoney & { first_bill_month: string | null; orders: number };
  months: CanteenSummaryMonth[];
}

/** Read-only. Server refuses anyone who is not an active Super Admin. */
export async function loadSuperAdminCanteenSummary(canteenId: string, year?: number, month?: number): Promise<SuperAdminCanteenSummary> {
  if (!supabase) throw new Error('Not connected');
  const { data, error } = await supabase.rpc('super_admin_canteen_summary', { p_canteen_id: canteenId, p_year: year ?? null, p_month: month ?? null });
  if (error) throw error;
  return data as SuperAdminCanteenSummary;
}

export interface SuperAdminCanteenMember {
  id: string; name: string | null; employee_code: string | null; sr_number: string | null;
  mobile: string | null; email: string | null; role: string; admin_role: string | null; status: string | null; joined_at: string | null;
}
export interface SuperAdminMenuItem { item_code: string; item_name: string; unit_price: number; active: boolean; archived?: boolean; category?: string | null; updated_at?: string | null }
export interface SuperAdminCanteenMenu {
  items: SuperAdminMenuItem[];
  today: string;
  today_menu: (SuperAdminMenuItem & { pooling_special?: boolean })[];
  weekly: (SuperAdminMenuItem & { weekday: number })[];
}

/** Read-only, loaded only when the Super Admin opens the Members view. */
export async function loadSuperAdminCanteenMembers(canteenId: string): Promise<SuperAdminCanteenMember[]> {
  if (!supabase) throw new Error('Not connected');
  const { data, error } = await supabase.rpc('super_admin_canteen_members', { p_canteen_id: canteenId });
  if (error) throw error;
  return Array.isArray(data) ? data as SuperAdminCanteenMember[] : [];
}

/** Read-only, loaded only when the Super Admin opens the Menu view. */
export async function loadSuperAdminCanteenMenu(canteenId: string): Promise<SuperAdminCanteenMenu> {
  if (!supabase) throw new Error('Not connected');
  const { data, error } = await supabase.rpc('super_admin_canteen_menu', { p_canteen_id: canteenId });
  if (error) throw error;
  const d: any = data || {};
  return { items: d.items || [], today: d.today || '', today_menu: d.today_menu || [], weekly: d.weekly || [] };
}
