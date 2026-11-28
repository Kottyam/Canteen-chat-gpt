import { supabase } from '../supabase';

async function invoke(body: Record<string, unknown>) {
  if (!supabase) throw new Error('Supabase is not enabled.');
  const { data, error } = await supabase.functions.invoke('manage-canteen-login', { body });
  if (error) {
    try {
      const context = (error as any)?.context;
      if (context?.json) {
        const payload = await context.json();
        if (payload?.error) throw new Error(String(payload.error));
      }
    } catch (parsed: any) {
      if (parsed?.message && !String(parsed.message).includes('body')) throw parsed;
    }
    throw error;
  }
  if ((data as any)?.error) throw new Error(String((data as any).error));
  return data as any;
}

export async function setCanteenLoginId(canteenId: string, loginId: string, password?: string) {
  return invoke({ action: 'set_login_id', canteen_id: canteenId, login_id: loginId, password: password || undefined });
}

export async function resetCanteenLoginPassword(canteenId: string, password: string) {
  return invoke({ action: 'reset_password', canteen_id: canteenId, password });
}

export async function changeCanteenLoginPassword(currentPassword: string, newPassword: string) {
  return invoke({ action: 'change_password', current_password: currentPassword, new_password: newPassword });
}
