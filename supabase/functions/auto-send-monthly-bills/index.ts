// @ts-nocheck -- Deno entry point; type-checked by the Supabase/Deno toolchain, not the Vite tsconfig. Logic lives in ../_shared (covered by tests/).
// Scheduled entry point for Automatic monthly bill sending (opt-in per canteen).
// NOT deployed / NOT scheduled by this PR. Safety gates:
//  * requires header `x-cron-secret`: checked against env AUTO_BILL_CRON_SECRET if set, else against the
//    Vault secret 'auto_bill_cron_secret' via service-only RPC auto_bill_authorize (connector-manageable)
//  * deploy with verify_jwt = false (custom header auth; publishable/secret keys are not JWTs)
//  * sends ONLY when the private DB live switch is on (env cannot enable it); default dry run
//  * a request body {"dryRun":true} forces dry run even when live
//  * only completed months (previous IST month) are billed; idempotent per member
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { runAutoSend } from "../_shared/autoSend.ts";
import { authorizeCron } from "../_shared/cronAuth.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  let body: any = {}; try { body = await req.json(); } catch { body = {}; }
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const auth = await authorizeCron({
    header: req.headers.get("x-cron-secret"), envSecret: Deno.env.get("AUTO_BILL_CRON_SECRET"), envLive: Deno.env.get("AUTO_BILL_SEND_LIVE"),
    dryRunRequested: body?.dryRun === true,
    dbAuthorize: async (secret) => { const { data, error } = await db.rpc("auto_bill_authorize", { p_secret: secret }); if (error) throw error; return data; },
  });
  if (!auth.ok) return new Response("Unauthorized", { status: 401 });
  const liveSend = auth.liveSend;
  try {
    const summary = await runAutoSend({ db, now: new Date(), liveSend, log: console.warn });
    return new Response(JSON.stringify(summary), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as any)?.message || e) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
