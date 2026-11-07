// Bundled by tests/display.test.ts with esbuild; renders real components to static HTML (no browser).
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AuthProvider } from '../context/AuthContext';
import { DataProvider } from '../context/DataContext';
import MemberOrderFinancialCard from '../components/employee/MemberOrderFinancialCard';
import MenuManagement from '../components/admin/MenuManagement';
import { publishBillingSettings } from '../hooks/useBillingSettings';

const order: any = { id: 'o1', employeeId: 'e1', date: '2026-09-01', items: { lunchMeals: true }, itemQuantities: { lunchMeals: 2 }, itemPrices: { lunchMeals: 40 }, itemNames: { lunchMeals: 'Lunch: Meals' }, guestItems: { morningTea: true }, guestItemQuantities: { morningTea: 1 }, guestItemPrices: { morningTea: 8 }, guestItemNames: { morningTea: 'Morning Tea' }, status: 'active' };
const wrap = (el: React.ReactNode) => renderToStaticMarkup(<AuthProvider><DataProvider>{el}</DataProvider></AuthProvider>);
export function render(model: 'standard' | 'pooling') {
  publishBillingSettings({ billingModel: model, messCutMinDays: 6, billSendMode: 'manual' });
  return {
    card: wrap(<MemberOrderFinancialCard order={order} orderFor="today" orderDate="2026-09-01" adjustments={[{ id: 'a1', amount: 15, description: 'Extra', adjustment_date: '2026-09-01' } as any]} onViewOrder={() => {}} />),
    menu: wrap(<MenuManagement />),
  };
}
