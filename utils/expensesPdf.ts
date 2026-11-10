// Monthly expenses PDF (Pooling Finance → Expenses, read-only). Same jsPDF + deliverPdf path as bills/pooling drafts.
import { jsPDF } from 'jspdf';
import { deliverPdf } from './pdfLegacy';

const BRAND_GREEN = [5, 150, 105] as const;
export const rsExpense = (n: number) => `Rs.${Number(n).toFixed(2)}`;
export const expenseMonthLabel = (year: number, month: number) =>
  new Date(Date.UTC(year, month - 1, 1)).toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
export const displayExpenseDate = (iso: string) => {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
};

export interface ExpensePdfItem {
  expense_date: string;
  description?: string;
  amount: number;
  added_by?: string;
  created_by?: string;
  category?: string;
}
export interface ExpensePdfRow { date: string; description: string; amount: number; addedBy?: string }
export interface ExpensePdfModel {
  canteenName: string;
  monthLabel: string;
  year: number;
  month: number;
  rows: ExpensePdfRow[];
  total: number;
  empty: boolean;
  filename: string;
}

export function buildExpensesPdfModel(canteenName: string, year: number, month: number, items: ExpensePdfItem[]): ExpensePdfModel {
  const key = `${year}-${String(month).padStart(2, '0')}`;
  const rows = items
    .filter(x => String(x.expense_date || '').startsWith(key))
    .sort((a, b) => String(a.expense_date).localeCompare(String(b.expense_date)))
    .map(x => ({
      date: displayExpenseDate(x.expense_date),
      description: (x.description || x.category || '').trim() || '—',
      amount: Number(x.amount) || 0,
      addedBy: (x.added_by || x.created_by || '').trim() || undefined,
    }));
  return {
    canteenName: canteenName || 'Go Canteen',
    monthLabel: expenseMonthLabel(year, month),
    year,
    month,
    rows,
    total: rows.reduce((s, r) => s + r.amount, 0),
    empty: rows.length === 0,
    filename: `GoCanteen-Expenses-${year}-${String(month).padStart(2, '0')}.pdf`,
  };
}

const M = 12, BOTTOM = 282, LINE = 4.6, W = 186;

export function renderExpensesPdf(doc: any, model: ExpensePdfModel, generatedAt: string) {
  const showWho = model.rows.some(r => r.addedBy);
  const cols = showWho ? [14, 32, 78, 36, 26] : [14, 36, 100, 36];
  const xs = cols.reduce<number[]>((a, w, i) => { a.push(i ? a[i - 1] + cols[i - 1] : M); return a; }, []);
  const headers = showWho ? ['Sl', 'Date', 'Description', 'Added by', 'Amount'] : ['Sl', 'Date', 'Description', 'Amount'];
  const header = () => {
    doc.setTextColor(...BRAND_GREEN); doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.text('GO CANTEEN', 105, 14, { align: 'center' });
    doc.setTextColor(0, 0, 0); doc.setFontSize(11); doc.text(model.canteenName, 105, 21, { align: 'center' });
    doc.setFontSize(12); doc.text(`EXPENSES — ${model.monthLabel}`, 105, 28, { align: 'center' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.text(`Generated: ${generatedAt}`, 105, 34, { align: 'center' });
    if (model.empty) return 42;
    let y = 40; doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setFillColor(245, 247, 246); doc.rect(M, y, W, 8, 'F');
    headers.forEach((t, i) => doc.text(t, xs[i] + 1, y + 5.5));
    doc.setFont('helvetica', 'normal'); return y + 10;
  };
  let y = header();
  if (model.empty) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(11);
    doc.text('No expenses for this month.', 105, y + 8, { align: 'center' });
    return doc;
  }
  model.rows.forEach((r, i) => {
    const descLines: string[] = doc.splitTextToSize(r.description, cols[2] - 2);
    const whoLines: string[] = showWho ? doc.splitTextToSize(r.addedBy || '—', (cols[3] || 36) - 2) : [];
    const h = Math.max(1, descLines.length, whoLines.length || 1) * LINE + 2;
    if (y + h > BOTTOM) { doc.addPage(); y = header(); }
    const cells = showWho
      ? [String(i + 1), r.date, descLines, whoLines, rsExpense(r.amount)]
      : [String(i + 1), r.date, descLines, rsExpense(r.amount)];
    cells.forEach((c, j) => doc.text(c, xs[j] + 1, y + 3.5));
    doc.setDrawColor(220, 220, 220); doc.line(M, y + h, M + W, y + h); y += h;
  });
  if (y + 16 > BOTTOM) { doc.addPage(); y = header(); }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); y += 6;
  doc.text(`Total: ${rsExpense(model.total)}`, M + W, y, { align: 'right' });
  return doc;
}

export const expensesPdfAdapter = {
  async download(model: ExpensePdfModel) {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    renderExpensesPdf(doc, model, new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }));
    await deliverPdf(doc, model.filename);
  },
};
