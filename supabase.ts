import { createClient } from '@supabase/supabase-js';
import { Capacitor } from '@capacitor/core';

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://cdrjfukxirkanrdklnli.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_PirI2jk8r0rm5r3drpYMqA_f2IvAphx';
export const supabaseEnabled = Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);
export const IS_NATIVE = Capacitor.isNativePlatform();

const IS_ANDROID_BUILD = import.meta.env.VITE_CAPACITOR_ANDROID_BUILD === 'true';
const NATIVE_GOOGLE_REDIRECT_URL = import.meta.env.VITE_GOOGLE_REDIRECT_URL || 'gocanteen://auth/callback';
export const GOOGLE_REDIRECT_URL = IS_NATIVE || IS_ANDROID_BUILD
  ? NATIVE_GOOGLE_REDIRECT_URL
  : `${window.location.origin}/`;

export const supabase = supabaseEnabled
  ? createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: !(IS_NATIVE || IS_ANDROID_BUILD),
        flowType: 'pkce'
      }
    })
  : null;

export const normalizeMobileNumber = (value: string) => {
  const digits = String(value || '').trim().replace(/[^0-9]/g, '');
  return /^91[6-9][0-9]{9}$/.test(digits) ? digits.slice(-10) : digits;
};

export const internalEmailForLogin = (id: string) => {
  const normalizedId = normalizeMobileNumber(id);
  // Preserve the existing legacy Admin Auth identity while exposing 229132 as
  // the numeric human-facing Admin User ID.
  if (normalizedId === '229132') return 'admin@gocanteen.local';
  return `${normalizedId}@gocanteen.local`;
};
