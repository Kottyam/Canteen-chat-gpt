import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authorizeCron } from '../supabase/functions/_shared/cronAuth.ts';
const S = 'x'.repeat(40);
const db = (r: any) => async () => r;
test('missing header => unauthorized, no DB call', async () => {
  let called = false; const r = await authorizeCron({ header: null, dbAuthorize: async () => { called = true; return { ok: true, live: true }; } });
  assert.deepEqual(r, { ok: false, liveSend: false }); assert.equal(called, false);
});
test('env secret authoritative; short env secret rejected; wrong header rejected', async () => {
  assert.equal((await authorizeCron({ header: S, envSecret: S, dbAuthorize: db({ ok: false, live: false }) })).ok, true);
  assert.equal((await authorizeCron({ header: 'short', envSecret: 'short', dbAuthorize: db({ ok: true, live: true }) })).ok, false);
  assert.equal((await authorizeCron({ header: S + 'y', envSecret: S, dbAuthorize: db({ ok: true, live: true }) })).ok, false);
});
test('vault path: default dry run; live only when DB switch on; dryRun body overrides', async () => {
  assert.deepEqual(await authorizeCron({ header: S, dbAuthorize: db({ ok: true, live: false }) }), { ok: true, liveSend: false });
  assert.deepEqual(await authorizeCron({ header: S, dbAuthorize: db({ ok: true, live: true }) }), { ok: true, liveSend: true });
  assert.deepEqual(await authorizeCron({ header: S, dryRunRequested: true, dbAuthorize: db({ ok: true, live: true }) }), { ok: true, liveSend: false });
});
test('DB error or not-ok => unauthorized (fail closed)', async () => {
  assert.equal((await authorizeCron({ header: S, dbAuthorize: async () => { throw new Error('x'); } })).ok, false);
  assert.deepEqual(await authorizeCron({ header: S, dbAuthorize: db({ ok: false, live: true }) }), { ok: false, liveSend: false });
});
test('env AUTO_BILL_SEND_LIVE cannot override DB OFF; env-secret path is always dry run; env false forces dry', async () => {
  assert.deepEqual(await authorizeCron({ header: S, envLive: 'true', dbAuthorize: db({ ok: true, live: false }) }), { ok: true, liveSend: false });
  assert.deepEqual(await authorizeCron({ header: S, envSecret: S, envLive: 'true', dbAuthorize: db({ ok: true, live: true }) }), { ok: true, liveSend: false });
  assert.deepEqual(await authorizeCron({ header: S, envLive: 'false', dbAuthorize: db({ ok: true, live: true }) }), { ok: true, liveSend: false });
});
