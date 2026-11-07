// Authorization + live-gate for the scheduled auto-send function. Pure + injectable for tests.
// Order: an env secret (AUTO_BILL_CRON_SECRET), if set, is authoritative; otherwise the DB/Vault check
// (public.auto_bill_authorize, service_role only). Live sending requires env AUTO_BILL_SEND_LIVE==='true'
// OR the DB runtime switch, and is always overridden by body.dryRun === true. Any error => unauthorized.
export interface CronAuthInput {
  header: string | null; envSecret?: string | null; envLive?: string | null; dryRunRequested?: boolean;
  dbAuthorize: (secret: string) => Promise<{ ok: boolean; live: boolean }>;
}
const safeEq = (a: string, b: string) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };
export async function authorizeCron(i: CronAuthInput): Promise<{ ok: boolean; liveSend: boolean }> {
  if (!i.header) return { ok: false, liveSend: false };
  let ok = false, dbLive = false;
  if (i.envSecret) ok = i.envSecret.length >= 32 && safeEq(i.header, i.envSecret);
  else { try { const r = await i.dbAuthorize(i.header); ok = !!r?.ok; dbLive = ok && !!r?.live; } catch { ok = false; } }
  if (!ok) return { ok: false, liveSend: false };
  return { ok: true, liveSend: (i.envLive === 'true' || dbLive) && i.dryRunRequested !== true };
}
