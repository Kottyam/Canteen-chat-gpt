// Interactive UI flow tests: real components rendered in happy-dom, with fake auth/data/supabase (no network).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { Window } from 'happy-dom';

const here = path.dirname(new URL(import.meta.url).pathname);
const out = path.join(here, '../node_modules/.cache/gc-ui/entry.mjs');
const fakes: Record<string, string> = { supabase: 'fakeSupabase.ts', 'context/AuthContext': 'fakeAuth.tsx', 'context/DataContext': 'fakeData.tsx' };
await build({
  entryPoints: [path.join(here, 'ui/entry.tsx')], bundle: true, format: 'esm', platform: 'node', outfile: out, jsx: 'automatic',
  define: { 'import.meta.env': '{}' }, logLevel: 'silent', external: ['react', 'react-dom', 'react-dom/*', '@capacitor/*', '@supabase/supabase-js', 'jspdf', 'xlsx'],
  plugins: [{ name: 'fakes', setup(b) {
    b.onResolve({ filter: /^\.\.?\// }, a => {
      if (a.importer.includes(`${path.sep}tests${path.sep}ui${path.sep}`)) return undefined;
      const abs = path.resolve(a.resolveDir, a.path); const rel = path.relative(path.resolve(here, '..'), abs);
      return fakes[rel] ? { path: path.join(here, 'ui', fakes[rel]) } : undefined;
    });
  } }],
});
const win = new Window({ url: 'http://localhost/' });
for (const k of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'Node', 'Event', 'MouseEvent', 'localStorage', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
  try { (globalThis as any)[k] = (win as any)[k] ?? (k === 'window' ? win : undefined); } catch { /* read-only global */ }
}
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
(win as any).confirm = () => true;
const M = await import(pathToFileURL(out).href);
const { fakeDb, auth, data, act, createRoot, createElement } = M;

const tick = async (n = 6) => { for (let i = 0; i < n; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)); }); };
async function mount(el: any) { const host = document.createElement('div'); document.body.appendChild(host); const root = createRoot(host); await act(async () => root.render(el)); await tick(); return { host, root }; }
const byText = (host: any, tag: string, re: RegExp) => [...host.querySelectorAll(tag)].find((e: any) => re.test(e.textContent || ''));
async function click(el: any) { assert.ok(el, 'element to click exists'); await act(async () => { el.click(); }); await tick(); }
async function type(el: any, v: string) {
  assert.ok(el, 'input exists');
  const set = Object.getOwnPropertyDescriptor((win as any).HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => { set.call(el, v); el.dispatchEvent(new (win as any).Event('input', { bubbles: true })); });
  await tick(1);
}
export { mount, byText, click, type, tick, fakeDb, auth, data, M, createElement };

const pooling = () => { fakeDb.db.canteen_billing_settings = [{ billing_model: 'pooling', mess_cut_min_days: 6, bill_send_mode: 'manual' }]; M.publishBillingSettings({ billingModel: 'pooling', messCutMinDays: 6, billSendMode: 'manual' }); };
const standard = () => { fakeDb.db.canteen_billing_settings = []; M.publishBillingSettings({ billingModel: 'standard', messCutMinDays: 6, billSendMode: 'manual' }); };
const rpcs = (name: string) => fakeDb.calls.filter((c: any) => c.rpc === name).map((c: any) => c.args);
const weeklyInserts = () => fakeDb.calls.filter((c: any) => c.table === 'weekly_menu' && c.kind === 'insert').flatMap((c: any) => c.ops.find((o: any) => o[0] === 'insert')[1][0]);
async function openMenu(weekday = 1) { const r = await mount(createElement(M.MenuManagement, { initialWeekday: weekday })); return r.host; }
const nameInput = (h: any) => h.querySelector('input[placeholder="Item name"]');
const addBtn = (h: any) => byText(h, 'button', /\+ Add Menu Item/);
const saveBtn = (h: any) => byText(h, 'button', /^Save$/);
const addPriceBox = (h: any) => byText(h, 'label', /Add price\?/)?.querySelector('input');

