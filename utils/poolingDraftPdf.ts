// Running-month Pooling draft PDF (admin only, read-only). Uses the project's existing jsPDF
// pipeline (deliverPdf) and brand header style. Generating it never writes bills/runs/notifications.
import { jsPDF } from 'jspdf';
import type { MessCutMode, PoolingResult } from '../supabase/functions/_shared/poolingBilling';
import { COMMON_BILL_LABEL, poolingExpenseSummaryPaise } from '../supabase/functions/_shared/poolingBilling';
import { deliverPdf } from './pdfLegacy';

const BRAND_GREEN = [5, 150, 105] as const;
export const rsPdf = (p: number) => `Rs.${(Math.round(p) / 100).toFixed(2)}`;
export const displayBusinessDate = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }); };
export const monthLabel = (year: number, month: number) => new Date(Date.UTC(year, month - 1, 1)).toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** Short enough to fit the Mess cut column; wraps if a very large day count still overflows. */
export function messCutPdfLabel(applied: boolean, excludedDays: number, mode?: MessCutMode | null): string {
  if (!applied) return 'No';
  return mode === 'consecutive' ? `Yes · ${excludedDays} consec.` : `Yes · ${excludedDays} days`;
}

export interface DraftPdfRow { name: string; days: string; messCut: string; share: number; commonBill: number; special: number; adminAdded: number; total: number; specialPending?: boolean; specialDetails?: string[] }
export interface DraftPdfModel { canteenName: string; month: string; asOf: string; title: string; subtitle: string; rows: DraftPdfRow[]; foodExpense: number; commonExpense: number; specialExpense: number; expenseTotal: number; billTotal: number; unallocated: number; pendingNotes: string[]; filename: string }

/** Pure: the exact values shown on screen for the draft. */
export function buildPoolingDraftPdfModel(result: PoolingResult, names: Record<string, string>, canteenName: string, asOf: string): DraftPdfModel {
  const month = monthLabel(result.year, result.month);
  const summary = poolingExpenseSummaryPaise(result);
  const rows = result.lines.map(l => ({
    name: names[l.memberId] || 'Member',
    days: `${l.attendedDays}/${l.windowDays}`,
    messCut: messCutPdfLabel(Boolean(l.messCutApplied), l.excludedDays, result.messCutMode),
    share: l.sharePaise, commonBill: l.allMembersSharePaise || 0,
    special: (l.specialMemberPaise || 0) + (l.specialGuestPaise || 0) + (l.sharedSpecialPaise || 0),
    adminAdded: l.adminAddedPaise, total: l.totalPaise,
    specialPending: Boolean(l.specialPending),
    specialDetails: (l.specialLines || []).map(s => `${s.label}: Rs.${(s.paise/100).toFixed(2)}`),
  }));
  return {
    canteenName: canteenName || 'GoCanteen', month, asOf,
    title: 'POOLING BILL — DRAFT (NOT PUBLISHED)', subtitle: `${month} · Draft as of ${displayBusinessDate(asOf)}`,
    rows,
    foodExpense: summary.foodPaise,
    commonExpense: summary.commonPaise,
    specialExpense: summary.specialPaise,
    expenseTotal: summary.totalPaise,
    billTotal: rows.reduce((s, r) => s + r.total, 0), unallocated: result.unallocatedPaise,
    pendingNotes: (result.pendingSharedSpecials || []).map(p => `amount pending: ${p.itemName} (${p.date})`),
    filename: `GoCanteen-Pooling-Draft-${result.year}-${String(result.month).padStart(2, '0')}-asof-${asOf}.pdf`,
  };
}

// A4 portrait content width is 186mm (12mm side margins). Widths are chosen so headers and
// typical values (including "Yes · 31 consec." and Rs. amounts) fit; every cell still wraps.
const COLS_BASE = [8, 42, 14, 24, 22, 28, 22, 26] as const; // no Common bill
const COLS_COMMON = [7, 30, 12, 24, 20, 20, 26, 22, 25] as const; // + Common bill
const M = 12, BOTTOM = 282, LINE = 4.6;
const W = 186;
export const poolingDraftPdfLayout = (showCommon: boolean) => {
  const cols = showCommon ? COLS_COMMON : COLS_BASE;
  const xs = (cols as readonly number[]).reduce<number[]>((a, w, i) => { a.push(i ? a[i - 1] + (cols as readonly number[])[i - 1] : M); return a; }, []);
  const headers = showCommon
    ? ['Sl', 'Member', 'Ate', 'Mess cut', 'Pool share', COMMON_BILL_LABEL, 'Special', 'Admin added', 'Total']
    : ['Sl', 'Member', 'Ate', 'Mess cut', 'Pool share', 'Special', 'Admin added', 'Total'];
  return { cols, xs, headers };
};

