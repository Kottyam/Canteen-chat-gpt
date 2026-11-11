import { jsPDF } from 'jspdf';
import { deliverPdf } from './pdfLegacy';
import { formatSignedRupees } from './moneyDisplay';

const BRAND_GREEN = [5, 150, 105] as const;
const monthLabel = (year: number, month: number) =>
  new Date(Date.UTC(year, month - 1, 1)).toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const displayDate = (iso: string) => {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
};
const money = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const pdfMoney = (n: number) => formatSignedRupees(n).replace('−₹', '-Rs.').replace('₹', 'Rs.');

export interface MemberBillItem { name: string; qty: number; unitPrice?: number; lineTotal?: number }
export interface MemberBillEntry {
  date: string;
  kind: 'member' | 'guest' | 'admin_order' | 'admin_amount';
  label: string;
  items: MemberBillItem[];
  amount?: number;
  displayName?: string;
  description?: string;
}
export interface MemberBillPdfOrder {
  date: string;
  status?: string;
  orderSource?: string;
  guestName?: string;
  items?: Record<string, boolean>;
  itemNames?: Record<string, string>;
  itemQuantities?: Record<string, number>;
  itemPrices?: Record<string, number>;
  guestItems?: Record<string, boolean>;
  guestItemNames?: Record<string, string>;
  guestItemQuantities?: Record<string, number>;
  guestItemPrices?: Record<string, number>;
}
export interface MemberBillPdfAdjustment { adjustment_date: string; amount: number; description?: string }
export interface MemberBillPdfBill {
  bill_year: number;
  bill_month: number;
  food_total: number;
  guest_food_total: number;
  admin_added_total: number;
  special_items_total?: number;
  total: number;
  member_name_snapshot?: string | null;
  published?: boolean;
}
export type MemberBillRowKind = 'item' | 'day_subtotal' | 'adjustment' | 'grand_total';
export interface MemberBillTableRow {
  kind: MemberBillRowKind;
  sno?: number;
  date?: string;
  name?: string;
  orderType?: string;
  item?: string;
  qty?: string;
  amount?: number | null;
}
export interface MemberBillPdfModel {
  canteenName: string;
  memberName: string;
  monthLabel: string;
  year: number;
  month: number;
  billingModel: 'standard' | 'pooling';
  billStatus: string;
  entries: MemberBillEntry[];
  rows: MemberBillTableRow[];
  computedTotal: number;
  publishedTotal: number;
  reconciled: boolean;
  roundingAdjustment: number;
  breakdown: { memberFood: number; guestFood: number; adminAdded: number; specials: number };
  filename: string;
}

function catalog(flags: Record<string, boolean> | undefined, names: Record<string, string> | undefined, qtys: Record<string, number> | undefined, prices: Record<string, number> | undefined, withMoney: boolean): MemberBillItem[] {
  return Object.keys(flags || {}).filter(k => flags![k]).map(code => {
    const qty = Math.max(1, Number(qtys?.[code] || 1));
    const unitPrice = money(prices?.[code] || 0);
    return { name: names?.[code] || code, qty, ...(withMoney ? { unitPrice, lineTotal: money(unitPrice * qty) } : {}) };
  });
}

function orderTypeFor(kind: MemberBillEntry['kind'], amount?: number) {
  if (kind === 'admin_order') return 'Admin order';
  if (kind === 'guest') return 'Guest order';
  if (kind === 'admin_amount') return (amount || 0) < 0 ? 'Admin deduction' : 'Admin added';
  return 'Member order';
}