test('menu ADD flow (Pooling, payments admin): "Add price?" while adding -> one save stores item + price; ordinary item gets no price', async () => {
  fakeDb.reset(); auth.perms = ['payments']; pooling();
  const h = await openMenu(1);
  assert.equal(h.querySelector('input[aria-label="Item price"]'), null); // price field only after ticking
  await type(nameInput(h), 'Fish Fry');
  await click(addPriceBox(h));
  await type(h.querySelector('input[aria-label="Item price"]'), '25.50');
  await click(addBtn(h));
  assert.match(h.textContent, /Fish Fry/); assert.match(h.textContent, /₹25\.50 extra \(unsaved\)/);
  assert.equal(addPriceBox(h).checked, false); // add form reset
  await type(nameInput(h), 'Meals'); await click(addBtn(h)); // ordinary item, no price
  await click(saveBtn(h));
  assert.deepEqual(weeklyInserts().map((r: any) => r.item_code).sort(), ['fish_fry', 'meals']);
  assert.ok(weeklyInserts().every((r: any) => Number(r.unit_price) === 0)); // Pooling unit_price stays 0 (pool items carry no price)
  assert.deepEqual(rpcs('set_pooling_special_item'), [{ p_weekday: 1, p_item_code: 'fish_fry', p_price_paise: 2550 }]);
});

test('menu ADD flow: invalid price blocks the add with a message; nothing saved', async () => {
  fakeDb.reset(); auth.perms = ['payments']; pooling();
  const h = await openMenu(2);
  await type(nameInput(h), 'Egg'); await click(addPriceBox(h)); await type(h.querySelector('input[aria-label="Item price"]'), 'abc');
  await click(addBtn(h));
  assert.match(h.textContent, /Enter a valid price/); assert.match(h.textContent, /0 menu items/); assert.match(h.textContent, /No menu added yet/);
  assert.equal(rpcs('set_pooling_special_item').length, 0);
});

test('menu admin WITHOUT payments permission: no price controls, short note, ordinary add+save still works', async () => {
  fakeDb.reset(); auth.perms = ['menu']; pooling();
  fakeDb.db.pooling_special_items = [{ weekday: 3, item_code: 'chicken', price_paise: 6000 }];
  fakeDb.db.weekly_menu = [{ weekday: 3, item_code: 'chicken', item_name: 'Chicken', unit_price: 0, active: true }];
  await M.refreshCurrentSpecials();
  const h = await openMenu(3);
  assert.equal(addPriceBox(h), undefined);
  assert.match(h.textContent, /Item prices can be added only by admins with payments permission/);
  assert.match(h.textContent, /₹60\.00 extra/); // existing price visible read-only
  await click(byText(h, 'button', /✎/));
  assert.equal(addPriceBox(h), undefined); // not in edit either
  await click(byText(h, 'button', /Save Edit/));
  await type(nameInput(h), 'Rice'); await click(addBtn(h)); await click(saveBtn(h));
  assert.deepEqual(weeklyInserts().map((r: any) => r.item_code).sort(), ['chicken', 'rice']);
  assert.equal(rpcs('set_pooling_special_item').length, 0); // never touches prices (server would refuse anyway)
});

