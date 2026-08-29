import { jsPDF } from 'jspdf';
import { Order, Prices, User } from '../types';

const fallbackNames: Record<string, string> = {
  morningTea: 'Morning Tea',
  lunchMeals: 'Meals',
  lunchEgg: 'Egg',
  lunchFishMeat: 'Fish/Meat',
  eveningTea: 'Evening Tea',
};

export function orderTotal(order: Order, prices: Prices) {
  return Object.keys(order.items).reduce((sum, key) => {
    if (!order.items[key]) return sum;
    return sum + Number(order.itemPrices?.[key] ?? (key in prices ? prices[key as keyof Prices] : 0));
  }, 0);
}

export function orderText(order: Order) {
  return Object.keys(order.items)
    .filter(key => order.items[key])
    .map(key => order.itemNames?.[key] || fallbackNames[key] || key)
    .join(', ') || 'No items';
}

function addWrappedText(doc: jsPDF, text: string, x: number, y: number, maxWidth: number, lineHeight = 5) {
  const lines = doc.splitTextToSize(text, maxWidth) as string[];
  doc.text(lines, x, y);
  return y + lines.length * lineHeight;
}

function addPageIfNeeded(doc: jsPDF, y: number, required = 10) {
  if (y + required > 282) {
    doc.addPage();
    return 18;
  }
  return y;
}

/**
 * Opens a native share sheet when Web Share supports PDF files. This lets
 * Android users choose Drive/Files/Print/etc. without storing the PDF in
 * Supabase. Browsers without file sharing fall back to a normal download.
 */
async function deliverPdf(doc: jsPDF, filename: string) {
  const blob = doc.output('blob');
  const file = new File([blob], filename, { type: 'application/pdf' });

  try {
    if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ title: filename, files: [file] });
      return;
    }
  } catch (error: any) {
    // User cancellation is not an error that should produce a scary message.
    if (error?.name === 'AbortError') return;
    console.warn('Native PDF share failed; falling back to download.', error);
  }

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.target = '_blank';
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export async function downloadDailyPdf(date: string, users: User[], orders: Order[], prices: Prices) {
  const doc = new jsPDF();
  const day = orders.filter(o => o.date === date);
  const counts: Record<string, number> = {};
  let grandTotal = 0;
  day.forEach(order => {
    Object.keys(order.items).forEach(key => {
      if (order.items[key]) counts[key] = (counts[key] || 0) + 1;
    });
    grandTotal += orderTotal(order, prices);
  });

  doc.setFontSize(18);
  doc.text('GoCanteen - Daily Order Report', 14, 18);
  doc.setFontSize(10);
  doc.text(`Date: ${date}`, 14, 26);
  let y = 36;
  doc.setFontSize(11);
  doc.text(`Employees / Orders: ${day.length}`, 14, y);
  y += 7;
  const countText = Object.keys(counts).map(key => `${fallbackNames[key] || key}: ${counts[key]}`).join('   ') || 'No items';
  y = addWrappedText(doc, countText, 14, y, 182);
  doc.setFontSize(12);
  doc.text(`Total Amount: Rs.${grandTotal.toFixed(2)}`, 14, y);
  y += 10;
  doc.setFontSize(10);

  day.forEach((order, index) => {
    y = addPageIfNeeded(doc, y, 22);
    const employee = users.find(user => user.id === order.employeeId);
    const employeeName = employee?.name || order.employeeId;
    doc.setFont('helvetica', 'bold');
    y = addWrappedText(doc, `${index + 1}. ${employeeName} | SR: ${order.employeeId}`, 14, y, 182);
    doc.setFont('helvetica', 'normal');
    y = addWrappedText(doc, `Items: ${orderText(order)}`, 18, y + 1, 178);
    doc.text(`Amount: Rs.${orderTotal(order, prices).toFixed(2)}`, 18, y + 1);
    y += 8;
  });

  await deliverPdf(doc, `GoCanteen-Daily-${date}.pdf`);
}

export async function downloadMonthlyPdf(month: number, year: number, users: User[], orders: Order[], prices: Prices) {
  const doc = new jsPDF();
  const monthName = new Date(year, month, 1).toLocaleString('en-IN', { month: 'long' });
  const employees = users.filter(user => user.role === 'employee');
  doc.setFontSize(18);
  doc.text('GoCanteen - Monthly Employee Report', 14, 18);
  doc.setFontSize(10);
  doc.text(`${monthName} ${year}`, 14, 26);
  let y = 36;
  let grandTotal = 0;

  employees.forEach((employee, index) => {
    const mine = orders.filter(order => {
      if (order.employeeId !== employee.id) return false;
      const date = new Date(`${order.date}T00:00:00`);
      return date.getMonth() === month && date.getFullYear() === year;
    });
    const total = mine.reduce((sum, order) => sum + orderTotal(order, prices), 0);
    grandTotal += total;
    y = addPageIfNeeded(doc, y, 25);
    doc.setFont('helvetica', 'bold');
    y = addWrappedText(doc, `${index + 1}. ${employee.name || '-'}`, 14, y, 182);
    doc.setFont('helvetica', 'normal');
    y = addWrappedText(doc, `SR Number: ${employee.id}   Mobile: ${employee.mobile || '-'}`, 14, y + 1, 182);
    doc.text(`Orders: ${mine.length}   Food Amount: Rs.${total.toFixed(2)}`, 14, y + 1);
    y += 9;
  });

  y = addPageIfNeeded(doc, y, 20);
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.text(`Monthly Total: Rs.${grandTotal.toFixed(2)}`, 14, y + 5);
  await deliverPdf(doc, `GoCanteen-Monthly-${year}-${String(month + 1).padStart(2, '0')}.pdf`);
}