const wrap = (doc: any, text: string, width: number): string[] => {
  const raw = String(text ?? '');
  const lines: string[] = doc.splitTextToSize(raw, Math.max(4, width - 2));
  return lines.length ? lines : [''];
};

/** Renders onto any jsPDF-compatible doc (tests pass a recorder). Multi-page; every cell wraps, never overflows the next column. */
export function renderPoolingDraftPdf(doc: any, m: DraftPdfModel, generatedAt: string) {
  const showCommon = m.rows.some(r => (r.commonBill || 0) > 0);
  const { cols, xs, headers } = poolingDraftPdfLayout(showCommon);
  const header = () => {
    doc.setTextColor(...BRAND_GREEN); doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.text('GO CANTEEN', 105, 14, { align: 'center' });
    doc.setTextColor(0, 0, 0); doc.setFontSize(11); doc.text(m.canteenName, 105, 21, { align: 'center' });
    doc.setFontSize(12); doc.text(m.title, 105, 28, { align: 'center' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.text(m.subtitle, 105, 34, { align: 'center' }); doc.text(`Generated: ${generatedAt}`, 105, 39, { align: 'center' });
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
    const headLines = headers.map((t, i) => wrap(doc, t, cols[i]));
    const headH = Math.max(8, Math.max(...headLines.map(l => l.length)) * LINE + 3);
    const y = 45; doc.setFillColor(245, 247, 246); doc.rect(M, y, W, headH, 'F');
    headLines.forEach((ls, i) => ls.forEach((line, k) => doc.text(line, xs[i] + 1, y + 4 + k * LINE)));
    doc.setFont('helvetica', 'normal'); return y + headH + 2;
  };
  let y = header();
  m.rows.forEach((r, i) => {
    const specialTxt = r.specialPending && !(r.special) ? 'amount pending' : (r.specialPending ? `${rsPdf(r.special)} pending` : rsPdf(r.special));
    const money = showCommon
      ? [rsPdf(r.share), rsPdf(r.commonBill || 0), specialTxt, rsPdf(r.adminAdded), rsPdf(r.total)]
      : [rsPdf(r.share), specialTxt, rsPdf(r.adminAdded), rsPdf(r.total)];
    const cells = [String(i + 1), r.name, r.days, r.messCut, ...money];
    const lines = cells.map((c, j) => wrap(doc, c, cols[j]));
    const h = Math.max(1, ...lines.map(l => l.length)) * LINE + 2;
    if (y + h > BOTTOM) { doc.addPage(); y = header(); }
    lines.forEach((ls, j) => ls.forEach((line, k) => doc.text(line, xs[j] + 1, y + 3.5 + k * LINE)));
    doc.setDrawColor(220, 220, 220); doc.line(M, y + h, M + W, y + h); y += h;
  });
  const footerLines = [`Expenses: ${rsPdf(m.foodExpense ?? 0)}`];
  if ((m.commonExpense || 0) > 0) footerLines.push(`Common bill: ${rsPdf(m.commonExpense)}`);
  if ((m.specialExpense || 0) > 0) footerLines.push(`Special expenses: ${rsPdf(m.specialExpense)}`);
  footerLines.push(`Total expenses: ${rsPdf(m.expenseTotal)}`);
  const footerH = footerLines.length * 5 + 22;
  if (y + footerH > BOTTOM) { doc.addPage(); y = header(); }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); y += 6;
  footerLines.forEach((line, i) => {
    doc.text(line, M, y);
    if (i === footerLines.length - 1) doc.text(`Bill total: ${rsPdf(m.billTotal)}`, M + W, y, { align: 'right' });
    y += 5;
  });
  if (m.unallocated > 0) { doc.text(`Unallocated: ${rsPdf(m.unallocated)}`, M, y); y += 5; }
  for (const note of m.pendingNotes || []) { y += 5; if (y > BOTTOM) { doc.addPage(); y = header(); } doc.setTextColor(153, 27, 27); doc.text(note, M, y); doc.setTextColor(0, 0, 0); }
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
