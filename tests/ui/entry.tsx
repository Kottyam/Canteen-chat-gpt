// Bundled by tests/ui.flows.test.ts: real components, fake auth/data/supabase modules.
export { default as MenuManagement } from '../../components/admin/MenuManagement';
export { default as OrderCalendar } from '../../components/employee/OrderCalendar';
export { default as OrderModeTabs } from '../../components/employee/OrderModeTabs';
export { default as GuestOrdersToggle } from '../../components/admin/GuestOrdersToggle';
export { publishBillingSettings } from '../../hooks/useBillingSettings';
export { refreshCurrentSpecials, publishGuestOrdersEnabled } from '../../hooks/usePoolingSpecials';
export * as fakeDb from './fakeSupabase';
export { state as auth } from './fakeAuth';
export { state as data } from './fakeData';
export { createElement } from 'react';
export { createRoot } from 'react-dom/client';
export { act } from 'react';
export { specialsForDate, parsePriceToPaise } from '../../services/poolingSpecials';
export { default as PoolingMonthlyBills } from '../../components/admin/PoolingMonthlyBills';
export { default as MonthlyReport } from '../../components/admin/MonthlyReport';
