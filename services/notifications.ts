import { supabase, supabaseEnabled } from '../supabase';

export interface NotificationRow {
  id: string;
  recipient_id: string;
  notification_type: string;
  title: string;
  message: string;
  payload: Record<string, unknown>;
  read_at?: string | null;
  created_at: string;
}

export async function loadMyNotifications(): Promise<NotificationRow[]> {
  if (!supabaseEnabled || !supabase) return [];
  const { data, error } = await supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(50);
  if (error) throw error;
  return (data || []) as NotificationRow[];
}

export async function markNotificationRead(id: string) {
  if (!supabaseEnabled || !supabase) return;
  const { error } = await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

export async function notifyEmployee(employeeId: string, title: string, message: string, type = 'admin_update', payload: Record<string, unknown> = {}) {
  if (!supabaseEnabled || !supabase) return;
  const { error } = await supabase.from('notifications').insert({ recipient_id: employeeId, title, message, notification_type: type, payload });
  if (error) throw error;
}
