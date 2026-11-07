// Real-Postgres integration tests (skipped unless PGTEST_ADMIN_URL is set).
// Run: bash supabase/tests/run-db-tests.sh  (creates a throwaway local DB; synthetic data only)
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { makeClient, sql } from '../supabase/tests/pgAdapter.ts';
import { computePoolingBills } from '../supabase/functions/_shared/poolingBilling.ts';
import { loadPoolingInput, poolingPayload } from '../supabase/functions/_shared/poolingInputs.ts';
import { runAutoSend } from '../supabase/functions/_shared/autoSend.ts';

const URL = process.env.PGTEST_URL;
const skip = !URL;
const C1 = 'c1000000-0000-0000-0000-000000000000', C2 = 'c2000000-0000-0000-0000-000000000000', C3 = 'c3000000-0000-0000-0000-000000000000';
const O1 = '11111111-0000-0000-0000-000000000001', S1 = '11111111-0000-0000-0000-0000000000f1';
const A = '11111111-0000-0000-0000-0000000000a1', B = '11111111-0000-0000-0000-0000000000a2', CH = '11111111-0000-0000-0000-0000000000a3';
const O2 = '22222222-0000-0000-0000-000000000001', N1 = '22222222-0000-0000-0000-0000000000b1';
const O3 = '33333333-0000-0000-0000-000000000001', D1 = '33333333-0000-0000-0000-0000000000d1';
const su = (q: string) => { const r = sql(URL!, { role: 'service_role' }, q); return r; };
const pg = (q: string) => { const r = sql(URL!.replace(/$/, ''), { role: 'service_role' }, q); if (r.error) throw new Error(r.error.message); return r.rows; };
const as = (sub: string) => makeClient(URL!, { role: 'authenticated', sub });
const svc = () => makeClient(URL!, { role: 'service_role' });

