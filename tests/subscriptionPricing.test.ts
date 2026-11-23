import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  computeSubscriptionAmount,
  perMemberUnitPrice,
  matchingMemberRange,
  roundSubscriptionMoney,
} from '../utils/subscriptionPricing.ts';

const basePlan = {
  id: 'p1',
  name: 'Plan',
  monthly_price: 20,
  annual_price: 200,
  per_member_price: 20,
  billing_availability: 'monthly' as const,
};

test('PER_MEMBER computes rate * active members for any member count', () => {
  const pm = { ...basePlan, pricing_model: 'PER_MEMBER' as const };
  assert.equal(perMemberUnitPrice(pm, 'monthly'), 20);
  assert.equal(computeSubscriptionAmount(pm, 'monthly', 100), 2000);
  assert.equal(computeSubscriptionAmount(pm, 'monthly', 1), 20);
  assert.equal(computeSubscriptionAmount(pm, 'monthly', 0), 0);
  assert.equal(computeSubscriptionAmount(pm, 'monthly', 357), 7140);
});

test('PER_MEMBER supports annual unit price and decimal rounding', () => {
  const pm = {
    ...basePlan,
    pricing_model: 'PER_MEMBER' as const,
    monthly_price: 19.5,
    annual_price: 199.95,
    per_member_price: null,
    billing_availability: 'monthly_annual' as const,
  };
  assert.equal(perMemberUnitPrice(pm, 'monthly'), 19.5);
  assert.equal(perMemberUnitPrice(pm, 'annual'), 199.95);
  assert.equal(computeSubscriptionAmount(pm, 'monthly', 3), 58.5);
  assert.equal(computeSubscriptionAmount(pm, 'annual', 3), 599.85);
  assert.equal(roundSubscriptionMoney(12.345), 12.35);
});

test('FIXED_AMOUNT and MEMBER_RANGE preserve existing calculation behavior', () => {
  const fixed = { ...basePlan, pricing_model: 'FIXED_AMOUNT' as const, monthly_price: 1999, annual_price: 19990 };
  assert.equal(computeSubscriptionAmount(fixed, 'monthly', 100), 1999);
  assert.equal(computeSubscriptionAmount(fixed, 'annual', 100), 19990);

  const ranged = { ...basePlan, pricing_model: 'MEMBER_RANGE' as const, monthly_price: 999, annual_price: 9990 };
  const ranges = [
    { id: 'r1', plan_id: 'p1', min_members: 0, max_members: 50, monthly_price: 999, annual_price: 9990 },
    { id: 'r2', plan_id: 'p1', min_members: 51, max_members: 200, monthly_price: 1999, annual_price: 19990 },
  ];
  const m1 = matchingMemberRange(ranges, 'p1', 25);
  const m2 = matchingMemberRange(ranges, 'p1', 100);
  assert.equal(computeSubscriptionAmount(ranged, 'monthly', 25, m1), 999);
  assert.equal(computeSubscriptionAmount(ranged, 'annual', 100, m2), 19990);
});

test('migration is strictly additive and does not mutate existing rows', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261123120000_subscription_per_member_pricing.sql', import.meta.url), 'utf8');
  const ddlHead = sql.split(/CREATE OR REPLACE FUNCTION/i)[0];
  assert.match(ddlHead, /ADD COLUMN IF NOT EXISTS per_member_price/i);
  assert.match(ddlHead, /'PER_MEMBER'/);
  assert.doesNotMatch(ddlHead, /\b(UPDATE|DELETE|INSERT)\b/i);
  assert.match(sql, /role\s*=\s*'employee'\s+and\s+(?:e\.)?status\s*=\s*'active'/i);
});

test('PREFER_PLAY_STORE remains false so website keeps direct APK button', () => {
  const src = readFileSync(new URL('../utils/androidAppInstall.ts', import.meta.url), 'utf8');
  assert.match(src, /export const PREFER_PLAY_STORE=false;/);
});
