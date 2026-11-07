// In-memory Supabase stand-in for UI flow tests (no network). Records every call.
export const supabaseEnabled = true;
export const IS_NATIVE = false;
export const SUPABASE_URL = 'http://fake.local';
export const SUPABASE_PUBLISHABLE_KEY = 'fake';
export const GOOGLE_REDIRECT_URL = 'http://fake.local';
export const normalizeMobileNumber = (v: string) => v;
export const internalEmailForLogin = (id: string) => `${id}@fake.local`;
export const db: Record<string, any[]> = {};
export const calls: any[] = [];
export const rpcHandlers: Record<string, (args: any) => { data?: any; error?: any }> = {};
export function reset() { for (const k of Object.keys(db)) delete db[k]; calls.length = 0; for (const k of Object.keys(rpcHandlers)) delete rpcHandlers[k]; }
const match = (r: any, ops: any[]) => ops.every(([op, a]) => op === 'eq' ? (!(a[0] in r) || r[a[0]] === a[1]) : op === 'in' ? a[1].includes(r[a[0]]) : op === 'not' ? !(a[1] === 'is' && a[2] === null && r[a[0]] == null) : true);
function run(table: string, ops: any[], single: boolean) {
  const kind = ops.find(([op]) => ['select', 'insert', 'update', 'delete', 'upsert'].includes(op))?.[0] || 'select';
  calls.push({ table, kind, ops });
  const rows = (db[table] ||= []);
  if (kind === 'insert' || kind === 'upsert') { const v = ops.find(([op]) => op === kind)[1][0]; rows.push(...(Array.isArray(v) ? v : [v])); return { data: null, error: null }; }
  if (kind === 'delete') { db[table] = rows.filter(r => !match(r, ops)); return { data: null, error: null }; }
  if (kind === 'update') { const v = ops.find(([op]) => op === 'update')[1][0]; rows.filter(r => match(r, ops)).forEach(r => Object.assign(r, v)); return { data: null, error: null }; }
  const out = rows.filter(r => match(r, ops));
  return { data: single ? (out[0] ?? null) : out, error: null };
}
function from(table: string) {
  const ops: any[] = [];
  const p: any = new Proxy({}, { get(_t, k: string) {
    if (k === 'then') return (res: any, rej: any) => Promise.resolve(run(table, ops, false)).then(res, rej);
    if (k === 'maybeSingle' || k === 'single') return () => Promise.resolve(run(table, ops, true));
    return (...args: any[]) => { ops.push([k, args]); return p; };
  } });
  return p;
}
export const supabase: any = {
  from,
  rpc: async (name: string, args: any) => { calls.push({ rpc: name, args }); return rpcHandlers[name] ? { data: null, error: null, ...rpcHandlers[name](args) } : { data: null, error: null }; },
  auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), getUser: async () => ({ data: { user: null } }) },
  channel: () => ({ on() { return this; }, subscribe() { return this; } }), removeChannel() {},
};
