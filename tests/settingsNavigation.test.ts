// Exercise the actual dashboard Settings reconciliation effect, without network/user data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
const source = readFileSync(new URL('../components/admin/AdminDashboard.tsx', import.meta.url), 'utf8');
const body = source.match(/useEffect\(\(\)=>\{(const allowed:SettingsTab\[\]=\[\];.*?)\},\[settingsTab,/s)?.[1];
assert.ok(body, 'find the real Settings tab reconciliation effect');
const js = transformSync(body, { loader: 'ts' }).code;
const reconcile = new Function('settingsTab', 'can', 'isOwner', 'setSettingsTab', js);
function clickBilling(permissions: string[], owner = false) {
  let selected = 'billing'; // same state transition as the Billing Mode button
  reconcile(selected, (p: string) => permissions.includes(p), owner, (next: string) => { selected = next; });
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
