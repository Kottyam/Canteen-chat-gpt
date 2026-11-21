// Running-month Pooling draft PDF (admin only, read-only). Uses the project's existing jsPDF
// pipeline (deliverPdf) and brand header style. Generating it never writes bills/runs/notifications.
import { jsPDF } from 'jspdf';
import type { PoolingResult } from '../supabase/functions/_shared/poolingBilling';
import { COMMON_BILL_LABEL, poolingExpenseGrandTotalPaise } from '../supabase/functions/_shared/poolingBilling';
import { deliverPdf } from './pdfLegacy';

const BRAND_GREEN = [5, 150, 105] as const;
export const rsPdf = (p: number) => `Rs.${(Math.round(p) / 100).toFixed(2)}`;
export const displayBusinessDate = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }); };
export const monthLabel = (year: number, month: number) => new Date(Date.UTC(year, month - 1, 1)).toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });

export interface DraftPdfRow { name: string; days: string; messCut: string; share: number; commonBill: number; special: number; adminAdded: number; total: number }
export interface DraftPdfModel { canteenName: string; month: string; asOf: string; title: string; subtitle: string; rows: DraftPdfRow[]; expenseTotal: number; billTotal: number; unallocated: number; filename: string }

/** Pure: the exact values shown on screen for the draft. */
export function buildPoolingDraftPdfModel(result: PoolingResult, names: Record<string, string>, canteenName: string, asOf: string): DraftPdfModel {
  const month = monthLabel(result.year, result.month);
  const rows = result.lines.map(l => ({
    name: names[l.memberId] || 'Member',
    days: `${l.attendedDays}/${l.windowDays}`,
    messCut: l.messCutApplied ? (result.messCutMode === 'consecutive' ? `Yes (${l.excludedDays} consecutive)` : `Yes (${l.excludedDays})`) : 'No',
    share: l.sharePaise, commonBill: l.allMembersSharePaise || 0, special: (l.specialMemberPaise || 0) + (l.specialGuestPaise || 0), adminAdded: l.adminAddedPaise, total: l.totalPaise,
  }));
  return {
    canteenName: canteenName || 'GoCanteen', month, asOf,
    title: 'POOLING BILL — DRAFT (NOT PUBLISHED)', subtitle: `${month} · Draft as of ${displayBusinessDate(asOf)}`,
    rows, expenseTotal: poolingExpenseGrandTotalPaise(result), billTotal: rows.reduce((s, r) => s + r.total, 0), unallocated: result.unallocatedPaise,
    filename: `GoCanteen-Pooling-Draft-${result.year}-${String(result.month).padStart(2, '0')}-asof-${asOf}.pdf`,
  };
}

const COLS_BASE = [10, 52, 20, 22, 24, 20, 22, 16] as const; // no Common bill
const COLS_COMMON = [8, 38, 16, 18, 20, 22, 18, 20, 16] as const; // + Common bill
const M = 12, BOTTOM = 282, LINE = 4.6;
const W = 186;
const colLayout = (showCommon: boolean) => {
  const cols = showCommon ? COLS_COMMON : COLS_BASE;
  const xs = (cols as readonly number[]).reduce<number[]>((a, w, i) => { a.push(i ? a[i - 1] + (cols as readonly number[])[i - 1] : M); return a; }, []);
  const headers = showCommon
    ? ['Sl', 'Member', 'Ate', 'Mess cut', 'Pool share', COMMON_BILL_LABEL, 'Special', 'Admin added', 'Total']
    : ['Sl', 'Member', 'Ate', 'Mess cut', 'Pool share', 'Special', 'Admin added', 'Total'];
  return { cols, xs, headers };
};

/** Renders onto any jsPDF-compatible doc (tests pass a recorder). Multi-page; names wrap, never truncated. */
export function renderPoolingDraftPdf(doc: any, m: DraftPdfModel, generatedAt: string) {
  const showCommon = m.rows.some(r => (r.commonBill || 0) > 0);
  const { cols, xs, headers } = colLayout(showCommon);
  const header = () => {
    doc.setTextColor(...BRAND_GREEN); doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.text('GO CANTEEN', 105, 14, { align: 'center' });
    doc.setTextColor(0, 0, 0); doc.setFontSize(11); doc.text(m.canteenName, 105, 21, { align: 'center' });
    doc.setFontSize(12); doc.text(m.title, 105, 28, { align: 'center' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.text(m.subtitle, 105, 34, { align: 'center' }); doc.text(`Generated: ${generatedAt}`, 105, 39, { align: 'center' });
    let y = 45; doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setFillColor(245, 247, 246); doc.rect(M, y, W, 8, 'F');
    headers.forEach((t, i) => doc.text(t, xs[i] + 1, y + 5.5));
    doc.setFont('helvetica', 'normal'); return y + 10;
  };
  let y = header();
  m.rows.forEach((r, i) => {
    const nameLines: string[] = doc.splitTextToSize(r.name, cols[1] - 2);
    const h = Math.max(1, nameLines.length) * LINE + 2;
    if (y + h > BOTTOM) { doc.addPage(); y = header(); }
    const money = showCommon
      ? [rsPdf(r.share), rsPdf(r.commonBill || 0), rsPdf(r.special), rsPdf(r.adminAdded), rsPdf(r.total)]
      : [rsPdf(r.share), rsPdf(r.special), rsPdf(r.adminAdded), rsPdf(r.total)];
    const cells = [String(i + 1), nameLines, r.days, r.messCut, ...money];
    cells.forEach((c, j) => doc.text(c, xs[j] + 1, y + 3.5));
    doc.setDrawColor(220, 220, 220); doc.line(M, y + h, M + W, y + h); y += h;
  });
  if (y + 22 > BOTTOM) { doc.addPage(); y = header(); }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); y += 6;
  doc.text(`Total expenses: ${rsPdf(m.expenseTotal)}`, M, y); doc.text(`Bill total: ${rsPdf(m.billTotal)}`, M + W, y, { align: 'right' });
  if (m.unallocated > 0) { y += 5; doc.text(`Unallocated: ${rsPdf(m.unallocated)}`, M, y); }
  y += 6; doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.text('Draft — not published.', M, y);
  return doc;
}

/** Swappable in tests; real path = jsPDF + the app's existing deliverPdf (download / native share sheet only). */
export const poolingDraftPdfAdapter = {
  async download(m: DraftPdfModel) {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    renderPoolingDraftPdf(doc, m, new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }));
    await deliverPdf(doc, m.filename);
  },
};
