import { createClient } from '@supabase/supabase-js';
import { Capacitor } from '@capacitor/core';

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://cdrjfukxirkanrdklnli.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_PirI2jk8r0rm5r3drpYMqA_f2IvAphx';
export const supabaseEnabled = Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);
export const IS_NATIVE = Capacitor.isNativePlatform();
export const GOOGLE_REDIRECT_URL = IS_NATIVE ? 'gocanteen://auth/callback' : `${window.location.origin}/`;
export const supabase = supabaseEnabled
  ? createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // Native OAuth is completed explicitly from the existing Capacitor
        // appUrlOpen handler. Browser OAuth keeps URL detection enabled.
        detectSessionInUrl: !IS_NATIVE,
        flowType: 'pkce'
      }
    })
  : null;
export const internalEmailForLogin = (id: string) => `${id}@gocanteen.local`;
