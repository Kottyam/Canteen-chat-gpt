// Interactive UI flow tests: real components rendered in happy-dom, with fake auth/data/supabase (no network).
import { test, afterEach } from 'node:test';
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
(win as any).confirm = () => true; const alerts: string[] = []; (globalThis as any).alert = (win as any).alert = (m: string) => { alerts.push(String(m)); }; (globalThis as any).confirm = () => true;
const M = await import(pathToFileURL(out).href);
const { fakeDb, auth, data, act, createRoot, createElement } = M;

const tick = async (n = 6) => { for (let i = 0; i < n; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)); }); };
const mounted: any[] = [];
afterEach(async () => { for (const r of mounted.splice(0)) await act(async () => r.unmount()); document.body.innerHTML = ''; auth.user = { id: 'M001', name: 'Member', role: 'employee' }; auth.perms = []; auth.loading = false; auth.googleOAuthInProgress = false; data.users = []; data.orders = []; M.resetAppPresentedForTests(); });
async function mount(el: any) { const host = document.createElement('div'); document.body.appendChild(host); const root = createRoot(host); mounted.push(root); await act(async () => root.render(el)); await tick(); return { host, root }; }
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

// Pooling monthly bills: real component + real services + real engine over the in-memory fake database.
function seedPoolingMonth(opts: { orders: boolean; negative?: boolean }) {
  const { year, month } = (() => { const d = new Date(); const m = d.getMonth(); return m === 0 ? { year: d.getFullYear() - 1, month: 12 } : { year: d.getFullYear(), month: m }; })();
  const day = (n: number) => `${year}-${String(month).padStart(2, '0')}-${String(n).padStart(2, '0')}`;
  fakeDb.rpcHandlers.current_canteen_id = () => ({ data: 'c1' });
  fakeDb.db.profiles = [{ id: 'mA', full_name: 'Anu', role: 'employee', status: 'active', created_at: '2026-01-01T00:00:00Z' }, { id: 'mB', full_name: 'Biju', role: 'employee', status: 'active', created_at: '2026-01-01T00:00:00Z' }];
  fakeDb.db.pooling_member_periods = [{ employee_id: 'mA', joined_on: '2026-01-01', left_on: null }, { employee_id: 'mB', joined_on: '2026-01-01', left_on: null }];
  fakeDb.db.expenses = [{ id: 'e1', expense_date: day(10), amount: 3000 }, ];
  fakeDb.db.orders = opts.orders ? [...Array.from({ length: 20 }, (_, i) => ({ id: `a${i}`, employee_id: 'mA', ordered_for: day(i + 1), status: 'active', order_items: [{ item_source: 'employee', quantity: 1 }] })), { id: 'b1', employee_id: 'mB', ordered_for: day(10), status: 'active', order_items: [{ item_source: 'employee', quantity: 1 }] }] : [];
  if (opts.negative) fakeDb.db.orders.push({ id: 'z1', employee_id: 'mZ', ordered_for: day(5), status: 'active', order_items: [{ item_source: 'employee', quantity: 1, pooling_special: true, pooling_special_unit_paise: 2500 }] });
  fakeDb.db.holiday_dates = []; fakeDb.db.holiday_settings = []; fakeDb.db.employee_adjustments = [];
  fakeDb.db.pooling_bill_runs = [{ id: 'run1', status: 'draft', pooling_bill_lines: [] }];
}
const NOISE = [/No orders on/i, /mark them as holidays/i, /holiday/i, /Operating days/i, /Shared daily/i, /Shared monthly/i, /non-operating/i, /Expenses from the Expenses section/i, /Sending:/i, /live recalculation/i, /reference only/i, /without a membership record were ignored/i, /\*/];

for (const mode of ['manual', 'automatic'] as const) test(`Pooling monthly bills (${mode}): no date lists / instruction notes; counts + totals shown; Publish Bills usable`, async () => {
  fakeDb.reset(); seedPoolingMonth({ orders: true });
  M.publishBillingSettings({ billingModel: 'pooling', messCutMinDays: 6, billSendMode: mode });
  fakeDb.db.canteen_billing_settings = [{ billing_model: 'pooling', mess_cut_min_days: 6, bill_send_mode: mode }];
  const { host } = await mount(createElement(M.PoolingMonthlyBills));
  const text = host.textContent;
  assert.match(text, /Monthly Bills — Pooling/); assert.match(text, /Total expenses₹3000\.00/);
  assert.match(text, /Anu/); assert.match(text, /Biju/); assert.match(text, /No-order/); assert.match(text, /Mess cut/); assert.match(text, /Charged days/);
  for (const re of NOISE) assert.doesNotMatch(text, re, `noise ${re} must not be shown`);
  assert.equal(host.querySelector('[role="alert"]'), null); // nothing actionable here
  const publish = byText(host, 'button', /^Publish Bills$/);
  assert.equal(publish.disabled, false, 'manual publish stays usable in Automatic mode too');
  await click(publish);
  assert.deepEqual(rpcs('publish_pooling_bill').map((a: any) => a.p_employee_id).sort(), ['mA', 'mB']);
});

test('Pooling monthly bills: real money problems stay visible (unallocated + special charge that cannot be billed), concise', async () => {
  fakeDb.reset(); seedPoolingMonth({ orders: false, negative: true });
  M.publishBillingSettings({ billingModel: 'pooling', messCutMinDays: 6, billSendMode: 'automatic' });
  const { host } = await mount(createElement(M.PoolingMonthlyBills));
  assert.match(host.textContent, /Unallocated \(needs review\)₹3000\.00/);
  assert.match(host.querySelector('[role="alert"]')?.textContent || '', /Special item charges for 1 member without a membership record this month cannot be billed/);
  for (const re of [/No orders on/i, /mark them as holidays/i, /Operating days/i, /were ignored/i]) assert.doesNotMatch(host.textContent, re);
});

test('Pooling monthly bills: a published member shows the billed (saved) amount', async () => {
  fakeDb.reset(); seedPoolingMonth({ orders: true });
  fakeDb.db.pooling_bill_runs = [{ id: 'run1', status: 'published', pooling_bill_lines: [{ employee_id: 'mA', total_paise: 123456, monthly_bill_id: 'b1' }] }];
  M.publishBillingSettings({ billingModel: 'pooling', messCutMinDays: 6, billSendMode: 'automatic' });
  const { host } = await mount(createElement(M.PoolingMonthlyBills));
  assert.match(host.textContent, /₹1234\.56Published/);
});

