import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

const LOGIN_EMAIL_DOMAIN = 'canteen.gocanteen.online'
const ADMIN_PERMISSIONS = [
  'dashboard', 'members', 'orders', 'guest_orders', 'menu', 'daily_reports',
  'monthly_reports', 'revenue', 'expenses', 'bills', 'payments', 'time_management', 'holidays',
] as const

const normalizeLoginId = (value: string) => String(value || '').trim().toUpperCase()
const isValidLoginId = (id: string) => /^[A-Z0-9]{3,16}$/.test(id) && /[A-Z]/.test(id)
const loginEmail = (id: string) => `${id.toLowerCase()}@${LOGIN_EMAIL_DOMAIN}`
const validPassword = (v: string) => typeof v === 'string' && v.length >= 8 && v.length <= 128
const employeeCodeFor = (authId: string) => `CANTEENLOGIN-${authId.replaceAll('-', '')}`

const safeAuthError = (error: any, fallback: string) => {
  const message = String(error?.message || '').trim()
  if (!message) return fallback
  if (/duplicate|already.*use|already.*registered|email.*exists/i.test(message)) {
    return 'This Canteen ID is already in use.'
  }
  if (/password/i.test(message)) return 'Could not update the Canteen ID password. Please try again.'
  return fallback
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('SUPABASE_PUBLISHABLE_KEY') || ''
  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })

  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim()
  if (!token) return json({ error: 'Authentication required.' }, 401)
  const { data: { user: caller }, error: callerError } = await admin.auth.getUser(token)
  if (callerError || !caller) return json({ error: 'Authentication required.' }, 401)

  const { data: callerProfile, error: callerProfileError } = await admin.from('profiles')
    .select('id,role,admin_role,status,canteen_id')
    .eq('id', caller.id)
    .maybeSingle()
  if (callerProfileError) return json({ error: callerProfileError.message }, 500)
  if (!callerProfile || callerProfile.role !== 'admin' || callerProfile.status !== 'active') {
    return json({ error: 'You are not authorized to manage Canteen ID login.' }, 403)
  }

  const isSuperAdmin = callerProfile.admin_role === 'super_admin'
  let body: any
  try { body = await req.json() } catch { return json({ error: 'Invalid request.' }, 400) }
  const action = String(body?.action || '')

  const requireSuperAdmin = () => {
    if (!isSuperAdmin) return json({ error: 'Super Admin authorization required.' }, 403)
    return null
  }

  const loadCanteen = async (canteenId: string) => {
    const { data, error } = await admin.from('canteens')
      .select('id,name,login_id,login_user_id,archived')
      .eq('id', canteenId)
      .maybeSingle()
    if (error) throw error
    if (!data) return { error: json({ error: 'Canteen not found.' }, 404) }
    return { canteen: data as any }
  }

  if (action === 'set_login_id') {
    const denied = requireSuperAdmin(); if (denied) return denied
    const canteenId = String(body?.canteen_id || '').trim()
    const loginId = normalizeLoginId(body?.login_id)
    const password = String(body?.password || '')
    if (!canteenId) return json({ error: 'Canteen is required.' }, 400)
    if (!isValidLoginId(loginId)) {
      return json({ error: 'Canteen ID must be 3–16 letters or numbers, include a letter, and is not case-sensitive.' }, 400)
    }
    try {
      const loaded = await loadCanteen(canteenId)
      if (loaded.error) return loaded.error
      const canteen = loaded.canteen

      const { data: taken, error: takenError } = await admin.from('canteens')
        .select('id')
        .ilike('login_id', loginId)
        .neq('id', canteenId)
        .maybeSingle()
      if (takenError) return json({ error: takenError.message }, 500)
      if (taken) return json({ error: 'This Canteen ID is already in use.' }, 409)

      if (!canteen.login_user_id) {
        if (!validPassword(password)) return json({ error: 'Initial password must be at least 8 characters.' }, 400)
        const email = loginEmail(loginId)
        const { data: created, error: createError } = await admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          app_metadata: { role: 'admin', canteen_login: true },
          user_metadata: { login_id: loginId, canteen_id: canteenId, full_name: 'Canteen admin', account_type: 'canteen_login' },
        })
        if (createError || !created.user) {
          return json({ error: safeAuthError(createError, 'Could not create the Canteen ID login.') }, 400)
        }
        const authId = created.user.id
        const { error: profileError } = await admin.from('profiles').insert({
          id: authId,
          employee_code: employeeCodeFor(authId),
          sr_number: null,
          full_name: 'Canteen admin',
          mobile_number: null,
          role: 'admin',
          admin_role: 'staff_admin',
          status: 'active',
          is_first_login: false,
          canteen_id: canteenId,
          onboarding_completed: true,
        })
        if (profileError) {
          await admin.auth.admin.deleteUser(authId)
          return json({ error: profileError.message }, 500)
        }
        const { error: permError } = await admin.from('admin_permissions').insert(
          ADMIN_PERMISSIONS.map((permission) => ({
            admin_id: authId,
            canteen_id: canteenId,
            permission,
            enabled: true,
            created_by: caller.id,
          })),
        )
        if (permError) {
          await admin.from('admin_permissions').delete().eq('admin_id', authId).eq('canteen_id', canteenId)
          await admin.from('profiles').delete().eq('id', authId)
          await admin.auth.admin.deleteUser(authId)
          return json({ error: permError.message }, 500)
        }
        const { error: updateError } = await admin.from('canteens')
          .update({ login_id: loginId, login_user_id: authId, updated_at: new Date().toISOString() })
          .eq('id', canteenId)
        if (updateError) {
          await admin.from('admin_permissions').delete().eq('admin_id', authId).eq('canteen_id', canteenId)
          await admin.from('profiles').delete().eq('id', authId)
          await admin.auth.admin.deleteUser(authId)
          return json({ error: updateError.message }, 500)
        }
        return json({ ok: true, login_id: loginId, created: true })
      }

      if (canteen.login_id !== loginId) {
        const { error: emailError } = await admin.auth.admin.updateUserById(canteen.login_user_id, {
          email: loginEmail(loginId),
          email_confirm: true,
          app_metadata: { role: 'admin', canteen_login: true },
          user_metadata: { login_id: loginId, canteen_id: canteenId, full_name: 'Canteen admin', account_type: 'canteen_login' },
        })
        if (emailError) return json({ error: safeAuthError(emailError, 'Could not update the Canteen ID.') }, 400)
        const { error: updateError } = await admin.from('canteens')
          .update({ login_id: loginId, updated_at: new Date().toISOString() })
          .eq('id', canteenId)
        if (updateError) {
          if (canteen.login_id) {
            await admin.auth.admin.updateUserById(canteen.login_user_id, {
              email: loginEmail(canteen.login_id),
              email_confirm: true,
            })
          }
          return json({ error: updateError.message }, 500)
        }
      }
      return json({ ok: true, login_id: loginId, created: false })
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : 'Could not save the Canteen ID.' }, 500)
    }
  }

  if (action === 'reset_password') {
    const denied = requireSuperAdmin(); if (denied) return denied
    const canteenId = String(body?.canteen_id || '').trim()
    const password = String(body?.password || '')
    if (!canteenId) return json({ error: 'Canteen is required.' }, 400)
    if (!validPassword(password)) return json({ error: 'Password must be at least 8 characters.' }, 400)
    try {
      const loaded = await loadCanteen(canteenId)
      if (loaded.error) return loaded.error
      if (!loaded.canteen.login_user_id) return json({ error: 'Set a Canteen ID before resetting the password.' }, 400)
      const { error } = await admin.auth.admin.updateUserById(loaded.canteen.login_user_id, { password })
      if (error) return json({ error: safeAuthError(error, 'Could not reset the Canteen ID password.') }, 400)
      return json({ ok: true })
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : 'Could not reset the password.' }, 500)
    }
  }

  if (action === 'change_password') {
    const { data: owned } = await admin.from('canteens')
      .select('id,login_id,login_user_id')
      .eq('login_user_id', caller.id)
      .maybeSingle()
    const isCanteenLogin = Boolean(
      owned?.login_user_id === caller.id
      || caller.app_metadata?.canteen_login === true
      || String(caller.email || '').toLowerCase().endsWith(`@${LOGIN_EMAIL_DOMAIN}`),
    )
    if (!isCanteenLogin || !owned) {
      return json({ error: 'Only the Canteen ID login can change this password.' }, 403)
    }
    const currentPassword = String(body?.current_password || '')
    const newPassword = String(body?.new_password || '')
    if (!currentPassword) return json({ error: 'Enter the current password.' }, 400)
    if (!validPassword(newPassword)) return json({ error: 'New password must be at least 8 characters.' }, 400)
    if (currentPassword === newPassword) return json({ error: 'New password must be different from the current password.' }, 400)
    if (!anonKey) return json({ error: 'Could not verify the current password.' }, 500)
    const verifier = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } })
    const { data: verified, error: verifyError } = await verifier.auth.signInWithPassword({
      email: String(caller.email || loginEmail(owned.login_id || '')),
      password: currentPassword,
    })
    if (verifyError || verified.user?.id !== caller.id) {
      try { await verifier.auth.signOut() } catch { /* ignore */ }
      return json({ error: 'Incorrect current password.' }, 400)
    }
    try { await verifier.auth.signOut() } catch { /* ignore */ }
    const { error: updateError } = await admin.auth.admin.updateUserById(caller.id, { password: newPassword })
    if (updateError) return json({ error: safeAuthError(updateError, 'Could not update the password.') }, 400)
    return json({ ok: true })
  }

  return json({ error: 'Unsupported action.' }, 400)
})