test('menu EDIT flow: change and remove price of an existing item; deleting the item clears its price', async () => {
  fakeDb.reset(); auth.perms = ['payments']; pooling();
  fakeDb.db.pooling_special_items = [{ weekday: 4, item_code: 'chicken', price_paise: 6000 }, { weekday: 4, item_code: 'fish', price_paise: 4000 }];
  fakeDb.db.weekly_menu = [{ weekday: 4, item_code: 'chicken', item_name: 'Chicken', unit_price: 0, active: true }, { weekday: 4, item_code: 'fish', item_name: 'Fish', unit_price: 0, active: true }, { weekday: 4, item_code: 'meals', item_name: 'Meals', unit_price: 0, active: true }];
  await M.refreshCurrentSpecials();
  const h = await openMenu(4);
  const edit = (name: string) => h.querySelector(`button[aria-label="Edit ${name}"]`);
  await click(edit('Chicken'));
  assert.equal(addPriceBox(h).checked, true);
  await type(h.querySelector('input[aria-label="Item price"]'), '65'); await click(byText(h, 'button', /Save Edit/));
  await click(edit('Meals')); await click(addPriceBox(h)); await type(h.querySelector('input[aria-label="Item price"]'), '0'); await click(byText(h, 'button', /Save Edit/));
  await click(h.querySelector('button[aria-label="Delete Fish"]'));
  await click(saveBtn(h));
  const got = rpcs('set_pooling_special_item').sort((a: any, b: any) => a.p_item_code.localeCompare(b.p_item_code));
  assert.deepEqual(got, [{ p_weekday: 4, p_item_code: 'chicken', p_price_paise: 6500 }, { p_weekday: 4, p_item_code: 'fish', p_price_paise: null }, { p_weekday: 4, p_item_code: 'meals', p_price_paise: 0 }]);
});

test('Standard mode menu: unchanged price field, no "Add price?"', async () => {
  fakeDb.reset(); auth.perms = ['payments']; standard();
  const h = await openMenu(5);
  assert.equal(addPriceBox(h), undefined);
  assert.ok(h.querySelector('input[placeholder="Price"]'));
});

test('guest orders OFF hides the Guest Order tab; ON shows it; payments admin toggle calls the RPC, others are disabled', async () => {
  fakeDb.reset();
  fakeDb.db.canteen_guest_order_settings = [{ guest_orders_enabled: false }];
  let mode = 'me';
  const tabs = await mount(createElement(M.OrderModeTabs, { mode: 'me', onMode: (m: string) => { mode = m; } }));
  assert.equal(byText(tabs.host, 'button', /Guest Order/), undefined);
  fakeDb.db.canteen_guest_order_settings = [{ guest_orders_enabled: true }]; M.publishGuestOrdersEnabled(true); await tick();
  await click(byText(tabs.host, 'button', /Guest Order/)); assert.equal(mode, 'guest');
  auth.perms = []; fakeDb.calls.length = 0;
  const t1 = await mount(createElement(M.GuestOrdersToggle));
  assert.ok(byText(t1.host, 'button', /^Off$/).disabled); assert.match(t1.host.textContent, /payments permission/);
  auth.perms = ['payments']; fakeDb.rpcHandlers.set_guest_orders_enabled = (a: any) => ({ data: { guest_orders_enabled: a.p_enabled } });
  const t2 = await mount(createElement(M.GuestOrdersToggle));
  await click(byText(t2.host, 'button', /^Off$/));
  assert.deepEqual(rpcs('set_guest_orders_enabled'), [{ p_enabled: false }]);
  assert.equal(byText(tabs.host, 'button', /Guest Order/), undefined); // member tabs react to the new setting
});

const istDate = (offset: number) => new Date(Date.now() + 5.5 * 3600e3 + offset * 86400e3).toISOString().slice(0, 10);
const dow = (d: string) => new Date(d + 'T12:00:00Z').getUTCDay();

