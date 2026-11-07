// LOCAL TEST ONLY: a tiny supabase-js-like adapter that runs the exact query
// subset used by poolingInputs.ts / autoSend.ts against a throwaway Postgres via
// `psql`, as a chosen role + JWT claims, so real RLS / grants / triggers apply.
import { spawnSync } from 'node:child_process';

export interface Session { role: 'service_role' | 'authenticated' | 'anon'; sub?: string }
const lit = (v: any): string => {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'object') return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
  return `'${String(v).replace(/'/g, "''")}'`;
};
const CHILD_FK: Record<string, string> = { order_items: 'order_id', pooling_bill_lines: 'run_id' };

export function sql(url: string, s: Session, body: string): { rows: any; error: any } {
  const claims = JSON.stringify({ role: s.role, ...(s.sub ? { sub: s.sub } : {}) });
  const stmt = /^\s*select/i.test(body) ? `select '@@' || coalesce(((${body}))::jsonb::text, 'null')` : body;
  const script = `begin; set local role ${s.role}; select '' from set_config('request.jwt.claims', ${lit(claims)}, true); ${stmt}; commit;`;
  const r = spawnSync('psql', [url, '-X', '-q', '-tA', '-v', 'ON_ERROR_STOP=1', '-c', script], { encoding: 'utf8' });
  if (r.status !== 0) return { rows: null, error: { message: (r.stderr || '').replace(/^.*ERROR:\s*/s, '').split('\n')[0].trim() } };
  const line = r.stdout.split('\n').find(l => l.startsWith('@@'));
  return { rows: line ? JSON.parse(line.slice(2)) : null, error: null };
}

export function makeClient(url: string, s: Session) {
  const from = (table: string) => {
    let cols = '*'; const where: string[] = []; let single = false;
    const b: any = {
      select: (c: string) => { cols = c; return b; },
      eq: (c: string, v: any) => { where.push(`t.${c} = ${lit(v)}`); return b; },
      gte: (c: string, v: any) => { where.push(`t.${c} >= ${lit(v)}`); return b; },
      lte: (c: string, v: any) => { where.push(`t.${c} <= ${lit(v)}`); return b; },
      maybeSingle: () => { single = true; return run(); },
      then: (res: any, rej: any) => run().then(res, rej),
    };
    const run = async () => {
      const parts = cols === '*' ? ['t.*'] : cols.split(/,(?![^(]*\))/).map(c => {
        const m = c.trim().match(/^(\w+)\(([^)]*)\)$/);
        if (!m) return `t.${c.trim()}`;
        const [, child, cc] = m;
        const obj = cc.split(',').map(x => `${lit(x.trim())}, c.${x.trim()}`).join(',');
        return `(select coalesce(json_agg(json_build_object(${obj})),'[]'::json) from public.${child} c where c.${CHILD_FK[child]} = t.id) as ${child}`;
      });
      const q = `select coalesce(json_agg(x),'[]'::json) from (select ${parts.join(',')} from public.${table} t ${where.length ? 'where ' + where.join(' and ') : ''}) x`;
      const { rows, error } = sql(url, s, q);
      if (error) return { data: null, error };
      return { data: single ? (rows[0] ?? null) : rows, error: null };
    };
    return b;
  };
  const rpc = async (fn: string, args: Record<string, any> = {}) => {
    const a = Object.entries(args).map(([k, v]) => `${k} => ${lit(v)}`).join(', ');
    let { rows, error } = sql(url, s, `select to_jsonb(r) from public.${fn}(${a}) r`);
    if (error && /void/i.test(error.message)) ({ rows, error } = sql(url, s, `select json_build_object('r', null) from public.${fn}(${a})`));
    if (error) return { data: null, error };
    const v = rows; return { data: v && typeof v === 'object' && 'r' in v ? v.r : v, error: null };
  };
  return { from, rpc };
}
