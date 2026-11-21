// Exercise the actual dashboard Settings reconciliation effect, without network/user data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
const source = readFileSync(new URL('../components/admin/AdminDashboard.tsx', import.meta.url), 'utf8');
const body = source.match(/useEffect\(\(\)=>\{(const allowed:SettingsTab\[\]=\[\];.*?)\},\[settingsTab,/s)?.[1];
assert.ok(body, 'find the real Settings tab reconciliation effect');
const js = transformSync(body, { loader: 'ts' }).code;
const reconcile = new Function('settingsTab', 'can', 'isOwner', 'setSettingsTab', 'showFoodArrangement', js);
function clickBilling(permissions: string[], owner = false, showFoodArrangement = true) {
  let selected = 'billing'; // same state transition as the Billing Mode button
  reconcile(selected, (p: string) => permissions.includes(p), owner, (next: string) => { selected = next; }, showFoodArrangement);
  return selected;
}
function reconcileTab(start: string, permissions: string[], owner = false, showFoodArrangement = true) {
  let selected = start;
  reconcile(selected, (p: string) => permissions.includes(p), owner, (next: string) => { selected = next; }, showFoodArrangement);
  return selected;
}
test('Billing Mode stays selected after click when payments is allowed (staff and owner)', () => {
  assert.equal(clickBilling(['payments']), 'billing');
  assert.equal(clickBilling(['payments'], true), 'billing');
});
test('Billing Mode cannot stay selected without payments permission', () => {
  assert.equal(clickBilling(['time_management']), 'time');
  assert.equal(clickBilling([], true), 'staff');
  assert.equal(clickBilling([]), 'payment');
  assert.match(source, /settingsTab==='billing'&&can\('payments'\)&&<BillingModeSettings\/>/);
  assert.ok(source.includes("can('payments')&&<button type=\"button\" onClick={()=>setSettingsTab('billing')}"));
});

test('Employee Food Arrangement stays selected in Standard and is dropped when Pooling hides it', () => {
  assert.equal(reconcileTab('food', ['payments'], false, true), 'food');
  assert.equal(reconcileTab('food', ['payments'], true, true), 'food');
  assert.equal(reconcileTab('food', ['payments'], false, false), 'payment');
  assert.equal(reconcileTab('food', ['payments'], true, false), 'payment');
  assert.equal(reconcileTab('billing', ['payments'], false, false), 'billing');
});

test('Employee Food Arrangement tab is shown only after billing settings load as Standard', () => {
  assert.match(source, /const showFoodArrangement=billingLoaded&&!pooling/);
  assert.match(source, /showFoodArrangement&&can\('payments'\)&&<button type="button" onClick=\{\(\)=>setSettingsTab\('food'\)\}/);
  assert.match(source, /showFoodArrangement&&settingsTab==='food'&&can\('payments'\)&&<EmployeeFoodArrangementSettings\/>/);
  assert.match(source, /if\(showFoodArrangement\)allowed\.push\('food'\)/);
});

test('StaffAdminManagement hides Employee Food Arrangement in the Pooling permission catalog', () => {
  const staff = readFileSync(new URL('../components/admin/StaffAdminManagement.tsx', import.meta.url), 'utf8');
  assert.match(staff, /const showFoodArrangement=billingLoaded&&!pooling/);
  assert.match(staff, /items:g.items.filter\(i=>i.label!=='Employee Food Arrangement'\)/);
});

test('Guest orders stay on Employee Food Arrangement for Standard and appear on Billing Mode when Pooling', () => {
  const food = readFileSync(new URL('../components/admin/EmployeeFoodArrangementSettings.tsx', import.meta.url), 'utf8');
  const billing = readFileSync(new URL('../components/admin/BillingModeSettings.tsx', import.meta.url), 'utf8');
  assert.match(food, /<GuestOrdersToggle\/>/);
  assert.match(billing, /pooling && loaded && <div className="rounded-2xl border bg-white p-4 shadow-sm"><GuestOrdersToggle\/><\/div>/);
});
