export type SubscriptionBillingCycle = 'monthly' | 'annual';
export type SubscriptionPricingModel = 'MEMBER_RANGE' | 'FIXED_AMOUNT' | 'PER_MEMBER';

export interface PricingPlanLike {
  id: string;
  pricing_model: SubscriptionPricingModel | string;
  monthly_price: number;
  annual_price: number;
  per_member_price?: number | null;
  billing_availability?: 'monthly' | 'annual' | 'monthly_annual' | string;
  min_members?: number | null;
  max_members?: number | null;
}

export interface PlanRangeLike {
  plan_id: string;
  min_members: number;
  max_members: number;
  monthly_price: number;
  annual_price: number;
}

/** Round to 2 decimal places (paise) to match SQL round(numeric, 2). */
export function roundSubscriptionMoney(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export function perMemberUnitPrice(plan: PricingPlanLike, cycle: SubscriptionBillingCycle): number {
  const raw = cycle === 'annual' ? plan.annual_price : plan.monthly_price;
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) return roundSubscriptionMoney(n);
  return 0;
}

export function matchingMemberRange<T extends PlanRangeLike>(
  ranges: readonly T[],
  planId: string,
  activeMembers: number,
): T | null {
  const matches = ranges
    .filter((r) => r.plan_id === planId && r.min_members <= activeMembers && r.max_members >= activeMembers)
    .sort((a, b) => b.min_members - a.min_members);
  return matches[0] || null;
}

export function computeSubscriptionAmount(
  plan: PricingPlanLike,
  cycle: SubscriptionBillingCycle,
  activeMembers: number,
  range?: PlanRangeLike | null,
): number {
  if (plan.pricing_model === 'PER_MEMBER') {
    const rate = perMemberUnitPrice(plan, cycle);
    const members = Math.max(0, Math.floor(Number(activeMembers) || 0));
    return roundSubscriptionMoney(rate * members);
  }
  if (plan.pricing_model === 'FIXED_AMOUNT') {
    return roundSubscriptionMoney(cycle === 'annual' ? plan.annual_price : plan.monthly_price);
  }
  if (!range) return 0;
  return roundSubscriptionMoney(cycle === 'annual' ? range.annual_price : range.monthly_price);
}
