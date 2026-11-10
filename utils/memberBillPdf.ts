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

export interface MemberBillItem { name: string; qty: number; unitPrice?: number; lineTotal?: number }
export interface MemberBillEntry {
  date: string;
  kind: 'member' | 'guest' | 'admin_order' | 'admin_amount';
  label: string;
  items: MemberBillItem[];
  amount?: number;
}
export interface MemberBillPdfOrder {
  date: string;
  status?: string;
  orderSource?: string;
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
}
export interface MemberBillPdfModel {
  canteenName: string;
  memberName: string;
  monthLabel: string;
  year: number;
  month: number;
  billingModel: 'standard' | 'pooling';
  entries: MemberBillEntry[];
  computedTotal: number;
  publishedTotal: number;
  reconciled: boolean;
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
  const entries: MemberBillEntry[] = [];
  let computed = 0;
  for (const o of orders.filter(o => String(o.date).startsWith(key) && o.status !== 'cancelled')) {
    const memberItems = catalog(o.items, o.itemNames, o.itemQuantities, o.itemPrices, withMoney);
    const guestItems = catalog(o.guestItems, o.guestItemNames, o.guestItemQuantities, o.guestItemPrices, withMoney);
    if (memberItems.length) {
      const label = o.orderSource === 'admin' ? 'Admin-placed order' : 'Member order';
      const kind = o.orderSource === 'admin' ? 'admin_order' as const : 'member' as const;
      entries.push({ date: o.date, kind, label, items: memberItems });
      if (withMoney) computed += memberItems.reduce((s, i) => s + money(i.lineTotal || 0), 0);
    }
    if (guestItems.length) {
      entries.push({ date: o.date, kind: 'guest', label: 'Guest order', items: guestItems });
      if (withMoney) computed += guestItems.reduce((s, i) => s + money(i.lineTotal || 0), 0);
    }
  }
  for (const a of adjustments.filter(a => String(a.adjustment_date).startsWith(key))) {
    const amount = money(a.amount);
    entries.push({
      date: a.adjustment_date,
      kind: 'admin_amount',
      label: amount < 0 ? 'Admin deduction' : 'Admin added',
      items: [],
      amount,
    });
    computed += amount;
  }
  entries.sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind));
  computed = money(computed);
  const publishedTotal = money(bill.total);
  return {
    canteenName: canteenName || 'Go Canteen',
    memberName: memberName || bill.member_name_snapshot || 'Member',
    monthLabel: monthLabel(year, month),
    year, month, billingModel, entries,
    computedTotal: computed,
    publishedTotal,
    reconciled: Math.abs(computed - publishedTotal) < 0.015,
    breakdown: {
      memberFood: money(bill.food_total - (bill.guest_food_total || 0)),
      guestFood: money(bill.guest_food_total || 0),
      adminAdded: money(bill.admin_added_total || 0),
      specials: money(bill.special_items_total || 0),
    },
    filename: `GoCanteen-Bill-${year}-${String(month).padStart(2, '0')}.pdf`,
  };
}

export function renderMemberBillPdf(doc: any, model: MemberBillPdfModel, generatedAt: string) {
  const M = 14, W = 182, BOTTOM = 282, LINE = 5;
  const header = () => {
    doc.setTextColor(...BRAND_GREEN); doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.text('GO CANTEEN', 105, 14, { align: 'center' });
    doc.setTextColor(0, 0, 0); doc.setFontSize(11); doc.text(model.canteenName, 105, 21, { align: 'center' });
    doc.setFontSize(12); doc.text(`MONTHLY BILL — ${model.monthLabel}`, 105, 28, { align: 'center' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    doc.text(model.memberName, 105, 34, { align: 'center' });
    doc.text(`Generated: ${generatedAt}`, 105, 39, { align: 'center' });
    return 46;
  };
  let y = header();
  const ensure = (h: number) => { if (y + h > BOTTOM) { doc.addPage(); y = header(); } };
  let currentDate = '';
  let dayTotal = 0;
  const flushDay = () => {
    if (model.billingModel === 'standard' && currentDate && dayTotal) {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
      doc.text(`Day total: ${formatSignedRupees(dayTotal).replace('−₹', '-Rs.').replace('₹', 'Rs.')}`, M + W, y, { align: 'right' });
      y += 6;
    }
    dayTotal = 0;
  };
  const rs = (n: number) => formatSignedRupees(n).replace('−₹', '-Rs.').replace('₹', 'Rs.');
  for (const e of model.entries) {
    if (e.date !== currentDate) {
      if (currentDate) flushDay();
      currentDate = e.date;
      ensure(10);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.text(displayDate(e.date), M, y); y += 6;
    }
    ensure(8);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.text(e.label, M, y); y += 5;
    if (e.kind === 'admin_amount') {
      doc.setFont('helvetica', 'normal');
      doc.text(rs(e.amount || 0), M + W, y - 5, { align: 'right' });
      dayTotal += money(e.amount || 0);
    }
    e.items.forEach(item => {
      ensure(LINE + 1);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
      const left = `${item.name}  × ${item.qty}`;
      doc.text(left, M + 2, y);
      if (model.billingModel === 'standard') {
        doc.text(`${rs(item.unitPrice || 0)}  ${rs(item.lineTotal || 0)}`, M + W, y, { align: 'right' });
        dayTotal += money(item.lineTotal || 0);
      }
      y += LINE;
    });
    y += 1;
  }
  if (currentDate) flushDay();
  ensure(36);
  y += 4;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
  if (model.billingModel === 'pooling') {
    doc.text(`Pool share: ${rs(model.breakdown.memberFood)}`, M, y); y += 5;
    if (model.breakdown.specials) { doc.text(`Special items: ${rs(model.breakdown.specials)}`, M, y); y += 5; }
    doc.text(`Admin added: ${rs(model.breakdown.adminAdded)}`, M, y); y += 5;
  } else {
    doc.text(`Computed lines: ${rs(model.computedTotal)}`, M, y); y += 5;
  }
  doc.setFontSize(12);
  doc.text(`Published total: ${rs(model.publishedTotal)}`, M, y); y += 6;
  if (!model.reconciled && model.billingModel === 'standard') {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
    doc.text('If line items differ from the published total, the published amount is authoritative.', M, y);
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
