// Real-Postgres integration tests (skipped unless PGTEST_ADMIN_URL is set).
// Run: bash supabase/tests/run-db-tests.sh  (creates a throwaway local DB; synthetic data only)
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
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


// superuser (local throwaway DB only) for synthetic fixture setup inside a test
const root = (q: string) => { const r = spawnSync('psql', [URL!, '-X', '-q', '-tA', '-v', 'ON_ERROR_STOP=1', '-c', q], { encoding: 'utf8' }); if (r.status !== 0) throw new Error(r.stderr); return r.stdout.trim(); };
const cnt = (q: string) => Number(root(q));
const C4 = 'c4000000-0000-0000-0000-000000000000', O4 = '44444444-0000-0000-0000-000000000001', M4 = '44444444-0000-0000-0000-0000000000e1', E4 = '44444444-0000-0000-0000-0000000000d1';
const C5 = 'c5000000-0000-0000-0000-000000000000', O5 = '55555555-0000-0000-0000-000000000001', E5 = '55555555-0000-0000-0000-0000000000d1';

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
    // mess cut threshold 0..31 (0 = no minimum); out of range rejected, never clamped
    for (const n of [0, 1, 2, 3, 10, 31]) { const r = await as(O1).rpc('set_canteen_billing_settings', { p_billing_model: 'pooling', p_mess_cut_min_days: n, p_bill_send_mode: 'manual' }); assert.equal(r.error, null, String(n)); assert.equal(r.data.mess_cut_min_days, n); }
    for (const n of [-1, 32]) assert.match((await as(O1).rpc('set_canteen_billing_settings', { p_billing_model: 'pooling', p_mess_cut_min_days: n, p_bill_send_mode: 'manual' })).error.message, /whole number from 0 to 31/);
    assert.throws(() => root(`update public.canteen_billing_settings set mess_cut_min_days=-1 where canteen_id='${C1}'`), /check constraint/);
    assert.equal((await as(O1).rpc('set_canteen_billing_settings', { p_billing_model: 'pooling', p_mess_cut_min_days: 6, p_bill_send_mode: 'manual' })).data.mess_cut_min_days, 6);
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
    // joined 22nd IST: 20 pre-join operating days count as no-order days (owner rule t53s243) -> mess cut, 9 eaten days charged
    assert.equal(l(CH).windowDays, 29); assert.equal(l(CH).absentDays, 20); assert.equal(l(CH).messCutApplied, true); assert.equal(l(CH).chargeableDays, 9);
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
    // engine v2 only: old-app payloads and old saved draft runs are refused (published runs untouched)
    assert.match((await as(O1).rpc('save_pooling_bill_run', { p_month: 9, p_year: 2026, p_payload: { ...payload, engineVersion: 1 } })).error.message, /old pooling calculation/);
    assert.match((await as(O1).rpc('save_pooling_bill_run', { p_month: 9, p_year: 2026, p_payload: { ...payload, messCutMinDays: 5 } })).error.message, /Mess cut setting changed/);
    root(`update public.pooling_bill_runs set calculation = calculation || '{"engineVersion":1}' where id='${runId}'`);
    assert.match((await as(O1).rpc('publish_pooling_bill', { p_run_id: runId, p_employee_id: A })).error.message, /old pooling method/);
    root(`update public.pooling_bill_runs set calculation = calculation || '{"engineVersion":2}' where id='${runId}'`);
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
  await t.test('guard: Standard publish refused in a Pooling canteen; Standard canteens unchanged', async () => {
    // C1 is pooling (set above). Owner with payments permission still cannot create a Standard bill there.
    root(`select set_config('request.jwt.claims','{"role":"authenticated","sub":"${O1}"}',false);
      insert into public.orders(id,employee_id,ordered_for,status,order_source,canteen_id) values('aaaa0000-0000-0000-0000-000000000001','${A}','2026-08-10','active','admin','${C1}');
      insert into public.order_items(order_id,item_code,item_name,quantity,unit_price,item_source,canteen_id) values('aaaa0000-0000-0000-0000-000000000001','meal','Meals',1,55,'employee','${C1}');`);
    const before = cnt(`select count(*) from public.monthly_bills where canteen_id='${C1}'`);
    const r = await as(O1).rpc('publish_employee_bill', { p_employee_id: A, p_month: 8, p_year: 2026, p_food_total: 0, p_admin_added_total: 0 });
    assert.match(r.error.message, /uses Pooling billing/);
    assert.equal(cnt(`select count(*) from public.monthly_bills where canteen_id='${C1}'`), before);
    // direct owner insert path (RLS bills_owner_write) is guarded too
    assert.match(sql(URL!, { role: 'authenticated', sub: O1 }, `insert into public.monthly_bills(employee_id,bill_month,bill_year,canteen_id,total,published) values('${A}',7,2026,'${C1}',1,true)`).error.message, /uses Pooling billing/);
    // Standard canteen C3: manual publish via the unchanged function still works
    root(`select set_config('request.jwt.claims','{"role":"authenticated","sub":"${O3}"}',false);
      insert into public.orders(id,employee_id,ordered_for,status,order_source,canteen_id) values('aaaa0000-0000-0000-0000-000000000003','${D1}','2026-08-11','active','admin','${C3}');
      insert into public.order_items(order_id,item_code,item_name,quantity,unit_price,item_source,canteen_id) values('aaaa0000-0000-0000-0000-000000000003','meal','Meals',2,40,'employee','${C3}');`);
    const ok = await as(O3).rpc('publish_employee_bill', { p_employee_id: D1, p_month: 8, p_year: 2026, p_food_total: 0, p_admin_added_total: 0 });
    assert.equal(ok.error, null); assert.equal(Number(ok.data.total), 80);
    assert.equal(cnt(`select count(*) from public.bill_payments where bill_id='${ok.data.id}'`), 1);
    // flag is not left on after a pooling publish (transaction-local and reset)
    assert.equal(root(`select coalesce(current_setting('gocanteen.pooling_publish',true),'')`), '');
  });

  await t.test('auto Standard actor: password owner w/o permission skipped, permitted master used; none permitted => safe failure', async () => {
    root(`insert into auth.users(id,email) values('${O4}','o4@test'),('${M4}','m4@test'),('${E4}','e4@test'),('${O5}','o5@test'),('${E5}','e5@test');
      insert into public.canteens(id,name,owner_id) values('${C4}','Std Password Owner','${O4}'),('${C5}','Std No Payer','${O5}');
      insert into public.profiles(id,role,status,full_name,employee_code,admin_role,canteen_id,created_at) values
        ('${O4}','admin','active','Owner Four','o4','owner','${C4}','2026-01-01'),
        ('${M4}','admin','active','Master Four','x4','master_admin','${C4}','2026-01-02'),
        ('${E4}','employee','active','Member Four','e4','owner','${C4}','2026-01-01'),
        ('${O5}','admin','active','Owner Five','o5','owner','${C5}','2026-01-01'),
        ('${E5}','employee','active','Member Five','e5','owner','${C5}','2026-01-01');
      insert into public.admin_permissions(admin_id,canteen_id,permission,enabled) values('${M4}','${C4}','payments',true);
      select set_config('request.jwt.claims','{"role":"authenticated","sub":"${M4}"}',false);
      insert into public.orders(id,employee_id,ordered_for,status,order_source,canteen_id) values('aaaa0000-0000-0000-0000-000000000004','${E4}','2026-08-12','active','admin','${C4}'),('aaaa0000-0000-0000-0000-000000000005','${E5}','2026-08-12','active','admin','${C5}');
      insert into public.order_items(order_id,item_code,item_name,quantity,unit_price,item_source,canteen_id) values('aaaa0000-0000-0000-0000-000000000004','meal','Meals',1,30,'employee','${C4}'),('aaaa0000-0000-0000-0000-000000000005','meal','Meals',1,30,'employee','${C5}');`);
    const perms = cnt(`select count(*) from public.admin_permissions`);
    // sanity: under the REAL production rules (real-schema facsimile) a non-Google owner without a payments row lacks permission.
    // The legacy approximate stub schema is looser, so this precondition is only asserted when the real definition is loaded.
    const realRules = root(`select count(*) from pg_proc where proname='has_admin_permission' and prosrc like '%is_google_owner%'`) !== '0';
    if (realRules) assert.match((await as(O4).rpc('publish_employee_bill', { p_employee_id: E4, p_month: 8, p_year: 2026, p_food_total: 0, p_admin_added_total: 0 })).error.message, /permission required/);
    const r4 = await svc().rpc('auto_bill_publish_standard', { p_canteen: C4, p_employee: E4, p_month: 8, p_year: 2026 });
    assert.equal(r4.error, null); assert.equal(Number(r4.data.total), 30); assert.equal(r4.data.canteen_id, C4);
    const r5 = await svc().rpc('auto_bill_publish_standard', { p_canteen: C5, p_employee: E5, p_month: 8, p_year: 2026 });
    if (realRules) {
      assert.match(r5.error?.message ?? '', /No active owner\/master admin with payments permission/);
      assert.equal(cnt(`select count(*) from public.monthly_bills where canteen_id='${C5}'`), 0);
    }
    assert.equal(cnt(`select count(*) from public.admin_permissions`), perms); // nothing granted
    // still not callable by app users
    assert.match((await as(O4).rpc('auto_bill_publish_standard', { p_canteen: C4, p_employee: E4, p_month: 8, p_year: 2026 })).error.message, /permission denied/);
  });
  await t.test('cron runtime gate: Vault secret compare, default dry run, service-only, fail closed', async () => {
    const auth = async (secret: string) => (await svc().rpc('auto_bill_authorize', { p_secret: secret }));
    assert.deepEqual((await auth('x'.repeat(40))).data, { ok: false, live: false }); // no secret configured yet
    assert.match((await as(O1).rpc('auto_bill_authorize', { p_secret: 'x' })).error.message, /permission denied/);
    assert.equal(cnt(`select count(*) from information_schema.role_table_grants where table_schema='gocanteen_private' and table_name='auto_bill_runtime' and grantee in ('anon','authenticated')`), 0);
    const hasVault = root(`select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='vault' and proname='create_secret'`) !== '0';
    if (!hasVault) return;
    const SYN = 'synthetic-test-secret-' + 'z'.repeat(20); // synthetic, local throwaway DB only
    root(`select vault.create_secret('${SYN}','auto_bill_cron_secret')`);
    assert.deepEqual((await auth(SYN)).data, { ok: true, live: false });
    assert.deepEqual((await auth(SYN + 'x')).data, { ok: false, live: false });
    root(`update gocanteen_private.auto_bill_runtime set live=true`);
    assert.deepEqual((await auth(SYN)).data, { ok: true, live: true });
    root(`update gocanteen_private.auto_bill_runtime set live=false; delete from vault.secrets where name='auto_bill_cron_secret'`);
  });
  await t.test('hardening: no TRUNCATE/TRIGGER/REFERENCES for app roles on pooling tables; SELECT kept', async () => {
    const tables = ['public.canteen_billing_settings', 'public.pooling_bill_runs', 'public.pooling_bill_lines', 'public.bill_auto_send_attempts', 'gocanteen_private.auto_bill_runtime'];
    for (const tb of tables) for (const r of ['anon', 'authenticated']) for (const pv of ['TRUNCATE', 'TRIGGER', 'REFERENCES'])
      assert.equal(root(`select has_table_privilege('${r}','${tb}','${pv}')`), 'f', `${r} ${pv} ${tb}`);
    for (const tb of tables.slice(0, 4)) {
      assert.equal(root(`select has_table_privilege('authenticated','${tb}','SELECT')`), 't');
      assert.equal(root(`select has_table_privilege('service_role','${tb}','TRUNCATE')`), 't');
    }
    assert.match(sql(URL!, { role: 'authenticated', sub: O1 }, `truncate public.pooling_bill_lines`).error.message, /permission denied/);
    // normal authorized path unchanged: owner still reads own canteen settings under RLS
    assert.equal((await as(O1).from('canteen_billing_settings').select('billing_model').maybeSingle()).data.billing_model, 'pooling');
  });
  await t.test('member periods: trigger records join/leave (IST, inclusive), rejoin opens new period; Standard delete flow unchanged', async () => {
    if (root(`select to_regclass('public.pooling_member_periods') is not null`) !== 't') return;
    const P = '11111111-0000-0000-0000-0000000000c9';
    root(`insert into auth.users(id,email) values('${P}','p@test');
      insert into public.profiles(id,role,status,full_name,employee_code,admin_role,canteen_id,created_at) values('${P}','employee','active','Period Member','pm','owner','${C1}','2026-09-03 20:00:00+00');`);
    assert.equal(root(`select joined_on||'|'||coalesce(left_on::text,'open') from public.pooling_member_periods where employee_id='${P}'`), '2026-09-04|open');
    root(`select set_config('request.jwt.claims','{"role":"authenticated","sub":"${O1}"}',false); update public.profiles set status='deleted' where id='${P}'`);
    const today = root(`select (now() at time zone 'Asia/Kolkata')::date`);
    assert.equal(root(`select left_on from public.pooling_member_periods where employee_id='${P}'`), today);
    assert.equal(root(`select status from public.profiles where id='${P}'`), 'deleted'); // soft delete kept, history kept
    root(`select set_config('request.jwt.claims','{"role":"authenticated","sub":"${O1}"}',false); update public.profiles set status='active' where id='${P}'`);
    assert.equal(cnt(`select count(*) from public.pooling_member_periods where employee_id='${P}'`), root(`select (joined_on=(now() at time zone 'Asia/Kolkata')::date)::int from public.pooling_member_periods where employee_id='${P}' order by joined_on limit 1`) === '1' ? 1 : 2);
    assert.equal(cnt(`select count(*) from public.pooling_member_periods where employee_id='${P}' and left_on is null`), 1);
    // app roles: read-only for payments admins, nothing for members; no truncate
    assert.match(sql(URL!, { role: 'authenticated', sub: O1 }, `insert into public.pooling_member_periods(canteen_id,employee_id,joined_on) values('${C1}','${P}','2026-01-01')`).error.message, /permission denied/);
    assert.equal(root(`select has_table_privilege('authenticated','public.pooling_member_periods','TRUNCATE')`), 'f');
    assert.equal((await as(A).from('pooling_member_periods').select('employee_id')).data.length, 0);
    assert.ok((await as(O1).from('pooling_member_periods').select('employee_id')).data.length >= 1);
  });
  await t.test('special priced items (Pooling): weekly opt-in via RPC, daily TRUE/FALSE/NULL precedence, server snapshot, tamper/id-swap/GUC ignored, reschedule re-prices', async () => {
    if (root(`select to_regclass('public.pooling_special_items') is not null`) !== 't') return;
    const asAdm = (sub: string, q: string) => root(`select set_config('request.jwt.claims','{"role":"authenticated","sub":"${sub}"}',false); ${q}`);
    // June 2026: 02 Tue(2) 03 Wed(3) 04 Thu(4) 05 Fri(5)
    for (const [C, O] of [[C1, O1], [C2, O2], [C3, O3]] as const)
      asAdm(O, `insert into public.weekly_menu(canteen_id,weekday,item_code,item_name,unit_price,active) select '${C}',w,c,c,0,true from generate_series(0,6) w, unnest(array['sp1','reg','sp2']) c on conflict do nothing`);
    // RPC: payments admin sets prices for its own canteen only; members/anon refused
    for (const w of [2, 3, 4, 5]) assert.equal((await as(O1).rpc('set_pooling_special_item', { p_weekday: w, p_item_code: 'sp1', p_price_paise: 2550 })).error, null);
    assert.equal((await as(O1).rpc('set_pooling_special_item', { p_weekday: 2, p_item_code: 'ghost', p_price_paise: 777 })).error, null); // not on the weekly menu
    assert.match((await as(A).rpc('set_pooling_special_item', { p_weekday: 2, p_item_code: 'reg', p_price_paise: 1 })).error.message, /permission required/);
    assert.match((await makeClient(URL!, { role: 'anon' }).rpc('set_pooling_special_item', { p_weekday: 2, p_item_code: 'reg', p_price_paise: 1 })).error.message, /permission denied/);
    assert.match((await as(O1).rpc('set_pooling_special_item', { p_weekday: 2, p_item_code: 'reg', p_price_paise: -1 })).error.message, /0 or more/);
    for (const w of [2, 3, 4, 5]) assert.equal((await as(O2).rpc('set_pooling_special_item', { p_weekday: w, p_item_code: 'sp1', p_price_paise: 9999 })).error, null);
    assert.equal(cnt(`select count(*) from public.pooling_special_items where canteen_id='${C1}'`), 5);
    assert.equal(cnt(`select count(*) from public.pooling_special_items where canteen_id='${C2}'`), 4); // RPC scoped to caller's canteen
    assert.equal((await as(O2).from('pooling_special_items').select('item_code')).data.length, 4); // RLS: C2 sees only its rows
    assert.equal((await as(A).from('pooling_special_items').select('item_code')).data.length, 5); // members read own canteen (menu display)
    assert.match(sql(URL!, { role: 'authenticated', sub: O1 }, `insert into public.pooling_special_items(canteen_id,weekday,item_code,price_paise) values('${C1}',1,'x',1)`).error.message, /permission denied/); // RPC only
    // daily overrides (server-only): 03 TRUE 30.00; 05 explicit FALSE (must NOT fall back to weekly TRUE); 02 NULL inherits
    root(`set session_replication_role=replica;
      insert into public.daily_menu(canteen_id,menu_date,item_code,item_name,unit_price,active,pooling_special,pooling_special_price_paise) values
        ('${C1}','2026-06-03','sp1','sp1',0,true,true,3000),('${C1}','2026-06-05','sp1','sp1',0,true,false,null),('${C1}','2026-06-02','sp1','sp1',0,true,null,null);
      set session_replication_role=origin;`);
    assert.throws(() => root(`set session_replication_role=replica; update public.daily_menu set pooling_special_price_paise=null where canteen_id='${C1}' and menu_date='2026-06-03'`), /check/i); // TRUE requires a price
    const todayIst = root(`select (now() at time zone 'Asia/Kolkata')::date`);
    root(`insert into public.daily_menu(canteen_id,menu_date,item_code,item_name,unit_price,active) values('${C1}','${todayIst}','reg','reg',0,true) on conflict do nothing`);
    assert.throws(() => asAdm(A, `update public.daily_menu set pooling_special=true, pooling_special_price_paise=1 where canteen_id='${C1}' and menu_date='${todayIst}'`), /permission required/); // members can't set daily prices
    assert.throws(() => asAdm(S1, `update public.daily_menu set pooling_special=false where canteen_id='${C1}' and menu_date='${todayIst}'`), /permission required/); // nor admins without payments
    asAdm(O1, `update public.daily_menu set pooling_special=null, item_name='Meals' where canteen_id='${C1}' and menu_date='${todayIst}'`); // ordinary daily edit unaffected
    root(`insert into public.expenses(canteen_id,expense_date,amount,description) values('${C1}','2026-06-10',290.00,'Rice')`);
    const OA = 'ab000000-0000-0000-0000-000000000001', OB = 'ab000000-0000-0000-0000-000000000002', OX = 'ab000000-0000-0000-0000-000000000003', OF = 'ab000000-0000-0000-0000-000000000005', OS = 'ab000000-0000-0000-0000-000000000004';
    asAdm(O1, `insert into public.orders(id,employee_id,ordered_for,status,order_source,canteen_id) values('${OA}','${A}','2026-06-02','active','admin','${C1}'),('${OB}','${B}','2026-06-03','active','admin','${C1}'),('${OX}','${B}','2026-06-04','active','admin','${C1}'),('${OF}','${B}','2026-06-05','active','admin','${C1}');
      insert into public.order_items(order_id,item_code,item_name,quantity,unit_price,item_source,canteen_id,pooling_special,pooling_special_unit_paise) values
        ('${OA}','sp1','Fish fry',2,0.01,'employee','${C1}',false,1),
        ('${OA}','reg','Meals',1,0,'employee','${C1}',true,999999),
        ('${OA}','sp1','Fish fry',1,0,'guest','${C1}',false,null),
        ('${OA}','ghost','Ghost',1,0,'employee','${C1}',false,null),
        ('${OB}','sp1','Fish fry',1,0,'employee','${C1}',false,null),
        ('${OX}','sp1','Fish fry',5,0,'employee','${C1}',false,null),
        ('${OF}','sp1','Fish fry',1,0,'employee','${C1}',true,5000),
        ('${OA}','sp2','Chicken',1,0,'employee','${C1}',false,null);`);
    const snap = (o: string, code: string, src = 'employee') => root(`select pooling_special||'|'||coalesce(pooling_special_unit_paise::text,'-') from public.order_items where order_id='${o}' and item_code='${code}' and item_source='${src}'`);
    assert.equal(snap(OA, 'sp1'), 'true|2550'); // client false/1 ignored; daily NULL inherits weekly
    assert.equal(snap(OA, 'reg'), 'false|-'); // client true/999999 ignored
    assert.equal(snap(OA, 'sp1', 'guest'), 'true|2550');
    assert.equal(snap(OA, 'ghost'), 'false|-'); // price row without a weekly menu item is not applied
    assert.equal(snap(OB, 'sp1'), 'true|3000'); // daily TRUE override price
    assert.equal(snap(OF, 'sp1'), 'false|-'); // daily explicit FALSE beats weekly TRUE (and client true/5000)
    assert.equal(snap(OA, 'sp2'), 'false|-'); // ordered before it was flagged
    for (const w of [2, 3, 4, 5]) await as(O1).rpc('set_pooling_special_item', { p_weekday: w, p_item_code: 'sp2', p_price_paise: 5000 });
    for (const w of [2, 3, 4, 5]) await as(O1).rpc('set_pooling_special_item', { p_weekday: w, p_item_code: 'sp1', p_price_paise: 4000 });
    // UPDATE tamper: qty edit + direct flag/price writes keep the snapshot despite the menu price change
    asAdm(O1, `update public.order_items set quantity=3, pooling_special_unit_paise=1 where order_id='${OA}' and item_code='sp1' and item_source='employee';
      update public.order_items set quantity=2, pooling_special=true, pooling_special_unit_paise=1 where order_id='${OA}' and item_code='sp2'`);
    assert.equal(snap(OA, 'sp1'), 'true|2550'); assert.equal(snap(OA, 'sp2'), 'false|-');
    // client cannot use the internal re-price bypass (GUC is honoured only inside the orders trigger)
    asAdm(O1, `select set_config('gocanteen.pooling_resnapshot','on',false); update public.order_items set pooling_special=true, pooling_special_unit_paise=1 where order_id='${OA}' and item_code='reg'`);
    assert.equal(snap(OA, 'reg'), 'false|-');
    // id swap: moving an item to another order re-validates from the server (06-03 daily TRUE 30.00); client price ignored
    const ZO = 'ab000000-0000-0000-0000-000000000006', ZT = 'ab000000-0000-0000-0000-000000000008';
    asAdm(O1, `insert into public.orders(id,employee_id,ordered_for,status,order_source,canteen_id) values('${ZO}','${CH}','2026-06-09','active','admin','${C1}'),('${ZT}','${CH}','2026-06-03','active','admin','${C1}'); insert into public.order_items(order_id,item_code,item_name,quantity,unit_price,item_source,canteen_id) values('${ZO}','reg','Meals',1,0,'employee','${C1}')`);
    asAdm(O1, `update public.order_items set order_id='${ZT}', item_code='sp1', pooling_special=false, pooling_special_unit_paise=1 where order_id='${ZO}'`);
    assert.equal(snap(ZT, 'sp1'), 'true|3000');
    asAdm(O1, `update public.orders set status='cancelled', cancelled_at=now() where id in ('${ZO}','${ZT}')`); // keep June totals simple
    // item change re-validates
    asAdm(O1, `update public.order_items set item_code='reg' where order_id='${OB}' and item_code='sp1'`); assert.equal(snap(OB, 'reg'), 'false|-');
    asAdm(O1, `update public.order_items set item_code='sp1' where order_id='${OB}' and item_code='reg'`); assert.equal(snap(OB, 'sp1'), 'true|3000');
    // rescheduling an order re-prices from the server for the new date (then back)
    asAdm(O1, `update public.orders set ordered_for='2026-06-02' where id='${OB}'`); assert.equal(snap(OB, 'sp1'), 'true|4000'); // 02: daily NULL -> current weekly price
    asAdm(O1, `update public.orders set ordered_for='2026-06-03' where id='${OB}'`); assert.equal(snap(OB, 'sp1'), 'true|3000');
    asAdm(O1, `update public.orders set status='cancelled', cancelled_at=now() where id='${OX}'`); // cancelled -> excluded
    // cross-canteen: item canteen must equal its order's canteen (insert and update); other tenant cannot touch C1 items
    assert.throws(() => root(`insert into public.order_items(order_id,item_code,item_name,quantity,unit_price,canteen_id) values('${OA}','sp1','x',1,0,'${C2}')`), /canteen does not match/);
    assert.throws(() => root(`update public.order_items set canteen_id='${C2}' where order_id='${OA}' and item_code='reg'`), /canteen does not match/);
    if (process.env.PGTEST_REAL_SCHEMA === '1') { // tenant RLS on order_items exists only in the real-schema copy, not the simplified stub
      sql(URL!, { role: 'authenticated', sub: O2 }, `update public.order_items set quantity=99 where order_id='${OA}'`);
      assert.equal(cnt(`select count(*) from public.order_items where order_id='${OA}' and quantity=99`), 0);
    }
    // Standard canteen (C3) never snapshots even with a weekly price row (mode switch safety)
    root(`insert into public.pooling_special_items(canteen_id,weekday,item_code,price_paise) values('${C3}',2,'sp1',9999)`);
    asAdm(O3, `insert into public.orders(id,employee_id,ordered_for,status,order_source,canteen_id) values('${OS}','${D1}','2026-06-02','active','admin','${C3}'); insert into public.order_items(order_id,item_code,item_name,quantity,unit_price,item_source,canteen_id) values('${OS}','sp1','Fish fry',1,60,'employee','${C3}')`);
    assert.equal(snap(OS, 'sp1'), 'false|-');
    // soft-deleted member keeps their June specials on the bill (membership period covers June)
    const P2 = '11111111-0000-0000-0000-0000000000c8', OP = 'ab000000-0000-0000-0000-000000000007';
    root(`insert into auth.users(id,email) values('${P2}','p2@test'); insert into public.profiles(id,role,status,full_name,employee_code,admin_role,canteen_id,created_at) values('${P2}','employee','active','Soft Deleted','sd','owner','${C1}','2026-05-20 06:00:00+00')`);
    asAdm(O1, `insert into public.orders(id,employee_id,ordered_for,status,order_source,canteen_id) values('${OP}','${P2}','2026-06-02','active','admin','${C1}'); insert into public.order_items(order_id,item_code,item_name,quantity,unit_price,item_source,canteen_id) values('${OP}','sp1','Fish fry',1,0,'employee','${C1}')`);
    asAdm(O1, `update public.profiles set status='deleted' where id='${P2}'`);
    assert.equal(root(`select string_agg(employee_id||':'||member_paise||':'||guest_paise, ',' order by employee_id) from gocanteen_private.pooling_special_totals('${C1}',2026,6)`), `${A}:7650:2550,${B}:3000:0,${P2}:4000:0`);
    // engine/loader read the server snapshot; pool share formula unchanged
    const input = await loadPoolingInput(as(O1), { canteenId: C1, year: 2026, month: 6, messCutMinDays: 6 });
    assert.deepEqual(input.specials?.[A], { memberPaise: 7650, guestPaise: 2550 });
    assert.deepEqual(input.specials?.[B], { memberPaise: 3000, guestPaise: 0 });
    assert.deepEqual(input.specials?.[P2], { memberPaise: 4000, guestPaise: 0 });
    const res = computePoolingBills(input);
    const without = computePoolingBills({ ...input, specials: {} });
    assert.deepEqual(res.lines.map((l: any) => l.sharePaise), without.lines.map((l: any) => l.sharePaise)); // never deducted from pool
    assert.equal(res.lines.reduce((t: number, l: any) => t + l.sharePaise, 0) + res.unallocatedPaise, 29000);
    const la = res.lines.find((l: any) => l.memberId === A), lp = res.lines.find((l: any) => l.memberId === P2);
    assert.ok(la && lp, 'A and soft-deleted P2 are in the June cohort');
    assert.equal(la.totalPaise, la.sharePaise + la.adminAddedPaise + 10200);
    assert.equal(lp.specialMemberPaise, 4000);
    const payload = poolingPayload(res);
    const bump = (f: string, d: number) => ({ ...payload, lines: payload.lines.map((l: any) => l.memberId === A ? { ...l, [f]: (l[f] || 0) + d, totalPaise: l.totalPaise + d } : l) });
    assert.match((await as(O1).rpc('save_pooling_bill_run', { p_month: 6, p_year: 2026, p_payload: bump('specialMemberPaise', -2550) })).error.message, /Special item charges changed/);
    assert.match((await as(O1).rpc('save_pooling_bill_run', { p_month: 6, p_year: 2026, p_payload: bump('specialGuestPaise', 1) })).error.message, /Special item charges changed/);
    const dropped = { ...payload, lines: payload.lines.map((l: any) => l.memberId === P2 ? { ...l, specialMemberPaise: 0, totalPaise: l.totalPaise - 4000 } : l) };
    assert.match((await as(O1).rpc('save_pooling_bill_run', { p_month: 6, p_year: 2026, p_payload: dropped })).error.message, /Special item charges changed/);
    const badTotal = { ...payload, lines: payload.lines.map((l: any) => l.memberId === A ? { ...l, totalPaise: l.totalPaise + 1 } : l) };
    assert.match((await as(O1).rpc('save_pooling_bill_run', { p_month: 6, p_year: 2026, p_payload: badTotal })).error.message, /do not add up/);
    const ok = await as(O1).rpc('save_pooling_bill_run', { p_month: 6, p_year: 2026, p_payload: payload });
    assert.equal(ok.error, null, ok.error?.message);
    // parallel publish of different members (two real sessions), then repeat publish of A is idempotent
    const pub = (e: string) => new Promise<string>(res2 => { const p = spawn('psql', [URL!, '-X', '-tA', '-c', `begin; set local role authenticated; select set_config('request.jwt.claims','{"role":"authenticated","sub":"${O1}"}',true); select (public.publish_pooling_bill('${ok.data.id}','${e}')).id; select pg_sleep(0.2); commit;`]); let o = ''; p.stdout.on('data', d => o += d); p.stderr.on('data', d => o += d); p.on('close', () => res2(o)); });
    const outs = await Promise.all([pub(A), pub(A), pub(B), pub(P2)]);
    assert.ok(outs.every(o => /[0-9a-f-]{36}/.test(o)), outs.join(' | '));
    assert.equal(cnt(`select count(*) from public.monthly_bills where canteen_id='${C1}' and bill_month=6 and employee_id='${A}'`), 1);
    const bill = (e: string) => root(`select round(total*100)::bigint||'|'||round(special_items_total*100)::bigint from public.monthly_bills where canteen_id='${C1}' and bill_month=6 and bill_year=2026 and employee_id='${e}'`);
    assert.equal(bill(A), `${la.totalPaise}|10200`);
    assert.equal(bill(P2), `${lp.totalPaise}|4000`);
    assert.equal(root(`select special_member_paise||'|'||special_guest_paise from public.pooling_bill_lines l join public.pooling_bill_runs r on r.id=l.run_id where r.canteen_id='${C1}' and r.bill_month=6 and l.employee_id='${A}'`), '7650|2550');
    // lock: a later special order does not change the published bill, and re-saving the month is refused
    asAdm(O1, `insert into public.order_items(order_id,item_code,item_name,quantity,unit_price,item_source,canteen_id) values('${OA}','sp2','Chicken',1,0,'guest','${C1}')`);
    assert.equal(snap(OA, 'sp2', 'guest'), 'true|5000');
    assert.equal(bill(A), `${la.totalPaise}|10200`);
    assert.match((await as(O1).rpc('save_pooling_bill_run', { p_month: 6, p_year: 2026, p_payload: payload })).error.message, /already published/);
    // Standard bills untouched (special_items_total stays 0)
    assert.equal(cnt(`select count(*) from public.monthly_bills where canteen_id='${C3}' and coalesce(special_items_total,0)<>0`), 0);
  });

  await t.test('manual publish while Automatic is selected (both models), then the scheduler: no duplicate bills or payments', async () => {
    if (root(`select to_regclass('public.pooling_special_items') is not null`) !== 't') return;
    assert.equal(root(`select string_agg(billing_model||'/'||bill_send_mode, ',' order by billing_model) from public.canteen_billing_settings where canteen_id in ('${C1}','${C3}')`), 'pooling/automatic,standard/automatic');
    // Pooling June was published manually above (publish_pooling_bill) while C1 is Automatic. Standard: manual publish now.
    const std = await as(O3).rpc('publish_employee_bill', { p_employee_id: D1, p_month: 6, p_year: 2026, p_food_total: 60, p_admin_added_total: 0 });
    assert.equal(std.error, null, std.error?.message);
    const count = (C: string, tbl: string) => cnt(`select count(*) from public.${tbl} x ${tbl === 'bill_payments' ? `join public.monthly_bills b on b.id=x.bill_id where b.canteen_id='${C}' and b.bill_month=6 and b.bill_year=2026` : `where x.canteen_id='${C}' and x.bill_month=6 and x.bill_year=2026`}`);
    const before = [count(C1, 'monthly_bills'), count(C1, 'bill_payments'), count(C3, 'monthly_bills'), count(C3, 'bill_payments')];
    const live = await runAutoSend({ db: svc(), now: new Date('2026-07-01T01:30:00Z'), liveSend: true }); // 07:00 IST on the 1st
    assert.deepEqual([count(C1, 'monthly_bills'), count(C1, 'bill_payments'), count(C3, 'monthly_bills'), count(C3, 'bill_payments')], before);
    assert.equal(live.details.filter((x: any) => x.canteenId === C3 && x.status === 'sent').length, 0); // Standard: "No new amount" -> skipped
    for (const x of live.details.filter((x: any) => x.canteenId === C1 && x.status === 'sent')) // Pooling: returns the existing bill
      assert.equal(cnt(`select count(*) from public.monthly_bills where canteen_id='${C1}' and bill_month=6 and employee_id='${x.employee}'`), 1);
  });

  await t.test('grants/RLS for the new objects: no TRUNCATE/TRIGGER/REFERENCES/writes for app roles; RPCs not for anon; private SD functions service-only', async () => {
    if (root(`select to_regclass('public.pooling_special_items') is not null`) !== 't') return;
    for (const tbl of ['public.pooling_special_items', 'public.canteen_guest_order_settings']) {
      for (const role of ['anon', 'authenticated']) for (const priv of ['TRUNCATE', 'TRIGGER', 'REFERENCES', 'INSERT', 'UPDATE', 'DELETE'])
        assert.equal(root(`select has_table_privilege('${role}','${tbl}','${priv}')`), 'f', `${role} ${priv} on ${tbl}`);
      assert.equal(root(`select has_table_privilege('authenticated','${tbl}','SELECT')`), 't');
      assert.equal(root(`select has_table_privilege('anon','${tbl}','SELECT')`), 'f');
      assert.equal(root(`select relrowsecurity from pg_class where oid='${tbl}'::regclass`), 't');
    }
    for (const fn of ['public.set_pooling_special_item(integer,text,integer)', 'public.set_guest_orders_enabled(boolean)']) {
      assert.equal(root(`select has_function_privilege('anon','${fn}','EXECUTE')`), 'f', fn);
      assert.equal(root(`select has_function_privilege('authenticated','${fn}','EXECUTE')`), 't', fn);
      assert.equal(root(`select prosecdef from pg_proc where oid='${fn}'::regprocedure`), 't');
    }
    for (const fn of ['effective_pooling_special(uuid,date,text)', 'guest_orders_enabled(uuid)', 'pooling_special_totals(uuid,integer,integer)', 'snapshot_pooling_special()', 'resnapshot_order_items()', 'guard_guest_orders()', 'guard_pooling_special_daily()'])
      for (const role of ['anon', 'authenticated']) assert.equal(root(`select has_function_privilege('${role}','gocanteen_private.${fn}','EXECUTE')`), 'f', `${role} ${fn}`);
    assert.equal(root(`select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='gocanteen_private' and p.proname in ('effective_pooling_special','snapshot_pooling_special','resnapshot_order_items','guard_guest_orders','guard_pooling_special_daily','pooling_special_totals','guest_orders_enabled') and (not p.prosecdef or not exists(select 1 from unnest(p.proconfig) c where c like 'search_path=%'))`), '0');
    assert.match(sql(URL!, { role: 'authenticated', sub: O1 }, `truncate public.pooling_special_items`).error.message, /permission denied/);
  });

  await t.test('guest orders On/Off: default On, payments admin only, OFF blocks new guest orders/items/increases in ALL modes; cancel/decrease/history OK', async () => {
    if (root(`select to_regclass('public.canteen_guest_order_settings') is not null`) !== 't') return;
    const asAdm = (sub: string, q: string) => root(`select set_config('request.jwt.claims','{"role":"authenticated","sub":"${sub}"}',false); ${q}`);
    for (const [C, O, M, tag] of [[C3, O3, D1, 'standard'], [C1, O1, A, 'pooling']] as const) {
      const id = (n: number) => `9${tag === 'standard' ? 'a' : 'b'}000000-0000-0000-0000-00000000000${n}`;
      assert.equal(root(`select gocanteen_private.guest_orders_enabled('${C}')`), 't'); // default On (no row)
      asAdm(O, `insert into public.orders(id,employee_id,ordered_for,status,order_source,canteen_id,guest_name) values('${id(1)}','${M}','2026-06-15','active','guest','${C}','G1'); insert into public.order_items(order_id,item_code,item_name,quantity,unit_price,item_source,canteen_id,guest_name) values('${id(1)}','meal','Meals',2,50,'guest','${C}','G1')`);
      assert.match((await as(M).rpc('set_guest_orders_enabled', { p_enabled: false })).error.message, /permission required/); // member cannot toggle
      assert.match(sql(URL!, { role: 'authenticated', sub: O }, `insert into public.canteen_guest_order_settings(canteen_id,guest_orders_enabled) values('${C}',false)`).error.message, /permission denied/); // no direct writes
      const off = await as(O).rpc('set_guest_orders_enabled', { p_enabled: false });
      assert.equal(off.error, null, off.error?.message);
      assert.equal((await as(M).from('canteen_guest_order_settings').select('guest_orders_enabled')).data[0].guest_orders_enabled, false); // members can read it (UI hides guest option)
      // legacy member app (real authenticated JWT + RLS path) sending a guest order is rejected by the server
      { const today = root(`select (now() at time zone 'Asia/Kolkata')::date`);
        const r = sql(URL!, { role: 'authenticated', sub: M }, `insert into public.orders(id,employee_id,ordered_for,status,order_source,canteen_id,guest_name) values('${id(5)}','${M}','${today}','active','guest','${C}','G')`);
        assert.ok(r.error, 'member guest insert must fail'); assert.equal(cnt(`select count(*) from public.orders where id='${id(5)}'`), 0);
        assert.match(r.error.message, /Guest orders are turned off/); }
      // legacy client still sending guest orders/items is rejected by the server
      assert.throws(() => asAdm(O, `insert into public.orders(id,employee_id,ordered_for,status,order_source,canteen_id) values('${id(2)}','${M}','2026-06-16','active','guest','${C}')`), /Guest orders are turned off/);
      assert.throws(() => asAdm(O, `insert into public.order_items(order_id,item_code,item_name,quantity,unit_price,item_source,canteen_id) values('${id(1)}','meal','Meals',1,50,'guest','${C}')`), /Guest orders are turned off/);
      assert.throws(() => asAdm(O, `update public.order_items set quantity=3 where order_id='${id(1)}'`), /Guest orders are turned off/);
      // regular orders unaffected; decrease + cancel allowed; history kept
      asAdm(O, `insert into public.orders(id,employee_id,ordered_for,status,order_source,canteen_id) values('${id(3)}','${M}','2026-06-16','active','admin','${C}'); insert into public.order_items(order_id,item_code,item_name,quantity,unit_price,item_source,canteen_id) values('${id(3)}','meal','Meals',1,50,'employee','${C}')`);
      assert.throws(() => asAdm(O, `update public.order_items set item_source='guest' where order_id='${id(3)}'`), /Guest orders are turned off/);
      asAdm(O, `update public.order_items set quantity=1 where order_id='${id(1)}'`);
      assert.equal(cnt(`select count(*) from public.order_items where order_id='${id(1)}' and item_source='guest'`), 1); // old guest item still billed
      asAdm(O, `update public.orders set status='cancelled', cancelled_at=now() where id='${id(1)}'`);
      assert.throws(() => asAdm(O, `update public.orders set status='active', cancelled_at=null where id='${id(1)}'`), /Guest orders are turned off/); // no reactivation while OFF
      // ON again accepts
      assert.equal((await as(O).rpc('set_guest_orders_enabled', { p_enabled: true })).error, null);
      asAdm(O, `insert into public.orders(id,employee_id,ordered_for,status,order_source,canteen_id) values('${id(4)}','${M}','2026-06-17','active','guest','${C}')`);
      assert.equal(cnt(`select count(*) from public.orders where id='${id(4)}'`), 1);
    }
    // other tenant unaffected by C1/C3 toggles
    assert.equal(root(`select gocanteen_private.guest_orders_enabled('${C2}')`), 't');
  });

  await t.test('members see only currently active polls; admins still see ended history and results', async () => {
    if (root(`select to_regclass('public.polls') is not null`) !== 't') return;
    const live = 'a1000000-0000-0000-0000-000000000001', ended = 'a1000000-0000-0000-0000-000000000002', soon = 'a1000000-0000-0000-0000-000000000003';
    root(`delete from public.polls where id in ('${live}','${ended}','${soon}')`);
    root(`insert into public.polls (id,canteen_id,title,options,questions,starts_at,ends_at,enabled) values
      ('${live}','${C1}','Live Poll','[]','[]', now() - interval '1 hour', now() + interval '2 hour', true),
      ('${ended}','${C1}','Ended Poll','[]','[]', now() - interval '3 hour', now() - interval '1 hour', true),
      ('${soon}','${C1}','Soon Poll','[]','[]', now() + interval '1 hour', now() + interval '3 hour', true)`);
    root(`insert into public.poll_responses (poll_id,canteen_id,member_id,member_name,answers) values
      ('${live}','${C1}','${A}','Asha','{}'), ('${ended}','${C1}','${A}','Asha','{}')`);
    const memberPolls = await as(A).from('polls').select('id,title');
    assert.equal(memberPolls.error, null, memberPolls.error?.message);
    assert.deepEqual((memberPolls.data || []).map((r: any) => r.title).sort(), ['Live Poll']);
    const adminPolls = await as(O1).from('polls').select('title');
    assert.equal(adminPolls.error, null, adminPolls.error?.message);
    assert.deepEqual((adminPolls.data || []).map((r: any) => r.title).sort(), ['Ended Poll', 'Live Poll', 'Soon Poll']);
    const memberRows = await as(A).from('poll_responses').select('poll_id');
    assert.equal(memberRows.error, null, memberRows.error?.message);
    assert.deepEqual((memberRows.data || []).map((r: any) => r.poll_id).sort(), [live]);
    const adminRows = await as(O1).from('poll_responses').select('poll_id');
    assert.equal(adminRows.error, null, adminRows.error?.message);
    assert.deepEqual((adminRows.data || []).map((r: any) => r.poll_id).sort(), [live, ended].sort());
    const blocked = sql(URL!, { role: 'authenticated', sub: A }, `insert into public.poll_responses(poll_id,canteen_id,member_id,member_name,answers) values('${ended}','${C1}','${A}','Asha','{"q":["x"]}')`);
    assert.ok(blocked.error, 'member must not write a response on an ended poll');
  });
});

