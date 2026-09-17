export * from './pdfLegacy';
import { loadScopedOrders } from '../services/supabaseData';
import { loadHistoricalEmployeeAdjustments } from '../services/employeeAdjustments';
import { supabaseEnabled } from '../supabase';
import type { EmployeeAdjustmentForReport } from '../services/employeeAdjustments';
import type { Prices, Order, User } from '../types';
import { downloadMonthlyPdf as legacyDownloadMonthlyPdf } from './pdfLegacy';

let monthlyPdfGeneration: Promise<void> | null = null;

const nextPaint = async (): Promise<void> => {
  if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') return;
  await new Promise<void>(resolve => window.requestAnimationFrame(() => resolve()));
};

export async function downloadMonthlyPdf(
  month: number,
  year: number,
  users: User[] | undefined | null,
  orders: Order[] | undefined | null,
  prices: Prices | undefined | null,
  adjustments: EmployeeAdjustmentForReport[] | undefined | null = [],
  billingStart?: string,
  billingEnd?: string,
): Promise<void> {
  if (monthlyPdfGeneration) return monthlyPdfGeneration;

  const run = (async () => {
    await nextPaint();

    const start = billingStart || `${year}-${String(month).padStart(2, '0')}-01`;
    const end = billingEnd || new Date(year, month, 0).toISOString().slice(0, 10);

    let freshUsers = users || [];
    let freshOrders = orders || [];
    const freshPrices = prices || undefined;
    let freshAdjustments = adjustments || [];

    if (supabaseEnabled) {
      const [liveOrders, liveAdjustments] = await Promise.all([
        loadScopedOrders(),
        loadHistoricalEmployeeAdjustments(start, end),
      ]);
      freshOrders = liveOrders;
      freshAdjustments = Array.isArray(liveAdjustments) ? liveAdjustments : [];
    }

    await legacyDownloadMonthlyPdf(
      month,
      year,
      freshUsers,
      freshOrders,
      freshPrices,
      freshAdjustments,
      start,
      end,
    );
  })();

  monthlyPdfGeneration = run;
  try {
    await run;
  } finally {
    if (monthlyPdfGeneration === run) monthlyPdfGeneration = null;
  }
}