for (const mode of ['manual', 'automatic'] as const) test(`Standard monthly report (${mode}): "Publish Eligible Bills" is usable for eligible completed-month bills`, async () => {
  fakeDb.reset(); auth.perms = ['payments', 'bills']; auth.user = { id: 'O1', name: 'Owner', role: 'admin' };
  M.publishBillingSettings({ billingModel: 'standard', messCutMinDays: 6, billSendMode: mode });
  fakeDb.db.canteen_billing_settings = [{ billing_model: 'standard', mess_cut_min_days: 6, bill_send_mode: mode }];
  const d = new Date(); const m = d.getMonth(); const y = m === 0 ? d.getFullYear() - 1 : d.getFullYear(); const mm = String(m === 0 ? 12 : m).padStart(2, '0');
  data.users = [{ id: 'E1', identityId: 'p1', name: 'Anu', role: 'employee', status: 'active' }];
  data.orders = [{ id: 'o1', employeeId: 'E1', memberIdentityId: 'p1', date: `${y}-${mm}-05`, items: { meals: true }, itemQuantities: { meals: 2 }, itemPrices: { meals: 50 }, itemNames: { meals: 'Meals' }, status: 'active' }];
  fakeDb.db.profiles = [{ id: 'p1', employee_code: 'E1', full_name: 'Anu', status: 'active' }];
  fakeDb.rpcHandlers.gocanteen_business_timestamp = () => ({ data: new Date().toISOString() });
  fakeDb.rpcHandlers.get_admin_bill_publish_states = () => ({ data: [{ employee_id: 'p1', current_total: 100, requested_total: 0, new_amount: 100, can_publish: true }] });
  const { host } = await mount(createElement(M.MonthlyReport)); await tick(10);
  const btn = byText(host, 'button', /^Publish Eligible Bills$/);
  assert.ok(btn, 'button shown'); assert.equal(btn.disabled, false, `usable in ${mode} mode`);
  await click(btn); await tick(10);
  assert.ok(fakeDb.calls.some((c: any) => c.rpc === 'publish_employee_bill'), 'existing Standard publish RPC is called');
});

// ---- Running current month (admin-only, read-only) on the same Pooling Monthly Bills page ----
const wait = (ms: number) => act(async () => { await new Promise(r => setTimeout(r, ms)); });
function seedCurrentMonth() {
  const asOf = M.istBusinessDate(new Date()); const [y, m, dd] = asOf.split('-').map(Number);
  const cd = (n: number) => `${y}-${String(m).padStart(2, '0')}-${String(n).padStart(2, '0')}`;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  for (let n = 1; n <= dd; n++) for (const id of ['mA', 'mB']) fakeDb.db.orders.push({ id: `c${id}${n}`, employee_id: id, ordered_for: cd(n), status: 'active', order_items: [{ item_source: 'employee', quantity: 1, ...(id === 'mA' && n === 1 ? { pooling_special: true, pooling_special_unit_paise: 2500 } : {}) }] });
  fakeDb.db.expenses.push({ id: 'c1', expense_date: cd(1), amount: 1000, description: 'Rice' });
  fakeDb.db.employee_adjustments.push({ employee_id: 'mA', amount: 50, adjustment_date: cd(1) });
  if (dd < last) { // future rows must never count
    fakeDb.db.expenses.push({ id: 'cF', expense_date: cd(dd + 1), amount: 5000, description: 'Future' });
    fakeDb.db.orders.push({ id: 'cFo', employee_id: 'mA', ordered_for: cd(dd + 1), status: 'active', order_items: [{ item_source: 'employee', quantity: 1, pooling_special: true, pooling_special_unit_paise: 9900 }] });
    fakeDb.db.employee_adjustments.push({ employee_id: 'mB', amount: 70, adjustment_date: cd(dd + 1) });
  }
  return { asOf, cd, dd };
}
const asAdmin = () => { auth.user = { id: 'O1', name: 'Owner', role: 'admin', canteenName: 'Test Canteen' }; auth.perms = ['monthly_reports', 'expenses']; };
const draftSection = (h: any) => h.querySelector('section[aria-label="Current month"]');
const WRITE_RPCS = ['save_pooling_bill_run', 'publish_pooling_bill', 'publish_employee_bill', 'set_pooling_special_item', 'set_billing_settings'];
const noWrites = () => { assert.deepEqual(fakeDb.calls.filter((c: any) => c.kind && c.kind !== 'select').map((c: any) => c.table), []); assert.deepEqual(fakeDb.calls.filter((c: any) => WRITE_RPCS.includes(c.rpc)), []); };

for (const mode of ['manual', 'automatic'] as const) test(`Pooling current month (${mode}): admin sees month + Draft as of, members amounts to date, no Save/Publish, no writes; previous publish unchanged`, async () => {
  fakeDb.reset(); seedPoolingMonth({ orders: true }); const { asOf } = seedCurrentMonth(); asAdmin();
  M.publishBillingSettings({ billingModel: 'pooling', messCutMinDays: 6, billSendMode: mode });
  const { host } = await mount(createElement(M.PoolingMonthlyBills)); await tick(10);
  const s = draftSection(host); assert.ok(s, 'current month section on the same page');
  const t = s.textContent;
  assert.match(t, new RegExp(`Draft as of ${M.displayBusinessDate(asOf)}`));
  assert.match(t, /Expenses so far₹1000\.00/); // future expense excluded
  const row = (id: string) => s.querySelector(`[data-draft-member="${id}"]`).textContent;
  assert.match(row('mA'), /Anu/); assert.match(row('mA'), /Pool ₹500\.00/); assert.match(row('mA'), /Special ₹25\.00/); assert.match(row('mA'), /Admin added ₹50\.00/); assert.match(row('mA'), /₹575\.00$/);
  assert.match(row('mB'), /Biju/); assert.match(row('mB'), /₹500\.00$/); assert.doesNotMatch(row('mB'), /Admin added/);
  assert.deepEqual([...s.querySelectorAll('button')].map((b: any) => b.textContent), ['Download PDF']);
  for (const re of NOISE) assert.doesNotMatch(t, re);
  noWrites();
  // previous completed month: unchanged numbers and buttons, publishes the previous run only
  assert.match(host.textContent, /Total expenses₹3000\.00/);
  assert.ok(byText(host, 'button', /^Save Calculation$/)); const publish = byText(host, 'button', /^Publish Bills$/); assert.equal(publish.disabled, false);
  await click(publish);
  assert.deepEqual(rpcs('publish_pooling_bill').map((a: any) => a.p_run_id), ['run1', 'run1']);
});

