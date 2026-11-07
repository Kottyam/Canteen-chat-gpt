// Orchestrates automatic monthly bill sending for ONE run of the scheduler.
// Dependency-injected so it can be tested with mocks. Sends nothing unless
// `liveSend` is true; otherwise every would-be send is recorded as 'dry_run'.
import { computePoolingBills, normalizeBillingSettings, previousBillingPeriod, isCompletedPeriod } from './poolingBilling.ts';
import { loadPoolingInput, poolingPayload } from './poolingInputs.ts';

export interface AutoSendDeps {
  db: any; // service-role supabase client (Edge Function) or mock
  now: Date;
  liveSend: boolean;
  log?: (msg: string) => void;
}
export interface AutoSendSummary { year: number; month: number; liveSend: boolean; canteens: number; sent: number; skipped: number; failed: number; dryRun: number; details: any[] }

const errMsg = (e: any) => String(e?.message || e || 'unknown error');

export async function runAutoSend(deps: AutoSendDeps, period?: { year: number; month: number }): Promise<AutoSendSummary> {
  const { db, now, liveSend } = deps;
  const { year, month } = period || previousBillingPeriod(now);
  if (!isCompletedPeriod(year, month, now)) throw new Error('Refusing to bill an incomplete (current or future) month');
  const summary: AutoSendSummary = { year, month, liveSend, canteens: 0, sent: 0, skipped: 0, failed: 0, dryRun: 0, details: [] };
  const { data: settingsRows, error } = await db.from('canteen_billing_settings').select('*').eq('bill_send_mode', 'automatic');
  if (error) throw error;
  for (const row of settingsRows || []) {
    const s = normalizeBillingSettings(row);
    if (s.billSendMode !== 'automatic') continue;
    const canteenId = row.canteen_id; summary.canteens++;
    const { data: sentRows, error: sentErr } = await db.from('bill_auto_send_attempts').select('employee_id').eq('canteen_id', canteenId).eq('bill_year', year).eq('bill_month', month).eq('status', 'sent');
    if (sentErr) throw sentErr;
    const alreadySent = new Set((sentRows || []).map((r: any) => r.employee_id));
    const record = async (employee: string | null, status: string, detail: string, billId: string | null = null) => {
      summary.details.push({ canteenId, employee, status, detail });
      if (status === 'sent') summary.sent++; else if (status === 'failed') summary.failed++; else if (status === 'dry_run') summary.dryRun++; else summary.skipped++;
      const { error: e } = await db.rpc('auto_bill_record_attempt', { p_canteen: canteenId, p_employee: employee, p_year: year, p_month: month, p_model: s.billingModel, p_status: status, p_detail: detail, p_bill: billId });
      if (e) deps.log?.(`audit write failed: ${errMsg(e)}`);
    };
    try {
      if (s.billingModel === 'pooling') {
        const input = await loadPoolingInput(db, { canteenId, year, month, messCutMinDays: s.messCutMinDays });
        const result = computePoolingBills(input);
        if (result.unallocatedPaise > 0) await record(null, 'skipped', `Unallocated expense ${result.unallocatedPaise} paise needs admin review`);
        const pending = result.lines.filter(l => !alreadySent.has(l.memberId));
        if (!liveSend) { for (const l of pending) await record(l.memberId, 'dry_run', `would send pooling bill ${l.totalPaise} paise`); continue; }
        // reuse an existing published snapshot; otherwise store a fresh one
        const { data: existing } = await db.from('pooling_bill_runs').select('id,status').eq('canteen_id', canteenId).eq('bill_year', year).eq('bill_month', month).maybeSingle();
        let runId = existing?.status === 'published' ? existing.id : null;
        if (!runId) {
          const { data: run, error: e } = await db.rpc('auto_bill_save_pooling_run', { p_canteen: canteenId, p_year: year, p_month: month, p_payload: poolingPayload(result) });
          if (e) throw e; runId = run.id;
        }
        for (const l of pending) {
          if (l.totalPaise <= 0) { await record(l.memberId, 'skipped', 'No payable amount'); continue; }
          const { data: bill, error: e } = await db.rpc('auto_bill_publish_pooling_line', { p_run: runId, p_employee: l.memberId });
          if (e) await record(l.memberId, 'failed', errMsg(e)); else await record(l.memberId, 'sent', 'published', bill?.id ?? null);
        }
      } else {
        const { data: members, error: e } = await db.from('profiles').select('id').eq('canteen_id', canteenId).eq('role', 'employee').eq('status', 'active');
        if (e) throw e;
        for (const m of members || []) {
          if (alreadySent.has(m.id)) continue;
          if (!liveSend) { await record(m.id, 'dry_run', 'would publish standard bill via publish_employee_bill'); continue; }
          const { data: bill, error: pe } = await db.rpc('auto_bill_publish_standard', { p_canteen: canteenId, p_employee: m.id, p_month: month, p_year: year });
          if (pe) await record(m.id, /No payable amount|No new amount/i.test(errMsg(pe)) ? 'skipped' : 'failed', errMsg(pe));
          else await record(m.id, 'sent', 'published', bill?.id ?? null);
        }
      }
    } catch (e) {
      await record(null, 'failed', errMsg(e));
    }
  }
  return summary;
}