export function buildMemberBillPdfModel(
  bill: MemberBillPdfBill,
  orders: MemberBillPdfOrder[],
  adjustments: MemberBillPdfAdjustment[],
  canteenName: string,
  memberName: string,
  billingModel: 'standard' | 'pooling',
): MemberBillPdfModel {
  const year = bill.bill_year, month = bill.bill_month;
  const key = `${year}-${String(month).padStart(2, '0')}`;
  const withMoney = billingModel === 'standard';
  const resolvedName = memberName || bill.member_name_snapshot || 'Member';
  const entries: MemberBillEntry[] = [];
  let computed = 0;
  for (const o of orders.filter(o => String(o.date).startsWith(key) && o.status !== 'cancelled')) {
    const memberItems = catalog(o.items, o.itemNames, o.itemQuantities, o.itemPrices, withMoney);
    const guestItems = catalog(o.guestItems, o.guestItemNames, o.guestItemQuantities, o.guestItemPrices, withMoney);
    if (memberItems.length) {
      const kind = o.orderSource === 'admin' ? 'admin_order' as const : 'member' as const;
      entries.push({ date: o.date, kind, label: orderTypeFor(kind), items: memberItems, displayName: resolvedName });
      if (withMoney) computed += memberItems.reduce((s, i) => s + money(i.lineTotal || 0), 0);
    }
    if (guestItems.length) {
      const guestName = String(o.guestName || '').trim() || 'Guest';
      entries.push({ date: o.date, kind: 'guest', label: 'Guest order', items: guestItems, displayName: guestName });
      if (withMoney) computed += guestItems.reduce((s, i) => s + money(i.lineTotal || 0), 0);
    }
  }
  for (const a of adjustments.filter(a => String(a.adjustment_date).startsWith(key))) {
    const amount = money(a.amount);
    entries.push({
      date: a.adjustment_date,
      kind: 'admin_amount',
      label: orderTypeFor('admin_amount', amount),
      items: [],
      amount,
      displayName: resolvedName,
      description: (a.description || '').trim(),
    });
    if (withMoney) computed += amount;
  }
  const kindRank: Record<MemberBillEntry['kind'], number> = { member: 0, admin_order: 1, guest: 2, admin_amount: 3 };
  entries.sort((a, b) => a.date.localeCompare(b.date) || kindRank[a.kind] - kindRank[b.kind]);
  computed = money(computed);
  const publishedTotal = money(bill.total);
  const rows: MemberBillTableRow[] = [];
  let sno = 0;
  const byDate = new Map<string, MemberBillEntry[]>();
  for (const e of entries) {
    const list = byDate.get(e.date) || [];
    list.push(e);
    byDate.set(e.date, list);
  }
  for (const date of [...byDate.keys()].sort()) {
    let dayTotal = 0;
    for (const e of byDate.get(date)!) {
      if (e.kind === 'admin_amount') {
        sno += 1;
        const amt = money(e.amount || 0);
        rows.push({
          kind: 'item',
          sno,
          date: displayDate(date),
          name: e.displayName || resolvedName,
          orderType: e.label,
          item: e.description || e.label,
          qty: '—',
          amount: withMoney ? amt : null,
        });
        if (withMoney) dayTotal += amt;
        continue;
      }
      for (const item of e.items) {
        sno += 1;
        const amt = withMoney ? money(item.lineTotal || 0) : null;
        rows.push({
          kind: 'item',
          sno,
          date: displayDate(date),
          name: e.displayName || resolvedName,
          orderType: e.label,
          item: item.name,
          qty: String(item.qty),
          amount: amt,
        });
        if (withMoney) dayTotal += money(item.lineTotal || 0);
      }
    }
    if (withMoney) {
      rows.push({ kind: 'day_subtotal', date: displayDate(date), item: 'Day subtotal', amount: money(dayTotal) });
    }
  }
  const roundingAdjustment = withMoney ? money(publishedTotal - computed) : 0;
  if (withMoney && Math.abs(roundingAdjustment) >= 0.015) {
    rows.push({
      kind: 'adjustment',
      item: 'Adjustment / rounding (published total is authoritative)',
      amount: roundingAdjustment,
    });
  }
  rows.push({ kind: 'grand_total', item: 'Grand total', amount: publishedTotal });

  return {
    canteenName: canteenName || 'Go Canteen',
    memberName: resolvedName,
    monthLabel: monthLabel(year, month),
    year, month, billingModel,
    billStatus: 'Published',
    entries,
    rows,
    computedTotal: withMoney ? computed : publishedTotal,
    publishedTotal,
    reconciled: withMoney ? Math.abs(computed - publishedTotal) < 0.015 : true,
    roundingAdjustment: withMoney && Math.abs(roundingAdjustment) >= 0.015 ? roundingAdjustment : 0,
    breakdown: {
      memberFood: money(bill.food_total - (bill.guest_food_total || 0)),
      guestFood: money(bill.guest_food_total || 0),
      adminAdded: money(bill.admin_added_total || 0),
      specials: money(bill.special_items_total || 0),
    },
    filename: `GoCanteen-Bill-${year}-${String(month).padStart(2, '0')}.pdf`,
  };
}