test('Pooling current month: ordinary member never sees the draft (published bills only)', async () => {
  fakeDb.reset(); seedPoolingMonth({ orders: true }); seedCurrentMonth(); pooling();
  auth.user = { id: 'mA', name: 'Anu', role: 'employee' };
  const { host } = await mount(createElement(M.PoolingMonthlyBills)); await tick(10);
  assert.equal(draftSection(host), null); assert.doesNotMatch(host.textContent, /Draft as of/);
});

test('Pooling current month: Expenses add / edit / delete refresh the draft immediately (coalesced)', async () => {
  fakeDb.reset(); seedPoolingMonth({ orders: true }); const { cd } = seedCurrentMonth(); asAdmin(); pooling();
  const { host } = await mount(createElement(M.PoolingMonthlyBills)); await tick(10);
  const exp = await mount(createElement(M.Expenses));
  const total = () => draftSection(host).textContent.match(/Expenses so far(₹[\d.]+)/)[1];
  assert.equal(total(), '₹1000.00');
  let events = 0; const on = () => { events++; }; window.addEventListener(M.POOLING_INPUTS_CHANGED, on);
  await type(exp.host.querySelector('input[type="date"]'), cd(1)); await type(exp.host.querySelector('input[placeholder="Amount"]'), '200');
  await click(byText(exp.host, 'button', /^Add Expense$/)); await wait(350); await tick();
  assert.equal(total(), '₹1200.00'); assert.equal(events, 1);
  const added = fakeDb.db.expenses.find((e: any) => Number(e.amount) === 200); added.id = 'new1';
  await click(byText(exp.host, 'button', /\d{4}/)); // open the month
  const editOf = () => [...exp.host.querySelectorAll('button')].filter((b: any) => b.textContent === 'Edit');
  await click(editOf()[0]); await type(exp.host.querySelector('input[placeholder="Amount"]'), '300');
  const before = fakeDb.db.expenses.map((e: any) => Number(e.amount)).reduce((a: number, b: number) => a + b, 0);
  await click(byText(exp.host, 'button', /^Update Expense$/)); await wait(350); await tick();
  assert.equal(events, 2); const after = fakeDb.db.expenses.map((e: any) => Number(e.amount)).reduce((a: number, b: number) => a + b, 0); assert.notEqual(after, before);
  const shown = () => Number(total().slice(1));
  const expected = () => fakeDb.db.expenses.filter((e: any) => e.expense_date.startsWith(cd(1).slice(0, 8)) && e.expense_date <= M.istBusinessDate(new Date())).reduce((a: number, e: any) => a + Number(e.amount), 0);
  assert.equal(shown(), expected());
  await click(byText(exp.host, 'button', /\d{4}/));
  const del = [...exp.host.querySelectorAll('button')].filter((b: any) => b.textContent === 'Delete');
  await click(del[0]); await wait(350); await tick();
  assert.equal(events, 3); assert.equal(shown(), expected());
  window.removeEventListener(M.POOLING_INPUTS_CHANGED, on);
  // a burst of events = one recalculation
  const n0 = fakeDb.calls.filter((c: any) => c.rpc === 'current_canteen_id').length;
  for (let i = 0; i < 5; i++) window.dispatchEvent(new (window as any).Event(M.POOLING_INPUTS_CHANGED));
  await wait(350); await tick();
  assert.equal(fakeDb.calls.filter((c: any) => c.rpc === 'current_canteen_id').length - n0, 1);
});

test('Pooling current month: the latest data wins and never touches the previous-month run / state', async () => {
  fakeDb.reset(); seedPoolingMonth({ orders: true }); const { cd } = seedCurrentMonth(); asAdmin(); pooling();
  fakeDb.db.pooling_bill_runs = [{ id: 'run1', status: 'published', pooling_bill_lines: [{ employee_id: 'mA', total_paise: 123456, monthly_bill_id: 'b1' }] }];
  const { host } = await mount(createElement(M.PoolingMonthlyBills)); await tick(10);
  window.dispatchEvent(new (window as any).Event(M.POOLING_INPUTS_CHANGED));
  fakeDb.db.expenses.push({ id: 'c2', expense_date: cd(1), amount: 10, description: 'x' });
  window.dispatchEvent(new (window as any).Event(M.POOLING_INPUTS_CHANGED)); await wait(350); await tick();
  assert.match(draftSection(host).textContent, /Expenses so far₹1010\.00/);
  assert.match(host.textContent, /₹1234\.56Published/); // previous month keeps its saved published amount
  assert.doesNotMatch(draftSection(host).textContent, /Published/);
  noWrites();
});

