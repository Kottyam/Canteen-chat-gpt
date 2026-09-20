import { Capacitor } from '@capacitor/core';
import { PushNotifications, type ActionPerformed, type Token } from '@capacitor/push-notifications';
import { supabase, supabaseEnabled } from '../supabase';

const INSTALLATION_KEY = 'gocanteen_member_push_installation_id';
const GENERATION_KEY = 'gocanteen_member_push_binding_generation';
const PROFILE_KEY = 'gocanteen_member_push_profile_id';
const PENDING_TAP_KEY = 'gocanteen_pending_push_action';

let listenersReady = false;
let activeMemberContext: { profileId: string; generation: number } | null = null;
let activeAdminContext: { profileId: string; generation: number } | null = null;
let registrationEventObserved = false;

export type MemberPushUser = { identityId?: string; role?: string; canteenId?: string } | null;

const pushDiag = (category: string, details: Record<string, unknown> = {}) => {
  console.info('[GoCanteen PushDiag]', category, details);
};

const pushDiagError = (category: string, error: unknown, details: Record<string, unknown> = {}) => {
  const message = error instanceof Error ? error.message : String(error || 'Unknown error');
  console.warn('[GoCanteen PushDiag]', category, { ...details, errorMessage: message });
};

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
  registrationEventObserved = true;
  const installationId = getInstallationId();
  const context = activeMemberContext || activeAdminContext;
  pushDiag('7 registration event fired', { role: activeMemberContext ? 'employee' : activeAdminContext ? 'admin' : 'none', profileId: context?.profileId || null, installationId, bindingGeneration: context?.generation || null, platform: 'android', tokenLength: token?.value?.length || 0 });
  pushDiag('8 FCM token metadata received', { tokenLength: token?.value?.length || 0, tokenLogged: false });
  if (!supabaseEnabled || !supabase) { pushDiagError('D RPC unavailable', 'Supabase client is unavailable', { installationId }); return; }

  try {
    pushDiag('9 registerToken()', { role: activeMemberContext ? 'employee' : activeAdminContext ? 'admin' : 'none', profileId: context?.profileId || null, installationId, bindingGeneration: context?.generation || null, platform: 'android' });
    if (activeAdminContext) {
      await supabase.rpc('register_admin_push_installation', {
        p_installation_id: getInstallationId(),
        p_fcm_token: token.value,
        p_platform: 'android',
        p_binding_generation: activeAdminContext.generation,
      });
      return;
    }

    if (activeMemberContext) {
      pushDiag('10 register_member_push_installation() RPC call', { installationId, profileId: activeMemberContext.profileId, bindingGeneration: activeMemberContext.generation });
      const { error } = await supabase.rpc('register_member_push_installation', {
        p_installation_id: getInstallationId(),
        p_fcm_token: token.value,
        p_platform: 'android',
        p_binding_generation: activeMemberContext.generation,
      });
      if (error) throw error;
      pushDiag('11 RPC success', { role: 'employee', profileId: activeMemberContext.profileId, installationId, bindingGeneration: activeMemberContext.generation });
    }
  } catch (error) {
    pushDiagError('D RPC failed', error, { role: activeMemberContext ? 'employee' : 'admin', profileId: context?.profileId || null, installationId, bindingGeneration: context?.generation || null });
  }
};

const ensureMemberNotificationChannel = async () => {
  if (!isAndroid()) return;

  try {
    await PushNotifications.createChannel({
      id: 'gocanteen-member',
      name: 'GoCanteen Member Notifications',
      description: 'Notifications for your GoCanteen member account.',
      importance: 3,
      visibility: 0,
    });
  } catch (error) {
    pushDiagError('N member notification channel creation failed', error);
  }
};

const ensureListeners = async () => {
  if (listenersReady || !isAndroid()) return;
  listenersReady = true;
  pushDiag('listeners initialized', { platform: 'android' });
  await PushNotifications.addListener('registration', registerToken);
  await PushNotifications.addListener('registrationError', error => pushDiagError('I native registration error', error));
  await PushNotifications.addListener('pushNotificationReceived', notification => {
    window.dispatchEvent(new CustomEvent('gocanteen:push-received', { detail: notification }));
  });
  await PushNotifications.addListener('pushNotificationActionPerformed', persistTap);
};

const deactivateMemberForSwitch = async () => {
  const context = activeMemberContext;
  if (!context || !supabaseEnabled || !supabase) return;
  try {
    await supabase.rpc('deactivate_member_push_installation', {
      p_installation_id: getInstallationId(),
      p_binding_generation: context.generation,
    });
  } catch {
    // Best-effort cleanup during account switching.
  }
  activeMemberContext = null;
};

const deactivateAdminForSwitch = async () => {
  const context = activeAdminContext;
  if (!context || !supabaseEnabled || !supabase) return;
  try {
    await supabase.rpc('deactivate_admin_push_installation', {
      p_installation_id: getInstallationId(),
      p_binding_generation: context.generation,
    });
  } catch {
    // Best-effort cleanup during account switching.
  }
  activeAdminContext = null;
};

