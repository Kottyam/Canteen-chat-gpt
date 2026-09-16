import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.0'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const b64url = (value: string | Uint8Array) => {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}
const pemToBytes = (pem: string) => {
  const base64 = pem.replace(/-----BEGIN PRIVATE KEY-----/g, '').replace(/-----END PRIVATE KEY-----/g, '').replace(/\s/g, '')
  const binary = atob(base64)
  return Uint8Array.from(binary, c => c.charCodeAt(0))
}

let cachedAccessToken: { token: string; expiresAt: number } | null = null

async function getFirebaseAccessToken(serviceAccount: any) {
  const now = Math.floor(Date.now() / 1000)
  if (cachedAccessToken && cachedAccessToken.expiresAt - now > 120) return cachedAccessToken.token
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const payload = b64url(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }))
  const key = await crypto.subtle.importKey('pkcs8', pemToBytes(serviceAccount.private_key.replace(/\\n/g, '\n')), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  const signature = new Uint8Array(await crypto.subtle.sign({ name: 'RSASSA-PKCS1-v1_5' }, key, new TextEncoder().encode(`${header}.${payload}`)))
  const assertion = `${header}.${payload}.${b64url(signature)}`
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  })
  if (!tokenResponse.ok) throw new Error(`Firebase OAuth token request failed: ${await tokenResponse.text()}`)
  const tokenBody = await tokenResponse.json()
  cachedAccessToken = { token: tokenBody.access_token, expiresAt: now + Number(tokenBody.expires_in || 3600) }
  return tokenBody.access_token as string
}

const safeData = (payload: Record<string, unknown>, key: string) => {
  const value = payload?.[key]
  return value === undefined || value === null ? undefined : String(value)
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)
  const serviceAccountRaw = Deno.env.get('FIREBASE_SERVICE_ACCOUNT_JSON')
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!serviceAccountRaw || !supabaseUrl || !serviceRoleKey) return json({ error: 'Push delivery is not configured.' }, 503)

  let serviceAccount: any
  try { serviceAccount = JSON.parse(serviceAccountRaw) } catch { return json({ error: 'Invalid Firebase service account configuration.' }, 503) }

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } })
  const { data: rows, error: loadError } = await admin
    .from('member_push_delivery_outbox')
    .select('id,notification_id,installation_id,profile_id,attempts')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(50)
  if (loadError) return json({ error: loadError.message }, 500)

  let sent = 0, skipped = 0, invalid = 0, failed = 0
  let accessToken: string | null = null

  for (const row of rows || []) {
    const { data: claimed } = await admin
      .from('member_push_delivery_outbox')
      .update({ status: 'processing', attempts: Number(row.attempts || 0) + 1, updated_at: new Date().toISOString() })
      .eq('id', row.id)
      .eq('status', 'pending')
      .select('id,attempts')
      .maybeSingle()
    if (!claimed) continue

    const { data: notification } = await admin.from('notifications').select('id,recipient_id,canteen_id,notification_type,title,message,payload').eq('id', row.notification_id).maybeSingle()
    const { data: installation } = await admin.from('member_push_installations').select('id,profile_id,canteen_id,fcm_token,is_active,platform').eq('id', row.installation_id).maybeSingle()
    const { data: profile } = await admin.from('profiles').select('id,role,status,canteen_id').eq('id', row.profile_id).maybeSingle()

    const validTarget = Boolean(notification && installation && profile && notification.recipient_id === row.profile_id && notification.canteen_id === row.canteen_id && installation.profile_id === row.profile_id && installation.canteen_id === row.canteen_id && installation.is_active && installation.platform === 'android' && profile.role === 'employee' && profile.status === 'active' && profile.canteen_id === row.canteen_id)
    if (!validTarget) {
      await admin.from('member_push_delivery_outbox').update({ status: 'skipped', updated_at: new Date().toISOString(), last_error: 'Target no longer eligible.' }).eq('id', row.id)
      skipped++
      continue
    }

    try {
      accessToken = accessToken || await getFirebaseAccessToken(serviceAccount)
      const payload = (notification.payload || {}) as Record<string, unknown>
      const data: Record<string, string> = { notification_id: notification.id, notification_type: notification.notification_type }
      for (const key of ['event_key', 'bill_id', 'payment_id', 'holiday_id', 'holiday_date', 'business_date', 'order_for', 'order_window_state']) {
        const value = safeData(payload, key)
        if (value) data[key] = value
      }
      const response = await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(serviceAccount.project_id)}/messages:send`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: {
            token: installation.fcm_token,
            notification: { title: notification.title, body: notification.message },
            data,
            android: {
              priority: 'HIGH',
              restricted_package_name: 'com.gocanteen.app',
              notification: { channel_id: 'gocanteen-member', visibility: 'PRIVATE', default_sound: true },
            },
          },
        }),
      })
      if (response.ok) {
        await admin.from('member_push_delivery_outbox').update({ status: 'sent', sent_at: new Date().toISOString(), updated_at: new Date().toISOString(), last_error: null }).eq('id', row.id)
        sent++
        continue
      }
      const errorText = await response.text()
      const invalidToken = /UNREGISTERED/i.test(errorText) || (/INVALID_ARGUMENT/i.test(errorText) && /registration token|token/i.test(errorText))
      if (invalidToken) {
        await admin.from('member_push_installations').update({ is_active: false, updated_at: new Date().toISOString(), last_seen_at: new Date().toISOString() }).eq('id', installation.id)
        await admin.from('member_push_delivery_outbox').update({ status: 'invalid_token', updated_at: new Date().toISOString(), last_error: errorText.slice(0, 1000) }).eq('id', row.id)
        invalid++
      } else {
        const attempts = Number(claimed.attempts || 1)
        await admin.from('member_push_delivery_outbox').update({ status: attempts >= 5 ? 'failed' : 'pending', updated_at: new Date().toISOString(), last_error: errorText.slice(0, 1000) }).eq('id', row.id)
        failed++
      }
    } catch (error) {
      const attempts = Number(claimed.attempts || 1)
      await admin.from('member_push_delivery_outbox').update({ status: attempts >= 5 ? 'failed' : 'pending', updated_at: new Date().toISOString(), last_error: String(error).slice(0, 1000) }).eq('id', row.id)
      failed++
    }
  }

  return json({ ok: true, processed: (rows || []).length, sent, skipped, invalid, failed })
})