test('Pooling current month PDF: exports exactly the displayed draft (values, month, cutoff, NOT PUBLISHED); read-only; multi-page', async () => {
  fakeDb.reset(); seedPoolingMonth({ orders: true }); const { asOf } = seedCurrentMonth(); asAdmin(); pooling();
  const got: any[] = []; const real = M.poolingDraftPdfAdapter.download; M.poolingDraftPdfAdapter.download = async (m: any) => { got.push(m); };
  try {
    const { host } = await mount(createElement(M.PoolingMonthlyBills)); await tick(10);
    await click(byText(draftSection(host), 'button', /^Download PDF$/));
    assert.equal(got.length, 1); const m = got[0];
    assert.equal(m.canteenName, 'Test Canteen'); assert.match(m.title, /DRAFT \(NOT PUBLISHED\)/);
    assert.equal(m.subtitle, `${m.month} · Draft as of ${M.displayBusinessDate(asOf)}`);
    assert.deepEqual(m.rows.map((r: any) => [r.name, r.share, r.special, r.adminAdded, r.total]).sort(), [['Anu', 50000, 2500, 5000, 57500], ['Biju', 50000, 0, 0, 50000]]);
    assert.equal(m.expenseTotal, 100000); assert.equal(m.billTotal, 107500);
    noWrites();
    const texts: string[] = []; let pages = 1;
    const doc: any = { setTextColor() {}, setFont() {}, setFontSize() {}, setFillColor() {}, setDrawColor() {}, rect() {}, line() {}, addPage() { pages++; },
      splitTextToSize: (s: string) => s.length > 20 ? [s.slice(0, 20), s.slice(20)] : [s], text: (t: any) => { texts.push(...(Array.isArray(t) ? t : [t])); } };
    M.renderPoolingDraftPdf(doc, m, 'now');
    for (const s of ['Test Canteen', m.subtitle, 'Rs.575.00', 'Rs.500.00', 'Rs.25.00', 'Rs.50.00', 'Total expenses: Rs.1000.00', 'Bill total: Rs.1075.00', 'Draft — not published.']) assert.ok(texts.includes(s), s);
    const big = { ...m, rows: Array.from({ length: 80 }, (_, i) => ({ ...m.rows[0], name: `Member number ${i} with a long name` })) };
    texts.length = 0; pages = 1; M.renderPoolingDraftPdf(doc, big, 'now');
    assert.ok(pages > 1, 'multi-page'); for (let i = 0; i < 80; i++) assert.ok(texts.includes(`Member number ${i} with`.slice(0, 20)) && texts.includes(String(i + 1)));
    assert.equal(texts.filter(t => t === 'Member').length, pages, 'table header on every page');
  } finally { M.poolingDraftPdfAdapter.download = real; }
});

