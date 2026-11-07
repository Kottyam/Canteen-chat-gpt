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
});

