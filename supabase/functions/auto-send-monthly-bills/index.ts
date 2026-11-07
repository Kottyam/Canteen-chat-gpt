// @ts-nocheck -- Deno entry point; type-checked by the Supabase/Deno toolchain, not the Vite tsconfig. Logic lives in ../_shared (covered by tests/).
// Scheduled entry point for Automatic monthly bill sending (opt-in per canteen).
// NOT deployed / NOT scheduled by this PR. Safety gates:
//  * requires header `x-cron-secret` == env AUTO_BILL_CRON_SECRET
//  * sends ONLY when env AUTO_BILL_SEND_LIVE === 'true'; otherwise dry run
//  * a request body {"dryRun":true} forces dry run even when live
//  * only completed months (previous IST month) are billed; idempotent per member
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { runAutoSend } from "../_shared/autoSend.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const secret = Deno.env.get("AUTO_BILL_CRON_SECRET");
  if (!secret || req.headers.get("x-cron-secret") !== secret) return new Response("Unauthorized", { status: 401 });
  let body: any = {}; try { body = await req.json(); } catch { body = {}; }
  const liveSend = Deno.env.get("AUTO_BILL_SEND_LIVE") === "true" && body?.dryRun !== true;
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  try {
    const summary = await runAutoSend({ db, now: new Date(), liveSend, log: console.warn });
    return new Response(JSON.stringify(summary), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as any)?.message || e) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
