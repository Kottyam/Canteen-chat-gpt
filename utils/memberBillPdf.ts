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

const isoDay = (year: number, month: number, day: number) =>
  `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
const monthLastDay = (year: number, month: number) => isoDay(year, month, new Date(Date.UTC(year, month, 0)).getUTCDate());
function includedInPublishedBill(date: string, createdAt: string | undefined, bill: MemberBillPdfBill, year: number, month: number) {
  const start = String(bill.billing_start_date || isoDay(year, month, 1)).slice(0, 10);
  const end = String(bill.billing_end_date || monthLastDay(year, month)).slice(0, 10);
  const day = String(date || '').slice(0, 10);
  if (!day || day < start || day > end) return false;
  if (!bill.published_at) return true;
  if (!createdAt) return true;
  const created = Date.parse(createdAt);
  const published = Date.parse(bill.published_at);
  if (!Number.isFinite(created) || !Number.isFinite(published)) return true;
  return created <= published;
}


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
  createdAt?: string;
  items?: Record<string, boolean>;
  itemNames?: Record<string, string>;
  itemQuantities?: Record<string, number>;
  itemPrices?: Record<string, number>;
  guestItems?: Record<string, boolean>;
  guestItemNames?: Record<string, string>;
  guestItemQuantities?: Record<string, number>;
  guestItemPrices?: Record<string, number>;
}
export interface MemberBillPdfAdjustment { adjustment_date: string; amount: number; description?: string; created_at?: string }
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
  published_at?: string | null;
  billing_start_date?: string | null;
  billing_end_date?: string | null;
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
  const withMoney = billingModel === 'standard';
  const resolvedName = memberName || bill.member_name_snapshot || 'Member';
  const entries: MemberBillEntry[] = [];
  let computed = 0;
  for (const o of orders.filter(o => o.status !== 'cancelled' && includedInPublishedBill(o.date, o.createdAt, bill, year, month))) {
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
  for (const a of adjustments.filter(a => includedInPublishedBill(a.adjustment_date, a.created_at, bill, year, month))) {
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
  let dateSno = 0;
  const byDate = new Map<string, MemberBillEntry[]>();
  for (const e of entries) {
    const list = byDate.get(e.date) || [];
    list.push(e);
    byDate.set(e.date, list);
  }
  for (const date of [...byDate.keys()].sort()) {
    dateSno += 1;
    let dayTotal = 0;
    for (const e of byDate.get(date)!) {
      if (e.kind === 'admin_amount') {
        const amt = money(e.amount || 0);
        rows.push({
          kind: 'item',
          sno: dateSno,
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
        const amt = withMoney ? money(item.lineTotal || 0) : null;
        rows.push({
          kind: 'item',
          sno: dateSno,
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
    rows.push({ kind: 'day_subtotal', sno: dateSno, date: displayDate(date), item: 'Day subtotal', amount: withMoney ? money(dayTotal) : null });
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

  const drawTableHeader = (yy: number) => {
    const h = 8;
    doc.setFillColor(209, 250, 229);
    doc.setDrawColor(167, 243, 208);
    doc.setLineWidth(0.25);
    doc.rect(M, yy, width, h, 'FD');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(6, 95, 70);
    headers.forEach((label, i) => {
      doc.text(label, xs[i] + cols[i] / 2, yy + 5.4, { align: 'center' });
    });
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'normal');
    return yy + h;
  };

  let y = drawTableHeader(drawTitle());
  let itemBand = 0;
  const newPage = () => { doc.addPage(); y = drawTableHeader(drawTitle()); };

  const detailValues = (row: MemberBillTableRow) => {
    const amount = row.amount == null ? '' : pdfMoney(row.amount);
    return showAmount
      ? [row.name || '', row.orderType || '', row.item || '', row.qty || '', amount]
      : [row.name || '', row.orderType || '', row.item || '', row.qty || ''];
  };

  const rowHeight = (row: MemberBillTableRow) => {
    const values = [row.sno ? String(row.sno) : '', row.date || '', ...detailValues(row)];
    const maxLines = Math.max(1, ...values.map((value, i) => linesOf(doc, value, cols[i]).length));
    return Math.max(7.2, maxLines * ROW_LINE + 3);
  };

  const fillFor = (row: MemberBillTableRow) => {
    if (row.kind === 'grand_total') doc.setFillColor(209, 250, 229);
    else if (row.kind === 'day_subtotal' || row.kind === 'adjustment') doc.setFillColor(243, 244, 246);
    else if (itemBand % 2 === 1) doc.setFillColor(249, 250, 251);
    else doc.setFillColor(255, 255, 255);
  };

  const drawDetailRow = (row: MemberBillTableRow) => {
    const h = rowHeight(row);
    fillFor(row);
    if (row.kind === 'item') itemBand += 1;
    doc.setDrawColor(229, 231, 235);
    doc.setLineWidth(0.2);
    const values = detailValues(row);
    const special = row.kind !== 'item';
    values.forEach((value, vi) => {
      const i = vi + 2;
      doc.rect(xs[i], y, cols[i], h, 'FD');
      const right = showAmount && i === cols.length - 1 && value !== '';
      const cellLines = linesOf(doc, value, cols[i]);
      const totalH = cellLines.length * ROW_LINE;
      const startY = y + (h - totalH) / 2 + 3.3;
      doc.setFont('helvetica', special ? 'bold' : 'normal');
      doc.setFontSize(special ? 7.6 : 7.2);
      cellLines.forEach((line, li) => {
        doc.text(line, right ? xs[i] + cols[i] - 2 : xs[i] + 1.4, startY + li * ROW_LINE, right ? { align: 'right' } : undefined);
      });
    });
    y += h;
  };

  const drawMerge = (top: number, h: number, sno?: number, date?: string) => {
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(229, 231, 235);
    doc.setLineWidth(0.2);
    doc.rect(xs[0], top, cols[0], h, 'FD');
    doc.rect(xs[1], top, cols[1], h, 'FD');
    const write = (text: string, col: number, size: number) => {
      const cellLines = linesOf(doc, text, cols[col]);
      const totalH = cellLines.length * ROW_LINE;
      const startY = top + (h - totalH) / 2 + 3.3;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(size);
      cellLines.forEach((line, li) => {
        doc.text(line, xs[col] + cols[col] / 2, startY + li * ROW_LINE, { align: 'center' });
      });
    };
    write(sno ? String(sno) : '', 0, 8);
    write(date || '', 1, 7.6);
  };

  const drawStandalone = (row: MemberBillTableRow) => {
    const h = rowHeight(row);
    if (y + h > PAGE_BOTTOM) newPage();
    fillFor(row);
    doc.setDrawColor(229, 231, 235);
    doc.setLineWidth(0.2);
    doc.rect(M, y, width, h, 'FD');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
    doc.text(row.item || '', M + 2, y + h / 2 + 1.2);
    if (showAmount && row.amount != null) doc.text(pdfMoney(row.amount), M + width - 2, y + h / 2 + 1.2, { align: 'right' });
    y += h;
  };

  const drawDateGroup = (items: MemberBillTableRow[], subtotal?: MemberBillTableRow) => {
    let queue = items.slice();
    let sub = subtotal;
    while (queue.length || sub) {
      const heights = queue.map(rowHeight);
      let fit = 0, used = 0;
      for (let i = 0; i < queue.length; i++) {
        if (y + used + heights[i] > PAGE_BOTTOM) break;
        used += heights[i];
        fit += 1;
      }
      if (fit === 0 && queue.length) { newPage(); continue; }
      if (!queue.length && sub) {
        const sh = rowHeight(sub);
        if (y + sh > PAGE_BOTTOM) { newPage(); continue; }
        const top = y;
        drawDetailRow(sub);
        drawMerge(top, y - top, sub.sno, sub.date);
        sub = undefined;
        continue;
      }
      let takeSub = false;
      if (fit === queue.length && sub) {
        takeSub = y + used + rowHeight(sub) <= PAGE_BOTTOM;
      }
      const chunk = queue.slice(0, fit);
      queue = queue.slice(fit);
      const top = y;
      chunk.forEach(row => drawDetailRow(row));
      if (takeSub && sub) { drawDetailRow(sub); sub = undefined; }
      drawMerge(top, y - top, chunk[0].sno, chunk[0].date);
    }
  };

  let current: { items: MemberBillTableRow[]; subtotal?: MemberBillTableRow } | null = null;
  const flush = () => { if (current) { drawDateGroup(current.items, current.subtotal); current = null; } };
  for (const row of model.rows) {
    if (row.kind === 'item') {
      if (!current) current = { items: [] };
      current.items.push(row);
    } else if (row.kind === 'day_subtotal') {
      if (!current) current = { items: [] };
      current.subtotal = row;
      flush();
    } else {
      flush();
      drawStandalone(row);
    }
  }
  flush();

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
