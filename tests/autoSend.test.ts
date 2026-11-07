import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAutoSend } from '../supabase/functions/_shared/autoSend.ts';

// Minimal in-memory fake of the supabase-js query builder + rpc.
function fakeDb(tables: Record<string, any[]>, rpcImpl: Record<string, (a: any) => any>) {
  const calls: any[] = [];
  const from = (t: string) => {
    let rows = [...(tables[t] || [])];
    const b: any = {
      select: () => b,
      eq: (c: string, v: any) => { rows = rows.filter(r => r[c] === v); return b; },
      gte: (c: string, v: any) => { rows = rows.filter(r => r[c] >= v); return b; },
      lte: (c: string, v: any) => { rows = rows.filter(r => r[c] <= v); return b; },
      maybeSingle: async () => ({ data: rows[0] || null, error: null }),
      then: (res: any, rej: any) => Promise.resolve({ data: rows, error: null }).then(res, rej),
    };
    return b;
  };
  const rpc = async (name: string, args: any) => {
    calls.push({ name, args });
    if (name === 'auto_bill_record_attempt') { tables.bill_auto_send_attempts.push({ canteen_id: args.p_canteen, employee_id: args.p_employee, bill_year: args.p_year, bill_month: args.p_month, status: args.p_status }); return { data: null, error: null }; }
    try { return { data: rpcImpl[name]?.(args) ?? null, error: null }; } catch (e) { return { data: null, error: e }; }
  };
  return { db: { from, rpc }, calls, tables };
}
const C = 'canteen-1';
const base = (model: string) => ({
  canteen_billing_settings: [{ canteen_id: C, billing_model: model, bill_send_mode: 'automatic', mess_cut_min_days: 6 }, { canteen_id: 'manual-c', bill_send_mode: 'manual' }],
  bill_auto_send_attempts: [] as any[],
  expenses: [{ id: 'e1', canteen_id: C, expense_date: '2026-09-01', amount: 100 }],
  orders: [{ id: 'o1', canteen_id: C, employee_id: 'A', ordered_for: '2026-09-01', status: 'active', order_items: [{ item_source: 'employee' }] },
           { id: 'o2', canteen_id: C, employee_id: 'B', ordered_for: '2026-09-01', status: 'active', order_items: [{ item_source: 'employee' }] }],
  profiles: [{ id: 'A', canteen_id: C, role: 'employee', status: 'active' }, { id: 'B', canteen_id: C, role: 'employee', status: 'active' }],
  holiday_dates: [], holiday_settings: [], employee_adjustments: [], pooling_bill_runs: [],
});
const now = new Date('2026-10-02T03:00:00Z');

test('dry run: records dry_run, never calls a publish RPC', async () => {
  const f = fakeDb(base('pooling'), {});
  const s = await runAutoSend({ db: f.db, now, liveSend: false });
  assert.equal(s.dryRun, 2); assert.equal(s.sent, 0);
  assert.ok(!f.calls.some(c => /publish|save/.test(c.name)));
  assert.equal(s.canteens, 1); // manual canteen ignored
});

test('live pooling send is idempotent: second run sends nothing', async () => {
  const t = base('pooling');
  const f = fakeDb(t, { auto_bill_save_pooling_run: () => ({ id: 'run1' }), auto_bill_publish_pooling_line: (a: any) => ({ id: 'bill-' + a.p_employee }) });
  const s1 = await runAutoSend({ db: f.db, now, liveSend: true });
  assert.equal(s1.sent, 2);
  const s2 = await runAutoSend({ db: fakeDb(t, { auto_bill_publish_pooling_line: () => { throw new Error('should not be called'); }, auto_bill_save_pooling_run: () => ({ id: 'run2' }) }).db, now, liveSend: true });
  assert.equal(s2.sent, 0); assert.equal(s2.failed, 0);
});

test('failures are audited and retried on next run', async () => {
  const t = base('standard');
  let fail = true;
  const impl = { auto_bill_publish_standard: (a: any) => { if (fail && a.p_employee === 'B') throw new Error('network'); return { id: 'b' + a.p_employee }; } };
  const s1 = await runAutoSend({ db: fakeDb(t, impl).db, now, liveSend: true });
  assert.equal(s1.sent, 1); assert.equal(s1.failed, 1);
  assert.ok(t.bill_auto_send_attempts.some(a => a.status === 'failed' && a.employee_id === 'B'));
  fail = false;
  const s2 = await runAutoSend({ db: fakeDb(t, impl).db, now, liveSend: true });
  assert.equal(s2.sent, 1); // only B retried
});

test('standard zero-amount is skipped, not failed', async () => {
  const s = await runAutoSend({ db: fakeDb(base('standard'), { auto_bill_publish_standard: () => { throw new Error('No payable amount available'); } }).db, now, liveSend: true });
  assert.equal(s.skipped, 2);
});

test('refuses incomplete month', async () => {
  await assert.rejects(runAutoSend({ db: fakeDb(base('pooling'), {}).db, now, liveSend: false }, { year: 2026, month: 10 }));
});