const M = 12;
const PAGE_BOTTOM = 278;
const PAGE_W = 186;
const ROW_LINE = 4.2;

function colLayout(showAmount: boolean) {
  const cols = showAmount ? [12, 26, 30, 28, 48, 14, 28] : [14, 28, 34, 32, 62, 16];
  const xs = cols.reduce<number[]>((a, w, i) => { a.push(i ? a[i - 1] + cols[i - 1] : M); return a; }, []);
  const headers = showAmount
    ? ['S.No', 'Date', 'Name', 'Order type', 'Item', 'Qty', 'Amount']
    : ['S.No', 'Date', 'Name', 'Order type', 'Item', 'Qty'];
  return { cols, xs, headers, width: cols.reduce((s, w) => s + w, 0) };
}

function linesOf(doc: any, text: string, width: number) {
  return doc.splitTextToSize(String(text ?? ''), Math.max(6, width - 3)) as string[];
}

export function renderMemberBillPdf(doc: any, model: MemberBillPdfModel, generatedAt: string) {
  const showAmount = model.billingModel === 'standard';
  const { cols, xs, headers, width } = colLayout(showAmount);

  const drawTitle = () => {
    doc.setTextColor(...BRAND_GREEN); doc.setFont('helvetica', 'bold'); doc.setFontSize(18);
    doc.text('GO CANTEEN', 105, 14, { align: 'center' });
    doc.setTextColor(0, 0, 0); doc.setFontSize(11); doc.text(model.canteenName, 105, 21, { align: 'center' });
    doc.setFontSize(12); doc.text(`MONTHLY BILL — ${model.monthLabel}`, 105, 28, { align: 'center' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    doc.text(`Member: ${model.memberName}`, 105, 34, { align: 'center' });
    doc.text(`Status: ${model.billStatus}`, 105, 39, { align: 'center' });
    doc.text(`Generated: ${generatedAt}`, 105, 44, { align: 'center' });
    return 50;
  };

  const drawTableHeader = (y: number) => {
    const h = 8;
    doc.setFillColor(209, 250, 229);
    doc.setDrawColor(167, 243, 208);
    doc.setLineWidth(0.25);
    doc.rect(M, y, width, h, 'FD');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(6, 95, 70);
    headers.forEach((label, i) => {
      const right = showAmount && i === headers.length - 1;
      doc.text(label, right ? xs[i] + cols[i] - 2 : xs[i] + 1.4, y + 5.4, right ? { align: 'right' } : undefined);
    });
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'normal');
    return y + h;
  };

  let y = drawTableHeader(drawTitle());
  let itemBand = 0;

  const newPage = () => {
    doc.addPage();
    y = drawTableHeader(drawTitle());
  };

  const rowHeight = (row: MemberBillTableRow) => {
    const values = showAmount
      ? [row.sno ? String(row.sno) : '', row.date || '', row.name || '', row.orderType || '', row.item || '', row.qty || '', row.amount == null ? '' : pdfMoney(row.amount)]
      : [row.sno ? String(row.sno) : '', row.date || '', row.name || '', row.orderType || '', row.item || '', row.qty || ''];
    const maxLines = Math.max(1, ...values.map((value, i) => linesOf(doc, value, cols[i]).length));
    return Math.max(7.2, maxLines * ROW_LINE + 3);
  };

  const drawRow = (row: MemberBillTableRow) => {
    const h = rowHeight(row);
    if (y + h > PAGE_BOTTOM) newPage();
    const special = row.kind !== 'item';
    if (row.kind === 'grand_total') doc.setFillColor(209, 250, 229);
    else if (row.kind === 'day_subtotal' || row.kind === 'adjustment') doc.setFillColor(243, 244, 246);
    else if (itemBand % 2 === 1) doc.setFillColor(249, 250, 251);
    else doc.setFillColor(255, 255, 255);
    if (row.kind === 'item') itemBand += 1;
    doc.setDrawColor(229, 231, 235);
    doc.setLineWidth(0.2);
    doc.rect(M, y, width, h, 'FD');
    const values = showAmount
      ? [row.sno ? String(row.sno) : '', row.date || '', row.name || '', row.orderType || '', row.item || '', row.qty || '', row.amount == null ? '' : pdfMoney(row.amount)]
      : [row.sno ? String(row.sno) : '', row.date || '', row.name || '', row.orderType || '', row.item || '', row.qty || ''];
    doc.setFont('helvetica', special ? 'bold' : 'normal');
    doc.setFontSize(special ? 7.6 : 7.2);
    values.forEach((value, i) => {
      const cellLines = linesOf(doc, value, cols[i]);
      const right = showAmount && i === values.length - 1;
      const totalH = cellLines.length * ROW_LINE;
      const startY = y + (h - totalH) / 2 + 3.3;
      cellLines.forEach((line, li) => {
        doc.text(line, right ? xs[i] + cols[i] - 2 : xs[i] + 1.4, startY + li * ROW_LINE, right ? { align: 'right' } : undefined);
      });
    });
    y += h;
  };

  for (const row of model.rows) drawRow(row);

  if (model.billingModel === 'pooling') {
    const boxH = 28 + (model.breakdown.specials ? 5 : 0) + (model.breakdown.guestFood ? 5 : 0);
    if (y + boxH > PAGE_BOTTOM) newPage();
    y += 6;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
    doc.text('Published bill breakdown', M, y); y += 6;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    doc.text(`Pool share: ${pdfMoney(model.breakdown.memberFood)}`, M, y); y += 5;
    if (model.breakdown.guestFood) { doc.text(`Guest share: ${pdfMoney(model.breakdown.guestFood)}`, M, y); y += 5; }
    if (model.breakdown.specials) { doc.text(`Special items: ${pdfMoney(model.breakdown.specials)}`, M, y); y += 5; }
    doc.text(`Admin added: ${pdfMoney(model.breakdown.adminAdded)}`, M, y); y += 5;
    doc.setFont('helvetica', 'bold');
    doc.text(`Grand total: ${pdfMoney(model.publishedTotal)}`, M, y); y += 6;
  }

  if (!model.reconciled && model.billingModel === 'standard') {
    if (y + 10 > PAGE_BOTTOM) newPage();
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
    doc.text('An adjustment / rounding row is included so the grand total equals the published bill amount,', M, y + 4);
    doc.text('which stays authoritative.', M, y + 8);
  }

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(107, 114, 128);
    doc.text(`Page ${i} of ${pages}`, 105, 290, { align: 'center' });
    doc.setTextColor(0, 0, 0);
  }
  return doc;
}

export const memberBillPdfAdapter = {
  async download(model: MemberBillPdfModel) {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    renderMemberBillPdf(doc, model, new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }));
    await deliverPdf(doc, model.filename);
  },
};
