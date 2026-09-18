import { Order } from '../types';

export interface OrderPresentation {
  grossMemberFood: number;
  grossGuestFood: number;
  adminAddedAmount: number;
  companyContribution: number;
  memberPayable: number;
}

const money = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
const orderItemsGross = (order: Order, guest = false) => {
  const items = guest ? order.guestItems || {} : order.items || {};
  const quantities = guest ? order.guestItemQuantities || {} : order.itemQuantities || {};
  const prices = guest ? order.guestItemPrices || {} : order.itemPrices || {};
  return Object.keys(items).filter(code => items[code]).reduce((sum, code) => {
    const quantity = Math.max(1, money(quantities[code] ?? 1));
    return sum + money(prices[code]) * quantity;
  }, 0);
};

/** UI-only financial presentation. Persisted contribution snapshots are authoritative. */
export const presentOrderFinancials = (order: Order): OrderPresentation => {
  const grossMemberFood = orderItemsGross(order);
  const grossGuestFood = orderItemsGross(order, true);
  const companyContribution = Math.max(0, money(order.companyFoodAmount));
  const memberPayable = Math.max(0, money(order.employeeFoodAmount ?? Math.max(0, grossMemberFood - companyContribution)));
  return { grossMemberFood, grossGuestFood, adminAddedAmount: 0, companyContribution, memberPayable };
};

export const presentAdjustmentFinancials = (adjustment: {
  amount?: number | null;
  contribution_eligible?: boolean;
  employee_food_amount?: number | null;
  company_food_amount?: number | null;
}) => {
  const amount = money(adjustment.amount);
  const eligible = Boolean(adjustment.contribution_eligible);
  return {
    grossMemberFood: 0,
    grossGuestFood: 0,
    adminAddedAmount: eligible ? money(adjustment.employee_food_amount ?? amount) : amount,
    companyContribution: eligible ? Math.max(0, money(adjustment.company_food_amount)) : 0,
    memberPayable: eligible ? money(adjustment.employee_food_amount ?? amount) : amount,
  };
};