test('history/calendar shows the server-RECORDED special price x qty, not the current menu; old pool orders never get a price', async () => {
  fakeDb.reset(); auth.perms = []; pooling();
  const d1 = istDate(-3), d2 = istDate(-4);
  fakeDb.db.profiles = [{ id: 'p1' }];
  fakeDb.db.orders = [
    { id: 'o1', employee_id: 'p1', ordered_for: d1, status: 'active', created_at: d1 + 'T04:00:00Z', employee_contribution_percentage: 100, order_items: [{ item_code: 'fish', item_name: 'Fish Fry', quantity: 2, unit_price: 0, item_source: 'employee' }, { item_code: 'fish', item_name: 'Fish Fry', quantity: 1, unit_price: 0, item_source: 'guest', guest_name: 'G' }] },
    { id: 'o2', employee_id: 'p1', ordered_for: d2, status: 'active', created_at: d2 + 'T04:00:00Z', employee_contribution_percentage: 100, order_items: [{ item_code: 'meals', item_name: 'Meals', quantity: 1, unit_price: 0, item_source: 'employee' }] },
  ];
  // server snapshots: fish was 25.50 when ordered (member + guest); meals was a normal pool item
  fakeDb.db.order_items = [{ order_id: 'o1', item_code: 'fish', item_source: 'employee', pooling_special: true, pooling_special_unit_paise: 2550 }, { order_id: 'o1', item_code: 'fish', item_source: 'guest', pooling_special: true, pooling_special_unit_paise: 2550 }, { order_id: 'o2', item_code: 'meals', item_source: 'employee', pooling_special: false, pooling_special_unit_paise: null }];
  // CURRENT menu: fish now 40.00 and meals flagged later at 30.00 -> must not leak into history
  fakeDb.db.pooling_special_items = [{ weekday: dow(d1), item_code: 'fish', price_paise: 4000 }, { weekday: dow(d2), item_code: 'meals', price_paise: 3000 }];
  await M.refreshCurrentSpecials();
  const { host } = await mount(createElement(M.OrderCalendar));
  await click(byText(host, 'button', new RegExp(d1)));
  assert.match(host.textContent, /Fish Fry × 2₹51\.00 extra/); // 2 x recorded 25.50
  assert.match(host.textContent, /Fish Fry × 1₹25\.50 extra/); // guest, recorded
  assert.doesNotMatch(host.textContent, /₹80\.00|₹40\.00/); // current menu price never used for history
  await click(byText(host, 'button', new RegExp(d2)));
  assert.match(host.textContent, /Meals × 1/);
  assert.doesNotMatch(host.textContent, /₹30\.00|₹0\.00/); // old normal pool order: no retro price, no ₹0
});

test('Standard mode history keeps the normal ₹ price lines (unchanged)', async () => {
  fakeDb.reset(); standard();
  const d1 = istDate(-2);
  fakeDb.db.profiles = [{ id: 'p1' }];
  fakeDb.db.orders = [{ id: 'o9', employee_id: 'p1', ordered_for: d1, status: 'active', created_at: d1 + 'T04:00:00Z', employee_contribution_percentage: 100, order_items: [{ item_code: 'meals', item_name: 'Meals', quantity: 2, unit_price: 50, item_source: 'employee' }] }];
  const { host } = await mount(createElement(M.OrderCalendar));
  await click(byText(host, 'button', new RegExp(d1)));
  assert.match(host.textContent, /Meals × 2₹100\.00/); assert.doesNotMatch(host.textContent, /extra/);
});

test('client menu precedence mirrors the server: explicit daily TRUE/FALSE wins, NULL/no row inherits weekly; price parsing', () => {
  const d = '2026-11-09'; const w = dow(d);
  const s = { weekly: { [w]: { fish: 2550, egg: 1000 } }, daily: { [d]: { fish: null, meals: 3000 } } };
  assert.deepEqual(M.specialsForDate(s, d), { egg: 1000, meals: 3000 }); // fish explicitly NOT special that day
  assert.deepEqual(M.specialsForDate(s, '2026-11-16'), { fish: 2550, egg: 1000 }); // other date inherits weekly
  assert.equal(M.parsePriceToPaise('25.505'), 2551); assert.equal(M.parsePriceToPaise('0'), 0);
  for (const bad of ['', ' ', '-1', 'abc']) assert.throws(() => M.parsePriceToPaise(bad), /valid price/);
});
