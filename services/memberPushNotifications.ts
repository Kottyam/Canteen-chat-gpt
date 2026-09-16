import { Capacitor } from '@capacitor/core';
import { PushNotifications, type ActionPerformed, type Token } from '@capacitor/push-notifications';
import { supabase, supabaseEnabled } from '../supabase';

const INSTALLATION_KEY = 'gocanteen_member_push_installation_id';
const GENERATION_KEY = 'gocanteen_member_push_binding_generation';
const PROFILE_KEY = 'gocanteen_member_push_profile_id';
const PENDING_TAP_KEY = 'gocanteen_pending_push_action';

let listenersReady = false;
let activeContext: { profileId: string; generation: number } | null = null;

export type MemberPushUser = { identityId?: string; role?: string } | null;

const isAndroid = () => Capacitor.getPlatform() === 'android';
const getInstallationId = () => {
  const existing = localStorage.getItem(INSTALLATION_KEY);
  if (existing) return existing;
  const value = globalThis.crypto?.randomUUID?.() || `gc-${Date.now()}-${Math.random().toString(36).slice(2, 14)}`;
  localStorage.setItem(INSTALLATION_KEY, value);
  return value;
};

const getBindingGeneration = (profileId: string) => {
  const previousProfile = localStorage.getItem(PROFILE_KEY);
  let generation = Number(localStorage.getItem(GENERATION_KEY) || '0');
  if (previousProfile !== profileId) {
    generation += 1;
    localStorage.setItem(PROFILE_KEY, profileId);
    localStorage.setItem(GENERATION_KEY, String(generation));
  }
  return Math.max(1, generation);
};

const currentGeneration = () => Math.max(1, Number(localStorage.getItem(GENERATION_KEY) || '1'));

const persistTap = (action: ActionPerformed) => {
  try {
    const payload = action.notification?.data || {};
    localStorage.setItem(PENDING_TAP_KEY, JSON.stringify(payload));
    window.dispatchEvent(new CustomEvent('gocanteen:push-tap', { detail: payload }));
  } catch {
    // Push delivery must never affect normal app operation.
  }
};

const registerToken = async (token: Token) => {
  const context = activeContext;
  if (!context || !supabaseEnabled || !supabase) return;
  try {
    await supabase.rpc('register_member_push_installation', {
      p_installation_id: getInstallationId(),
      p_fcm_token: token.value,
      p_platform: 'android',
      p_binding_generation: context.generation,
    });
  } catch {
    // FCM registration is best-effort and must never block authentication/business flows.
  }
};

const ensureListeners = async () => {
  if (listenersReady || !isAndroid()) return;
  listenersReady = true;
  await PushNotifications.addListener('registration', registerToken);
  await PushNotifications.addListener('registrationError', () => undefined);
  await PushNotifications.addListener('pushNotificationReceived', notification => {
    window.dispatchEvent(new CustomEvent('gocanteen:push-received', { detail: notification }));
  });
  await PushNotifications.addListener('pushNotificationActionPerformed', persistTap);
};

export const syncMemberPushForUser = async (user: MemberPushUser) => {
  if (!isAndroid() || !supabaseEnabled || !supabase) return;
  if (!user?.identityId || user.role !== 'employee') return;
  const generation = getBindingGeneration(user.identityId);
  activeContext = { profileId: user.identityId, generation };
  await ensureListeners();
  try {
    let permission = await PushNotifications.checkPermissions();
    if (permission.receive !== 'granted') permission = await PushNotifications.requestPermissions();
    if (permission.receive !== 'granted') return;
    await PushNotifications.register();
  } catch {
    // Push is optional; keep authentication and all existing app flows intact.
  }
};

export const deactivateCurrentMemberPush = async () => {
  const context = activeContext;
  if (!isAndroid()) return;
  activeContext = null;
  try {
    if (context && supabaseEnabled && supabase) {
      await supabase.rpc('deactivate_member_push_installation', {
        p_installation_id: getInstallationId(),
        p_binding_generation: context.generation,
      });
    }
  } catch {
    // Logout must continue even when push cleanup is unavailable.
  }
  try { await PushNotifications.removeAllDeliveredNotifications(); } catch { /* optional native cleanup */ }
  try { await PushNotifications.unregister(); } catch { /* optional native cleanup */ }
};

export const clearPendingPushAction = () => {
  localStorage.removeItem(PENDING_TAP_KEY);
};

export const consumePendingPushAction = (): Record<string, string> | null => {
  try {
    const raw = localStorage.getItem(PENDING_TAP_KEY);
    if (!raw) return null;
    localStorage.removeItem(PENDING_TAP_KEY);
    const value = JSON.parse(raw);
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
};

export const getMemberPushBindingGeneration = currentGeneration;