// ---- Startup / landing: white, single brand (no "Powered by" plate) ----
function loadingEl(host: any) {
  const el: any = host.querySelector('[data-testid="app-loading"]');
  assert.ok(el, 'branded loading view is shown');
  assert.match(el.className, /\bbg-white\b/);
  assert.doesNotMatch(host.innerHTML, /powered by/i);
  return el;
}
function assertWordmarkLoading(host: any) {
  const el = loadingEl(host);
  assert.equal(el.getAttribute('data-variant'), 'wordmark');
  assert.equal(el.querySelector('img'), null, 'loading screens have no icon');
  assert.match(el.textContent, /Go Canteen/);
  assert.match(el.querySelector('p')?.className || '', /text-primary-800/);
}
test('startup loading screen is white: every gap shows only the green wordmark; login stays white', async () => {
  M.resetAppPresentedForTests();
  assertWordmarkLoading((await mount(createElement(M.AppLoadingScreen))).host);
  assertWordmarkLoading((await mount(createElement(M.AppLoadingScreen, { variant: 'icon' }))).host);
  assertWordmarkLoading((await mount(createElement(M.AppLoadingScreen, { variant: 'wordmark' }))).host);
  auth.user = null;
  const l = await mount(createElement(M.Login));
  const land: any = l.host.querySelector('[data-testid="login-landing"]');
  assert.ok(land); assert.match(land.className, /\bbg-white\b/); assert.doesNotMatch(land.className, /gradient|from-primary|via-primary|to-primary|bg-primary/);
  assert.match(l.host.textContent, /Go Canteen/); assert.doesNotMatch(l.host.innerHTML, /powered by/i);
});
test('repo: no "Powered by" branding left in app source, and launcher icons are untouched', async () => {
  const fs = await import('node:fs'); const crypto = await import('node:crypto');
  const root = path.resolve(here, '..');
  for (const f of ['App.tsx', 'index.html', 'components/auth/Login.tsx', 'components/shared/SplashScreen.tsx']) assert.doesNotMatch(fs.readFileSync(path.join(root, f), 'utf8'), /powered by/i, f);
  const wf = fs.readFileSync(path.join(root, '.github/workflows/android-apk.yml'), 'utf8');
  assert.match(wf, /test "\$LAUNCH_THEME" = AppTheme\.NoActionBarLaunch/); assert.match(wf, /values-night-v31/); assert.doesNotMatch(wf, /<style name="\$THEME_NAME">/);
  const icons = fs.readFileSync(path.join(here, 'launcher_icons.sha256'), 'utf8').trim().split('\n').map(l => l.split(/\s+/));
  for (const [h, f] of icons) assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root, f))).digest('hex'), h, f);
});
test('pre-JS paint: index.html html/body/#root are plain #ffffff, light color-scheme, white theme-color (no green/near-white gradient)', async () => {
  const fs = await import('node:fs'); const root = path.resolve(here, '..');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
  assert.doesNotMatch(css, /gradient/i);
  let checked = 0; for (const m of css.matchAll(/(?:^|\n)\s*([^{}\n]+?)\s*\{([^}]*)\}/g)) if (/^(?:html|body|#root|html, body, #root)$/.test(m[1].trim())) for (const b of m[2].matchAll(/background(?:-color)?\s*:\s*([^;]+);/g)) { checked++; assert.equal(b[1].trim().toLowerCase(), '#ffffff', `${m[1].trim()} background`); }
  assert.equal(checked, 4, 'html/body/#root page backgrounds checked');
  assert.match(css, /html, body, #root \{[^}]*background-color: #ffffff/); assert.match(css, /:root \{ color-scheme: light; \}/);
  assert.match(html, /<meta name="theme-color" content="#ffffff" \/>/); assert.match(html, /<meta name="color-scheme" content="light" \/>/);
  assert.match(fs.readFileSync(path.join(root, 'vite.config.ts'), 'utf8'), /theme_color: '#ffffff',\s*background_color: '#ffffff'/);
  assert.match(fs.readFileSync(path.join(root, 'capacitor.config.ts'), 'utf8'), /backgroundColor: '#ffffff'/);
  assert.match(html, /id="gc-boot"/); assert.match(html, /Go Canteen<\/p>/);
  const boot = html.slice(html.indexOf('id="gc-boot"'), html.indexOf('type="module"'));
  assert.doesNotMatch(boot, /gocanteen-icon|opacity:\s*0|animate-pulse|powered by/i);
  const cap = fs.readFileSync(path.join(root, 'capacitor.config.ts'), 'utf8');
  assert.match(cap, /launchShowDuration:\s*0/); assert.match(cap, /launchFadeOutDuration:\s*0/);
  const loadSrc = fs.readFileSync(path.join(root, 'components/shared/AppLoadingScreen.tsx'), 'utf8');
  assert.doesNotMatch(loadSrc, /gocanteen-icon|setTimeout|minDuration|fade-in|fade-out|animate-pulse/);
  const wf = fs.readFileSync(path.join(root, '.github/workflows/android-apk.yml'), 'utf8');
  assert.doesNotMatch(wf, /android:drawable="@mipmap\/ic_launcher_foreground"/);
  assert.match(wf, /splash_empty_icon/); assert.match(wf, /windowSplashScreenAnimatedIcon/);
  assert.match(wf, /forceDarkAllowed">false/); assert.match(wf, /grep -R -I -i -l 'powered by alien' "\$R" dist;/);
});

// ---- t72: Mess cut days editable 0..31 (text draft, validated on Save only) ----
function billingDb(days: number) {
  fakeDb.reset(); auth.user = { id: 'O1', name: 'Owner', role: 'admin' }; auth.perms = ['payments'];
  fakeDb.db.canteen_billing_settings = [{ billing_model: 'pooling', mess_cut_min_days: days, bill_send_mode: 'manual' }];
  fakeDb.rpcHandlers.set_canteen_billing_settings = (a: any) => { const row = { billing_model: a.p_billing_model, mess_cut_min_days: a.p_mess_cut_min_days, bill_send_mode: a.p_bill_send_mode }; fakeDb.db.canteen_billing_settings = [row]; return { data: row }; };
}
async function openBilling() { await act(async () => { await M.refreshBillingSettings(); }); const r = await mount(createElement(M.BillingModeSettings)); await tick(); return r.host; }
const daysInput = (h: any) => h.querySelector('input[aria-label="Mess cut days"]');
const saveSettings = (h: any) => click(byText(h, 'button', /^Save Billing Settings$/));
test('mess cut days: clear / 0 / 1 / 2 / 3 / 10 / 31 are typed without coercion, saved and reloaded', async () => {
  for (const n of [0, 1, 2, 3, 10, 31]) {
    billingDb(6); let h = await openBilling();
    assert.equal(daysInput(h).value, '6');
    await type(daysInput(h), ''); assert.equal(daysInput(h).value, '', 'clearing is allowed (no jump to 1)');
    if (n === 31) { await type(daysInput(h), '3'); assert.equal(daysInput(h).value, '3'); }
    await type(daysInput(h), String(n)); assert.equal(daysInput(h).value, String(n));
    await saveSettings(h);
    assert.deepEqual(rpcs('set_canteen_billing_settings').map((a: any) => a.p_mess_cut_min_days), [n]);
    assert.match(h.textContent, /Billing settings saved\./);
    for (const r of mounted.splice(0)) await act(async () => r.unmount());
    h = await openBilling(); assert.equal(daysInput(h).value, String(n), 'reloaded from the saved row');
  }
});
test('mess cut days: -1 / 32 / 1.5 / empty / text are rejected on Save with a simple message and never persisted', async () => {
  for (const bad of ['-1', '32', '1.5', '', ' ', 'abc', '07a']) {
    billingDb(6); const h = await openBilling();
    await type(daysInput(h), bad); await saveSettings(h);
    assert.equal(rpcs('set_canteen_billing_settings').length, 0, `no save for ${JSON.stringify(bad)}`);
    assert.match(h.textContent, /Mess cut days must be a whole number from 0 to 31\./);
    assert.equal(daysInput(h).value, bad, 'what the admin typed is kept, not silently replaced');
    assert.equal(fakeDb.db.canteen_billing_settings[0].mess_cut_min_days, 6);
    for (const r of mounted.splice(0)) await act(async () => r.unmount());
  }
});
test('mess cut days: an in-progress edit is not reset by a settings reload; other fields saved unchanged', async () => {
  billingDb(6); const h = await openBilling();
  await type(daysInput(h), '1');
  await act(async () => { M.publishBillingSettings({ billingModel: 'pooling', messCutMinDays: 6, billSendMode: 'manual' }); }); await tick();
  assert.equal(daysInput(h).value, '1');
  await saveSettings(h);
  assert.deepEqual(rpcs('set_canteen_billing_settings'), [{ p_billing_model: 'pooling', p_mess_cut_min_days: 1, p_bill_send_mode: 'manual' }]);
});
test('service: saveBillingSettings refuses out-of-range days instead of defaulting', async () => {
  billingDb(6);
  for (const bad of [-1, 32, 1.5, NaN]) await assert.rejects(M.saveBillingSettings({ billingModel: 'pooling', messCutMinDays: bad, billSendMode: 'manual' }), /whole number from 0 to 31/);
  assert.equal(rpcs('set_canteen_billing_settings').length, 0);
});

test('auth restore, logout, OAuth, and later gaps all show only the green wordmark', async () => {
  M.resetAppPresentedForTests();
  auth.user = { id: 'M001', name: 'Member', role: 'employee' }; auth.loading = true; auth.googleOAuthInProgress = false;
  assertWordmarkLoading((await mount(createElement(M.AppContent))).host);
  M.markAppPresented();
  auth.loading = true; auth.user = null; auth.googleOAuthInProgress = false;
  assertWordmarkLoading((await mount(createElement(M.AppContent))).host);
  auth.loading = false; auth.user = null; auth.googleOAuthInProgress = true;
  assertWordmarkLoading((await mount(createElement(M.AppContent))).host);
  assertWordmarkLoading((await mount(createElement(M.Login))).host);
});

test('AI Intelligence hides finance panels in Pooling and keeps them in Standard', async () => {
  auth.user = { id: 'O1', name: 'Owner', role: 'admin' }; auth.perms = ['payments', 'bills', 'orders', 'members'];
  const financeHeadings = ['Financial Trend', 'Member Behaviour Intelligence', 'Payment Behaviour Intelligence', 'Financial Intelligence', 'Revenue / Expense / Net Revenue Trends'];
  standard();
  const std = await mount(createElement(M.AIIntelligence));
  for (const label of financeHeadings) assert.ok(std.host.textContent.includes(label), label + ' visible in Standard');
  assert.match(std.host.textContent, /Meal Pattern Analysis/);
  const fs = await import('node:fs');
  const aiSrc = fs.readFileSync(path.join(path.resolve(here, '..'), 'components/admin/AIIntelligence.tsx'), 'utf8');
  assert.match(aiSrc, /\{!pooling&&<div><h4 className="font-semibold">Monthly Financial Forecast/);
  pooling();
  const pool = await mount(createElement(M.AIIntelligence));
  for (const label of financeHeadings) assert.equal(pool.host.textContent.includes(label), false, label + ' hidden in Pooling');
  assert.match(pool.host.textContent, /Meal Pattern Analysis/);
  assert.match(pool.host.textContent, /Quantity & Kitchen Intelligence/);
  const poolForecast = [...pool.host.querySelectorAll('button')].find((e: any) => /Forecasting/.test(e.textContent || ''));
  await click(poolForecast);
  assert.match(pool.host.textContent, /Forecasting/);
  assert.equal(pool.host.textContent.includes('Monthly Financial Forecast'), false);
  assert.equal(pool.host.textContent.includes('Net Revenue'), false);
});

test('repo: poll notifications are not inserted from the browser client', async () => {
  const fs = await import('node:fs');
  const polls = fs.readFileSync(path.join(path.resolve(here, '..'), 'services/polls.ts'), 'utf8');
  assert.doesNotMatch(polls, /notifyAll|from\('notifications'\)\.insert/);
  const deliver = fs.readFileSync(path.join(path.resolve(here, '..'), 'supabase/functions/deliver-member-push/index.ts'), 'utf8');
  assert.match(deliver, /'poll_id'/);
});


function seedPolls() {
  fakeDb.reset();
  const now = Date.now();
  const iso = (ms: number) => new Date(ms).toISOString();
  fakeDb.db.polls = [
    { id: 'ended', title: 'Old Lunch Poll', questions: [{ id: 'q1', text: 'Done?', options: ['Yes', 'No'], allowMultiple: false }], starts_at: iso(now - 3e6), ends_at: iso(now - 6e5), enabled: true, created_at: iso(now - 3e6) },
    { id: 'live', title: 'Live Dinner Poll', questions: [{ id: 'q1', text: 'Soup?', options: ['Yes', 'No'], allowMultiple: false }], starts_at: iso(now - 6e5), ends_at: iso(now + 3e6), enabled: true, created_at: iso(now - 1e5) },
    { id: 'soon', title: 'Upcoming Breakfast Poll', questions: [], starts_at: iso(now + 6e5), ends_at: iso(now + 3e6), enabled: true, created_at: iso(now) },
  ];
  fakeDb.db.poll_responses = [];
}
test('member login shows only a currently live poll, never ended history or a scheduled preview', async () => {
  seedPolls(); auth.user = { id: 'M001', name: 'Member', role: 'employee' };
  const h = (await mount(createElement(M.MemberPoll))).host;
  assert.match(h.textContent, /Live Dinner Poll/);
  assert.doesNotMatch(h.textContent, /Old Lunch Poll|Upcoming Breakfast Poll/);
});
test('member login shows nothing when the only polls have already ended', async () => {
  seedPolls(); fakeDb.db.polls = fakeDb.db.polls.filter((p: any) => p.id === 'ended');
  auth.user = { id: 'M001', name: 'Member', role: 'employee' };
  const h = (await mount(createElement(M.MemberPoll))).host;
  assert.equal(h.textContent.trim(), '');
  assert.doesNotMatch(h.textContent, /Old Lunch Poll|Poll/);
});
test('admin Poll settings still list ended polls and their results download', async () => {
  seedPolls(); auth.user = { id: 'O1', name: 'Owner', role: 'admin' }; auth.perms = ['payments'];
  const h = (await mount(createElement(M.PollSettings))).host;
  assert.match(h.textContent, /Old Lunch Poll/);
  assert.match(h.textContent, /Live Dinner Poll/);
  assert.match(h.textContent, /Upcoming Breakfast Poll/);
  assert.match(h.textContent, /Ended/);
  assert.match(h.textContent, /Download Results PDF/);
});

test('Pooling Expenses shows Download PDF and generates a monthly report; Standard hides it', async () => {
  fakeDb.reset();
  auth.user = { id: 'O1', name: 'Owner', role: 'admin', canteenName: 'Test Canteen' }; auth.perms = ['expenses'];
  fakeDb.db.expenses = [
    { id: 'e1', expense_date: '2026-10-07', amount: 150, description: 'Vegetables' },
    { id: 'e2', expense_date: '2026-10-12', amount: 80.5, description: 'Oil' },
    { id: 'e3', expense_date: '2026-09-03', amount: 40, description: 'Gas' },
  ];
  pooling();
  const r = await mount(createElement(M.Expenses));
  const box = r.host.querySelector('[data-testid="expense-pdf-download"]');
  assert.ok(box, 'Pooling Expenses shows Download PDF');
  assert.match(box.textContent, /Download PDF/);
  const yearSel: any = r.host.querySelector('[aria-label="Expense PDF year"]');
  const monthSel: any = r.host.querySelector('[aria-label="Expense PDF month"]');
  assert.ok(yearSel && monthSel);
  const setSel = Object.getOwnPropertyDescriptor((win as any).HTMLSelectElement.prototype, 'value')!.set!;
  await act(async () => { setSel.call(yearSel, '2026'); yearSel.dispatchEvent(new (win as any).Event('change', { bubbles: true })); });
  await act(async () => { setSel.call(monthSel, '10'); monthSel.dispatchEvent(new (win as any).Event('change', { bubbles: true })); });
  await tick(1);
  const captured: any[] = [];
  const prev = M.expensesPdfAdapter.download;
  M.expensesPdfAdapter.download = async (m: any) => { captured.push(m); };
  try {
    await click([...box.querySelectorAll('button')].find((b: any) => /Download PDF/.test(b.textContent || '')));
    assert.equal(captured.length, 1);
    assert.equal(captured[0].canteenName, 'Test Canteen');
    assert.equal(captured[0].year, 2026);
    assert.equal(captured[0].month, 10);
    assert.equal(captured[0].empty, false);
    assert.equal(captured[0].rows.length, 2);
    assert.equal(captured[0].total, 230.5);
    assert.match(captured[0].filename, /2026-10/);
    assert.ok(captured[0].rows.some((row: any) => row.description === 'Vegetables' && row.amount === 150));
    await act(async () => { setSel.call(monthSel, '11'); monthSel.dispatchEvent(new (win as any).Event('change', { bubbles: true })); });
    await tick(1);
    await click([...r.host.querySelectorAll('button')].find((b: any) => /Download PDF/.test(b.textContent || '')));
    assert.equal(captured[1].empty, true);
    assert.equal(captured[1].rows.length, 0);
    assert.match(r.host.textContent, /No expenses for this month/);
    const rec: string[] = [];
    const doc = { setTextColor() {}, setFont() {}, setFontSize() {}, setFillColor() {}, setDrawColor() {}, rect() {}, line() {}, addPage() {}, splitTextToSize: (s: string) => [s], text: (s: any) => { (Array.isArray(s) ? s : [s]).forEach((x: any) => { if (typeof x === 'string') rec.push(x); }); } };
    M.renderExpensesPdf(doc, captured[1], 'now');
    assert.ok(rec.includes('No expenses for this month.'));
    rec.length = 0;
    M.renderExpensesPdf(doc, captured[0], 'now');
    assert.ok(rec.includes('GO CANTEEN'));
    assert.ok(rec.includes('Test Canteen'));
    assert.ok(rec.some((s: string) => /EXPENSES/.test(s) && /October/.test(s)));
    assert.ok(rec.includes('Vegetables'));
    assert.ok(rec.includes('Rs.230.50') || rec.includes('Total: Rs.230.50'));
  } finally {
    M.expensesPdfAdapter.download = prev;
  }
  standard();
  const s = await mount(createElement(M.Expenses));
  assert.equal(s.host.querySelector('[data-testid="expense-pdf-download"]'), null, 'Standard hides expense PDF download');
});

test('member published-bill PDF is offered only for published months and uses the stored total when lines differ', async () => {
  fakeDb.reset();
  fakeDb.setAuthUid('mid-1');
  auth.user = { id: 'M001', identityId: 'mid-1', name: 'Anu', role: 'employee', canteenName: 'Test Canteen' };
  data.orders = [{
    date: '2026-10-07', status: 'active', orderSource: 'admin',
    items: { rice: true }, itemNames: { rice: 'Rice' }, itemQuantities: { rice: 1 }, itemPrices: { rice: 80 },
    guestName: 'Ravi', guestItems: { tea: true }, guestItemNames: { tea: 'Tea' }, guestItemQuantities: { tea: 1 }, guestItemPrices: { tea: 20 },
  }];
  fakeDb.db.profiles = [{ id: 'mid-1', employee_code: 'M001' }];
  fakeDb.db.employee_adjustments = [{ id: 'adj1', employee_id: 'mid-1', adjustment_date: '2026-10-07', amount: -20, description: 'Less rice' }];
  fakeDb.db.monthly_bills = [
    { id: 'b1', employee_id: 'mid-1', bill_year: 2026, bill_month: 10, published: true, food_total: 80, guest_food_total: 20, admin_added_total: -20, special_items_total: 0, total: 80, member_name_snapshot: 'Anu' },
    { id: 'b2', employee_id: 'mid-1', bill_year: 2026, bill_month: 9, published: false, food_total: 10, guest_food_total: 0, admin_added_total: 0, total: 10 },
  ];
  standard();
  const r = await mount(createElement(M.Bills));
  const box = r.host.querySelector('[data-testid="member-bill-pdf-download"]');
  assert.ok(box, 'published bills show Download PDF');
  const months = [...box.querySelectorAll('[aria-label="Bill PDF month"] option')].map((o: any) => o.value);
  assert.deepEqual(months, ['10']);
  const captured: any[] = [];
  const prev = M.memberBillPdfAdapter.download;
  M.memberBillPdfAdapter.download = async (m: any) => { captured.push(m); };
  try {
    await click([...box.querySelectorAll('button')].find((b: any) => /Download PDF/.test(b.textContent || '')));
    assert.equal(captured.length, 1);
    assert.equal(captured[0].publishedTotal, 80);
    assert.equal(captured[0].billingModel, 'standard');
    assert.ok(captured[0].entries.some((e: any) => e.label === 'Admin order'));
    assert.ok(captured[0].entries.some((e: any) => e.label === 'Guest order'));
    assert.ok(captured[0].entries.some((e: any) => e.label === 'Admin deduction' && e.amount === -20));
    assert.ok(captured[0].rows.some((r: any) => r.kind === 'grand_total' && r.amount === 80));
    assert.ok(captured[0].rows.some((r: any) => r.orderType === 'Guest order' && r.name === 'Ravi' && r.item === 'Tea'));
    assert.ok(captured[0].rows.some((r: any) => r.kind === 'day_subtotal' && r.amount === 80));
    const mismatch = M.buildMemberBillPdfModel(
      { bill_year: 2026, bill_month: 10, food_total: 100, guest_food_total: 0, admin_added_total: 0, total: 250 },
      [{ date: '2026-10-01', status: 'active', items: { x: true }, itemNames: { x: 'X' }, itemQuantities: { x: 1 }, itemPrices: { x: 100 } }],
      [], 'Test Canteen', 'Anu', 'standard'
    );
    assert.equal(mismatch.computedTotal, 100);
    assert.equal(mismatch.publishedTotal, 250);
    assert.equal(mismatch.reconciled, false);
    assert.equal(mismatch.roundingAdjustment, 150);
    assert.equal(mismatch.rows.find((r: any) => r.kind === 'adjustment')?.amount, 150);
    assert.equal(mismatch.rows.find((r: any) => r.kind === 'grand_total')?.amount, 250);
  } finally {
    M.memberBillPdfAdapter.download = prev;
  }
});


test('member bill PDF table rows cover serial numbers, day subtotals, pooling (no item prices) and page chrome', () => {
  const bill = {
    bill_year: 2026, bill_month: 10,
    food_total: 80, guest_food_total: 20, admin_added_total: -20, special_items_total: 0,
    total: 80, member_name_snapshot: 'Anu', published: true,
  };
  const orders = [{
    date: '2026-10-07', status: 'active', orderSource: 'admin', guestName: 'Ravi',
    items: { rice: true }, itemNames: { rice: 'Rice' }, itemQuantities: { rice: 1 }, itemPrices: { rice: 80 },
    guestItems: { tea: true }, guestItemNames: { tea: 'Tea' }, guestItemQuantities: { tea: 2 }, guestItemPrices: { tea: 20 },
  }];
  const adjs = [{ adjustment_date: '2026-10-07', amount: -20, description: 'Less rice' }];
  const model = M.buildMemberBillPdfModel(bill, orders, adjs, 'Test Canteen', 'Anu', 'standard');
  const items = model.rows.filter((r: any) => r.kind === 'item');
  assert.deepEqual(items.map((r: any) => r.sno), [1, 2, 3]);
  assert.equal(items[0].orderType, 'Admin order');
  assert.equal(items[0].name, 'Anu');
  assert.equal(items[1].orderType, 'Guest order');
  assert.equal(items[1].name, 'Ravi');
  assert.equal(items[1].amount, 40);
  assert.equal(items[2].orderType, 'Admin deduction');
  assert.equal(model.rows.find((r: any) => r.kind === 'day_subtotal')?.amount, 100);
  assert.equal(model.rows.find((r: any) => r.kind === 'grand_total')?.amount, 80);
  assert.equal(model.billStatus, 'Published');
  const unnamed = M.buildMemberBillPdfModel(bill, [{ ...orders[0], guestName: '' }], [], 'Test Canteen', 'Anu', 'standard');
  assert.equal(unnamed.rows.find((r: any) => r.orderType === 'Guest order')?.name, 'Guest');
  const pooling = M.buildMemberBillPdfModel(
    { ...bill, food_total: 400, guest_food_total: 0, admin_added_total: -20, special_items_total: 30, total: 410 },
    orders, adjs, 'Test Canteen', 'Anu', 'pooling'
  );
  assert.ok(pooling.rows.filter((r: any) => r.kind === 'item').every((r: any) => r.amount == null));
  assert.equal(pooling.rows.some((r: any) => r.kind === 'day_subtotal'), false);
  assert.equal(pooling.rows.find((r: any) => r.kind === 'grand_total')?.amount, 410);
  assert.equal(pooling.breakdown.memberFood, 400);
  const days = M.buildMemberBillPdfModel(
    { bill_year: 2026, bill_month: 10, food_total: 150, guest_food_total: 0, admin_added_total: 0, total: 150 },
    [
      { date: '2026-10-01', status: 'active', items: { a: true }, itemNames: { a: 'A' }, itemQuantities: { a: 1 }, itemPrices: { a: 50 } },
      { date: '2026-10-02', status: 'active', items: { b: true }, itemNames: { b: 'B' }, itemQuantities: { b: 1 }, itemPrices: { b: 100 } },
    ],
    [], 'Test Canteen', 'Anu', 'standard'
  );
  assert.deepEqual(days.rows.filter((r: any) => r.kind === 'day_subtotal').map((r: any) => r.amount), [50, 100]);
  assert.equal(days.reconciled, true);
  const texts: string[] = [];
  const fakeDoc = {
    setTextColor() {}, setFont() {}, setFontSize() {}, setFillColor() {}, setDrawColor() {}, setLineWidth() {},
    rect() {}, line() {}, addPage() {}, setPage() {}, getNumberOfPages() { return 1; },
    splitTextToSize(s: string) { return [String(s ?? '')]; },
    text(s: any) { texts.push(Array.isArray(s) ? s.join(' ') : String(s)); },
  };
  M.renderMemberBillPdf(fakeDoc, model, '11 Nov 2026, 7:00 am');
  const joined = texts.join('\n');
  assert.match(joined, /Test Canteen/);
  assert.match(joined, /Member: Anu/);
  assert.match(joined, /Status: Published/);
  assert.match(joined, /S\.No/);
  assert.match(joined, /Order type/);
  assert.match(joined, /Page 1 of 1/);
});

test('Admin extra amount accepts a minus within unbilled room and rejects published or oversize minuses', async () => {
  fakeDb.reset();
  auth.user = { id: 'O1', name: 'Owner', role: 'admin' }; auth.perms = ['payments'];
  data.users = [{ id: 'E1', identityId: 'eid-1', name: 'Asha', role: 'employee', status: 'active' }];
  fakeDb.db.profiles = [{ id: 'eid-1', employee_code: 'E1' }];
  let room = { published: false, available: 50 };
  fakeDb.rpcHandlers.get_member_unbilled_admin_room = () => ({ data: room });
  const r = await mount(createElement(M.AdminEmployeeOrder));
  const pick = r.host.querySelector('select');
  const setSel = Object.getOwnPropertyDescriptor((win as any).HTMLSelectElement.prototype, 'value')!.set!;
  await act(async () => { setSel.call(pick, 'E1'); pick.dispatchEvent(new (win as any).Event('change', { bubbles: true })); });
  await tick(2);
  assert.match(r.host.textContent, /Unbilled amount available for minus: ₹50\.00/);
  const amt = r.host.querySelector('[data-testid="admin-extra-amount"]');
  await type(amt, '-20');
  await click(byText(r.host, 'button', /^Add Amount$/));
  const inserted = fakeDb.db.employee_adjustments || [];
  assert.equal(inserted.length, 1);
  assert.equal(Number(inserted[0].amount), -20);
  assert.match(r.host.textContent, /−₹20\.00|recorded −₹20/);
  room = { published: true, available: 0 };
  await act(async () => { /* rerender via changing employee to refetch */ });
  // remount to pick up published room
  for (const mnt of mounted.splice(0)) await act(async () => mnt.unmount());
  const r2 = await mount(createElement(M.AdminEmployeeOrder));
  const pick2 = r2.host.querySelector('select');
  await act(async () => { setSel.call(pick2, 'E1'); pick2.dispatchEvent(new (win as any).Event('change', { bubbles: true })); });
  await tick(2);
  assert.match(r2.host.textContent, /already published/);
  const amt2 = r2.host.querySelector('[data-testid="admin-extra-amount"]');
  await type(amt2, '-10');
  await click(byText(r2.host, 'button', /^Add Amount$/));
  assert.match(r2.host.textContent, /already published/);
  assert.equal(M.negativeAdjustmentBlocked(-20, { published: false, available: 10 }), "Minus amount can't exceed this member's unbilled amount (₹10.00)");
  assert.equal(M.negativeAdjustmentBlocked(-20, { published: false, available: 0 }), "Minus amount can't exceed this member's unbilled amount (₹0.00)");
  assert.equal(M.parseAdminAdjustmentAmount('25').ok, true);
});