test('db integration', { skip }, async (t) => {
  await t.test('settings absent => standard default; pooling RPCs refuse', async () => {
    const { data } = await as(O1).from('canteen_billing_settings').select('*').maybeSingle();
    assert.equal(data, null);
    const r = await as(O1).rpc('save_pooling_bill_run', { p_month: 9, p_year: 2026, p_payload: { expenseTotalPaise: 0, unallocatedPaise: 0, lines: [] } });
    assert.match(r.error.message, /not enabled/);
  });

  await t.test('settings writes: only via RPC with payments permission, tenant-scoped', async () => {
    const direct = await as(O1).rpc('set_canteen_billing_settings', { p_billing_model: 'pooling', p_mess_cut_min_days: 6, p_bill_send_mode: 'manual' });
    assert.equal(direct.error, null); assert.equal(direct.data.canteen_id, C1);
    assert.match(sql(URL!, { role: 'authenticated', sub: O1 }, `insert into public.canteen_billing_settings(canteen_id) values ('${C2}')`).error.message, /permission denied/);
    assert.match((await as(S1).rpc('set_canteen_billing_settings', { p_billing_model: 'standard', p_mess_cut_min_days: 6, p_bill_send_mode: 'manual' })).error.message, /permission required/);
    assert.match((await as(A).rpc('set_canteen_billing_settings', { p_billing_model: 'standard', p_mess_cut_min_days: 6, p_bill_send_mode: 'manual' })).error.message, /permission required/);
    assert.match((await as(O1).rpc('set_canteen_billing_settings', { p_billing_model: 'weird', p_mess_cut_min_days: 6, p_bill_send_mode: 'manual' })).error.message, /check constraint/);
    const mem = await as(A).from('canteen_billing_settings').select('billing_model').maybeSingle();
    assert.equal(mem.data.billing_model, 'pooling');
    const other = await as(N1).from('canteen_billing_settings').select('*');
    assert.deepEqual(other.data, []); // other tenant sees nothing
  });

  let result: any; let runId = '';
  await t.test('loader reads ONLY C1 Sept expenses / orders under owner RLS; engine numbers', async () => {
    const input = await loadPoolingInput(as(O1), { canteenId: C1, year: 2026, month: 9, messCutMinDays: 6 });
    assert.equal(input.expenses.reduce((s, e) => s + e.amountPaise, 0), 41025); // 100 + 260 + 50.25; excludes Aug 31 and C2's 999
    assert.equal(input.members.length, 3); // admins + other tenant excluded
    result = computePoolingBills(input);
    const l = (id: string) => result.lines.find((x: any) => x.memberId === id);
    assert.equal(result.operatingDays.length, 29); // Sept minus declared holiday 13th
    assert.equal(l(A).absentDays, 1); assert.equal(l(A).messCutApplied, false); // guest-only 10th
    assert.equal(l(B).absentDays, 6); assert.equal(l(B).messCutApplied, true); // 5 skipped + 1 cancelled (4th)
    assert.equal(l(CH).windowDays, 9); // joined 22nd IST (created 21st 20:00 UTC)
    assert.equal(l(A).adminAddedPaise, 2000);
    assert.equal(result.lines.reduce((s: number, x: any) => s + x.sharePaise, 0) + result.unallocatedPaise, 41025);
  });

  await t.test('save snapshot: permission, tamper, cross-tenant, completed-month checks', async () => {
    const payload = poolingPayload(result);
    assert.match((await as(S1).rpc('save_pooling_bill_run', { p_month: 9, p_year: 2026, p_payload: payload })).error.message, /permission required/);
    assert.match((await as(O1).rpc('save_pooling_bill_run', { p_month: 9, p_year: 2026, p_payload: { ...payload, expenseTotalPaise: 1 } })).error.message, /Expense total changed/);
    const shifted = { ...payload, lines: payload.lines.map((x: any, i: number) => i === 0 ? { ...x, sharePaise: x.sharePaise + 1 } : x) };
    assert.match((await as(O1).rpc('save_pooling_bill_run', { p_month: 9, p_year: 2026, p_payload: shifted })).error.message, /does not add up/);
    const foreign = { ...payload, lines: [...payload.lines.slice(1), { ...payload.lines[0], memberId: N1 }] };
    assert.match((await as(O1).rpc('save_pooling_bill_run', { p_month: 9, p_year: 2026, p_payload: foreign })).error.message, /outside this canteen/);
    assert.match((await as(O1).rpc('save_pooling_bill_run', { p_month: 11, p_year: 2026, p_payload: payload })).error.message, /completed months/);
    const ok = await as(O1).rpc('save_pooling_bill_run', { p_month: 9, p_year: 2026, p_payload: payload });
    assert.equal(ok.error, null); runId = ok.data.id;
    const again = await as(O1).rpc('save_pooling_bill_run', { p_month: 9, p_year: 2026, p_payload: payload }); // draft replace
    assert.equal(again.error, null); runId = again.data.id;
    assert.equal(pg(`select json_agg(1) from public.pooling_bill_runs where canteen_id='${C1}'`).length, 1);
  });

  await t.test('publish writes existing monthly_bills + bill_payments + member notification; idempotent; tenant-safe', async () => {
    assert.match((await as(O2).rpc('publish_pooling_bill', { p_run_id: runId, p_employee_id: A })).error.message, /not found in your canteen/);
    // concurrent double publish of the same member (two real sessions)
    const call = () => new Promise<string>(res => { const p = spawn('psql', [URL!, '-X', '-tA', '-c', `begin; set local role authenticated; select set_config('request.jwt.claims','{"role":"authenticated","sub":"${O1}"}',true); select (public.publish_pooling_bill('${runId}','${A}')).id; select pg_sleep(0.3); commit;`]); let o = ''; p.stdout.on('data', d => o += d); p.stderr.on('data', d => o += d); p.on('close', () => res(o)); });
    const [r1, r2] = await Promise.all([call(), call()]);
    const ids = [r1, r2].map(o => (o.match(/[0-9a-f-]{36}/) || [''])[0]);
    assert.ok(ids[0] && ids[0] === ids[1], `both callers should get the same bill: ${r1} | ${r2}`);
    for (const id of [B, CH]) assert.equal((await as(O1).rpc('publish_pooling_bill', { p_run_id: runId, p_employee_id: id })).error, null);
    const bills = pg(`select json_agg(json_build_object('e',employee_id,'total',total,'food',food_total,'adm',admin_added_total,'days',days_ordered,'canteen',canteen_id)) from public.monthly_bills where bill_month=9 and bill_year=2026 and canteen_id='${C1}'`);
    assert.equal(bills.length, 3);
    for (const b of bills) { const l = result.lines.find((x: any) => x.memberId === b.e); assert.equal(Math.round(Number(b.total) * 100), l.totalPaise); assert.equal(Math.round(Number(b.adm) * 100), l.adminAddedPaise); assert.equal(b.days, l.chargeableDays); }
    const pays = pg(`select json_agg(json_build_object('amt',amount,'st',status)) from public.bill_payments p join public.monthly_bills b on b.id=p.bill_id where b.canteen_id='${C1}'`);
    assert.equal(pays.length, 3); assert.ok(pays.every((p: any) => p.st === 'unpaid'));
    const notes = pg(`select json_agg(1) from public.notifications where recipient_id in ('${A}','${B}','${CH}')`);
    assert.ok(notes && notes.length >= 3, 'existing bill-published notification trigger fired');
    assert.match((await as(O1).rpc('save_pooling_bill_run', { p_month: 9, p_year: 2026, p_payload: poolingPayload(result) })).error.message, /already published/);
    // member-facing existing query path sees their own published bill
    const mine = await as(A).from('monthly_bills').select('total').eq('employee_id', A).eq('published', true);
    assert.equal(mine.data.length, 1);
  });

  await t.test('RLS privacy: member sees only own line; no run access; other tenant sees nothing', async () => {
    assert.equal((await as(A).from('pooling_bill_lines').select('employee_id')).data.length, 1);
    assert.deepEqual((await as(A).from('pooling_bill_runs').select('id')).data, []);
    assert.deepEqual((await as(O2).from('pooling_bill_lines').select('employee_id')).data, []);
    assert.equal((await as(O1).from('pooling_bill_lines').select('employee_id')).data.length, 3);
    assert.match(sql(URL!, { role: 'authenticated', sub: O1 }, `update public.pooling_bill_lines set share_paise=0`).error.message, /permission denied/);
  });

  await t.test('service-only RPCs are not executable by authenticated/anon', async () => {
    for (const s of [{ role: 'authenticated' as const, sub: O1 }, { role: 'anon' as const }]) {
      const r = await makeClient(URL!, s).rpc('auto_bill_publish_standard', { p_canteen: C3, p_employee: D1, p_month: 9, p_year: 2026 });
      assert.match(r.error.message, /permission denied/);
    }
    assert.match(sql(URL!, { role: 'authenticated', sub: O1 }, `select gocanteen_private.save_pooling_run(null,2026,9,'{}',null,'x')`).error.message, /permission denied/);
  });

  await t.test('automatic sending: dry run sends nothing; live standard path uses unchanged publish_employee_bill; reruns idempotent', async () => {
    pg(`insert into public.canteen_billing_settings(canteen_id,billing_model,bill_send_mode) values('${C3}','standard','automatic')`);
    const now = new Date('2026-10-01T01:00:00Z');
    const dry = await runAutoSend({ db: svc(), now, liveSend: false });
    assert.equal(dry.sent, 0); assert.ok(dry.dryRun >= 1);
    assert.equal(pg(`select json_agg(1) from public.monthly_bills where canteen_id='${C3}'`), null);
    // two schedulers at once (real separate sessions)
    const [s1, s2] = await Promise.all([runAutoSend({ db: svc(), now, liveSend: true }), runAutoSend({ db: svc(), now, liveSend: true })]);
    const bills = pg(`select json_agg(json_build_object('total',total,'food',food_total)) from public.monthly_bills where canteen_id='${C3}'`);
    assert.equal(bills.length, 1);
    assert.equal(Number(bills[0].total), 130); // 2 x 50 meals + 30 curry, priced standard order lines
    assert.equal(pg(`select json_agg(1) from public.bill_payments p join public.monthly_bills b on b.id=p.bill_id where b.canteen_id='${C3}'`).length, 1);
    const sentRows = pg(`select json_agg(1) from public.bill_auto_send_attempts where canteen_id='${C3}' and status='sent'`);
    assert.equal(sentRows.length, 1);
    const s3 = await runAutoSend({ db: svc(), now, liveSend: true });
    assert.equal(s3.sent, 0);
    // C1 is pooling + manual -> never touched by the scheduler
    assert.ok(![s1, s2, s3].some(s => s.details.some((d: any) => d.canteenId === C1)));
  });

  await t.test('truly concurrent service publishes (two OS processes) create exactly one standard bill payment', async () => {
    sql(URL!, { role: 'authenticated', sub: O3 }, `insert into public.orders(id,employee_id,ordered_for,status,order_source,canteen_id) values('d0000000-0000-0000-0000-0000000000a1','${D1}','2026-10-02','active','admin','${C3}')`);
    sql(URL!, { role: 'authenticated', sub: O3 }, `insert into public.order_items(order_id,item_code,item_name,quantity,unit_price,item_source,canteen_id) values('d0000000-0000-0000-0000-0000000000a1','meal','Meals',2,45,'employee','${C3}')`);
    const call = () => new Promise<string>(res => { const p = spawn('psql', [URL!, '-X', '-tA', '-c', `begin; set local role service_role; select set_config('request.jwt.claims','{"role":"service_role"}',true); select (public.auto_bill_publish_standard('${C3}','${D1}',10,2026)).total; select pg_sleep(0.3); commit;`]); let o = ''; p.stdout.on('data', d => o += d); p.stderr.on('data', d => o += d); p.on('close', () => res(o)); });
    const outs = await Promise.all([call(), call()]);
    const okCount = outs.filter(o => /\n90(\.0+)?\n/.test('\n' + o)).length;
    assert.equal(okCount, 1, outs.join(' | '));
    assert.ok(outs.some(o => /No new amount/.test(o)), outs.join(' | '));
    const n = pg(`select json_agg(1) from public.bill_payments p join public.monthly_bills b on b.id=p.bill_id where b.canteen_id='${C3}' and b.bill_month=10`);
    assert.equal(n.length, 1);
  });

  await t.test('automatic pooling path end-to-end (separate month, service role)', async () => {
    pg(`update public.canteen_billing_settings set bill_send_mode='automatic' where canteen_id='${C1}'`);
    const now = new Date('2026-11-01T00:00:00Z'); // previous month = October
    const live = await runAutoSend({ db: svc(), now, liveSend: true });
    const octBills = pg(`select json_agg(json_build_object('e',employee_id,'t',total)) from public.monthly_bills where canteen_id='${C1}' and bill_month=10`);
    const sum = octBills.reduce((s: number, b: any) => s + Math.round(Number(b.t) * 100), 0);
    assert.equal(sum, 30000); // Oct expense 300.00 fully distributed
    assert.equal(live.failed, 0);
    const again = await runAutoSend({ db: svc(), now, liveSend: true });
    assert.equal(again.sent, 0);
  });
});
