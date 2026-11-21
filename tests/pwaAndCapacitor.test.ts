import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);

test('Capacitor app loads bundled dist assets, not the live website', () => {
  const cap = readFileSync(new URL('capacitor.config.ts', root), 'utf8');
  assert.match(cap, /webDir:\s*'dist'/);
  assert.doesNotMatch(cap, /server:\s*\{/);
  assert.doesNotMatch(cap, /gocanteen\.online/);
});

test('web service worker updates promptly: skipWaiting, clientsClaim, NetworkFirst HTML, reload on controllerchange', () => {
  const vite = readFileSync(new URL('vite.config.ts', root), 'utf8');
  const pwa = readFileSync(new URL('pwa.ts', root), 'utf8');
  assert.match(vite, /skipWaiting:\s*true/);
  assert.match(vite, /clientsClaim:\s*true/);
  assert.match(vite, /handler:\s*'NetworkFirst'/);
  assert.match(vite, /request\.mode === 'navigate'/);
  assert.doesNotMatch(vite, /globPatterns: \['\*\*\/\*\.\{js,css,html,/);
  assert.match(pwa, /immediate:\s*true/);
  assert.match(pwa, /onNeedRefresh\(\)\s*\{\s*apply\(true\)/);
  assert.match(pwa, /controllerchange/);
  assert.match(pwa, /location\.reload\(\)/);
  assert.match(pwa, /Capacitor\?\.isNativePlatform/);
  assert.match(pwa, /reg\.update\(\)/);
});