export const syncMemberPushForUser = async (user: MemberPushUser) => {
  pushDiag('1 syncMemberPushForUser()', { profileId: user?.identityId || null, canteenId: user?.canteenId || null, role: user?.role || null });
  if (!isAndroid()) { pushDiag('2 Android/platform check failed', { platform: Capacitor.getPlatform() }); return; }
  pushDiag('2 Android/platform check passed', { platform: 'android' });
  if (!supabaseEnabled || !supabase) { pushDiagError('E authentication/session failure', 'Supabase client unavailable'); return; }
  if (!user?.identityId || user.role !== 'employee') { pushDiag('E authentication/session failure', { reason: 'missing identityId or non-employee role', role: user?.role || null }); return; }

  if (activeAdminContext) await deactivateAdminForSwitch();
  const generation = getBindingGeneration(user.identityId);
  activeMemberContext = { profileId: user.identityId, generation };
  pushDiag('member context active', { profileId: user.identityId, canteenId: user.canteenId || null, role: user.role, installationId: getInstallationId(), bindingGeneration: generation });
  await ensureListeners();
  await ensureMemberNotificationChannel();

  try {
    let permission = await PushNotifications.checkPermissions();
    pushDiag('3 checkPermissions()', { receive: permission.receive });
    if (permission.receive !== 'granted') {
      pushDiag('4 requestPermissions()', { previousReceive: permission.receive });
      permission = await PushNotifications.requestPermissions();
      pushDiag('5 permission.receive result', { receive: permission.receive });
    } else {
      pushDiag('5 permission.receive result', { receive: permission.receive, requested: false });
    }
    if (permission.receive !== 'granted') { pushDiag('A permission denied', { receive: permission.receive }); return; }
    registrationEventObserved = false;
    pushDiag('6 PushNotifications.register() start', { installationId: getInstallationId(), bindingGeneration: generation });
    await PushNotifications.register();
    pushDiag('6 PushNotifications.register() resolved', { installationId: getInstallationId(), bindingGeneration: generation });
    window.setTimeout(() => { if (!registrationEventObserved) pushDiagError('C registration event never observed', 'No registration event observed within 10 seconds', { profileId: user.identityId, canteenId: user.canteenId || null, installationId: getInstallationId(), bindingGeneration: generation }); }, 10000);
  } catch (error) {
    pushDiagError('B FCM registration failed', error, { profileId: user.identityId, canteenId: user.canteenId || null, installationId: getInstallationId(), bindingGeneration: generation });
  }
};

export const syncAdminPushForUser = async (user: MemberPushUser) => {
  if (!isAndroid() || !supabaseEnabled || !supabase) return;
  if (!user?.identityId || user.role !== 'admin') return;

  if (activeMemberContext) await deactivateMemberForSwitch();
  const generation = getBindingGeneration(user.identityId);
  activeAdminContext = { profileId: user.identityId, generation };
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
  const context = activeMemberContext;
  pushDiag('17 deactivateCurrentMemberPush()', { profileId: context?.profileId || null, installationId: getInstallationId(), bindingGeneration: context?.generation || null });
  if (!isAndroid()) return;
  activeMemberContext = null;

  try {
    if (context && supabaseEnabled && supabase) {
      pushDiag('18 deactivate_member_push_installation() RPC call', { profileId: context.profileId, installationId: getInstallationId(), bindingGeneration: context.generation });
      const { error } = await supabase.rpc('deactivate_member_push_installation', {
        p_installation_id: getInstallationId(),
        p_binding_generation: context.generation,
      });
      if (error) throw error;
      pushDiag('18 deactivate RPC success', { profileId: context.profileId, installationId: getInstallationId(), bindingGeneration: context.generation });
    }
  } catch (error) {
    pushDiagError('18 deactivate RPC failed', error, { profileId: context?.profileId || null, installationId: getInstallationId(), bindingGeneration: context?.generation || null });
  }

  try { await PushNotifications.removeAllDeliveredNotifications(); } catch { /* optional native cleanup */ }
  try { pushDiag('19 PushNotifications.unregister() start', { installationId: getInstallationId() }); await PushNotifications.unregister(); pushDiag('19 PushNotifications.unregister() resolved', { installationId: getInstallationId() }); } catch (error) { pushDiagError('19 native unregister failed', error, { installationId: getInstallationId() }); }
};

export const deactivateCurrentAdminPush = async () => {
  const context = activeAdminContext;
  if (!isAndroid()) return;
  activeAdminContext = null;

  try {
    if (context && supabaseEnabled && supabase) {
      await supabase.rpc('deactivate_admin_push_installation', {
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

export const getMemberPushBindingGeneration = () => Math.max(1, Number(localStorage.getItem(GENERATION_KEY) || '1'));
