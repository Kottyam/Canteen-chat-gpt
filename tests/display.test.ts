// Static-markup display tests for pooling price hiding (NOT a visual/screenshot test).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { pathToFileURL } from 'node:url';

const out = new URL('../node_modules/.cache/gc-display/entry.mjs', import.meta.url).pathname; // inside repo so bare imports resolve
buildSync({ entryPoints: [new URL('./display.entry.tsx', import.meta.url).pathname], bundle: true, format: 'esm', platform: 'node', outfile: out, jsx: 'automatic', define: { 'import.meta.env': '{}' }, logLevel: 'silent', external: ['react', 'react-dom', 'react-dom/server', '@capacitor/*', '@supabase/supabase-js', 'jspdf', 'xlsx'] });
// minimal browser globals for module-level code (local-storage mode, no network)
const store = new Map<string, string>();
Object.assign(globalThis as any, { window: globalThis, localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, String(v)), removeItem: (k: string) => store.delete(k) }, addEventListener: () => {}, removeEventListener: () => {}, location: { href: 'http://localhost/', search: '', pathname: '/', hostname: 'localhost' }, document: { addEventListener: () => {}, removeEventListener: () => {}, visibilityState: 'visible' } });
const { render } = await import(pathToFileURL(out).href);

test('standard mode (default) still shows item prices and totals', () => {
  const s = render('standard');
  assert.match(s.card, /₹80\.00/); // 2 x 40 member food
  assert.match(s.card, /Member Total/);
  assert.match(s.menu, /Menu &amp; Prices/);
});

test('pooling mode hides food prices/totals but keeps items, quantities and Admin Added amounts', () => {
  const p = render('pooling');
  assert.match(p.card, /Lunch: Meals/); assert.match(p.card, /× 2/);
  assert.doesNotMatch(p.card, /₹80\.00|₹8\.00|Member Total|Member Food Total|Guest Food Total/);
  assert.doesNotMatch(p.card, /₹0\.00/); // no misleading zero/free price
  assert.match(p.card, /₹15\.00/); // admin-added stays visible (real amount due)
  assert.match(p.menu, />Menu</); assert.doesNotMatch(p.menu, /Menu &amp; Prices/);
  assert.match(p.menu, /without prices/);
});
