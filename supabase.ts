import { createClient } from '@supabase/supabase-js';

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://cdrjfukxirkanrdklnli.supabase.co';
// This is the Supabase publishable client key (safe for the browser/mobile client).
// Keep service-role/secret keys out of the app.
export const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_PirI2jk8r0rm5r3drpYMqA_f2IvAphx';

export const supabaseEnabled = Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);
export const supabase = supabaseEnabled
  ? createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)
  : null;

export const internalEmailForLogin = (id: string) => `${id}@gocanteen.local`;
