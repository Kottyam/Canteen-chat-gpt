import { jsPDF } from 'jspdf';
import { Order, Prices, User } from '../types';

export const itemNames: Record<keyof Order['items'], string> = {
  morningTea: 'Morning Tea',
  lunchMeals: 'Meals',
  lunchEgg: 'Egg',
  lunchFishMeat: 'Fish/Meat',
  eveningTea: 'Evening Tea',
};

export function orderTotal(order: Order, prices: Prices) {
  return (Object.keys(order.items) as (keyof Order['items'])[]).reduce(
    (sum, key) => sum + (order.items[key] ? prices[key] : 0),
    0
  );
}

export function orderText(order: Order) {
  return (
    (Object.keys(order.items) as (keyof Order['items'])[])
      .filter(key => order.items[key])
      .map(key => itemNames[key])
      .join(', ') || 'No items'
  );
}

function addWrappedText(
  doc: jsPDF,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight = 5
) {
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

export function downloadDailyPdf(
  date: string,
  users: User[],
  orders: Order[],
  prices: Prices
) {
  const doc = new jsPDF();
  const day = orders.filter(o => o.date === date);

  const counts = {
    morningTea: 0,
    lunchMeals: 0,
    lunchEgg: 0,
    lunchFishMeat: 0,
    eveningTea: 0,
  };

  let grandTotal = 0;

  day.forEach(order => {
    (Object.keys(counts) as (keyof typeof counts)[]).forEach(key => {
      if (order.items[key]) counts[key] += 1;
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

  doc.text(
    `Morning Tea: ${counts.morningTea}   Meals: ${counts.lunchMeals}   Egg: ${counts.lunchEgg}`,
    14,
    y
  );
  y += 6;

  doc.text(
    `Fish/Meat: ${counts.lunchFishMeat}   Evening Tea: ${counts.eveningTea}`,
    14,
    y
  );
  y += 7;

  doc.setFontSize(12);
  doc.text(`Total Amount: Rs.${grandTotal.toFixed(2)}`, 14, y);
  y += 10;

  doc.setFontSize(10);

  day.forEach((order, index) => {
    y = addPageIfNeeded(doc, y, 18);

    const employee = users.find(user => user.id === order.employeeId);
    const employeeName = employee?.name || order.employeeId;

    doc.setFont('helvetica', 'bold');
    y = addWrappedText(
      doc,
      `${index + 1}. ${employeeName} | SR: ${order.employeeId}`,
      14,
      y,
      182
    );

    doc.setFont('helvetica', 'normal');

    y = addWrappedText(
      doc,
      `Items: ${orderText(order)}`,
      18,
      y + 1,
      178
    );

    doc.text(
      `Amount: Rs.${orderTotal(order, prices).toFixed(2)}`,
      18,
      y + 1
    );

    y += 8;
  });

  doc.save(`GoCanteen-Daily-${date}.pdf`);
}

export function downloadMonthlyPdf(
  month: number,
  year: number,
  users: User[],
  orders: Order[],
  prices: Prices
) {
  const doc = new jsPDF();

  const monthName = new Date(year, month, 1).toLocaleString('en-IN', {
    month: 'long',
  });

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

      return (
        date.getMonth() === month &&
        date.getFullYear() === year
      );
    });

    const total = mine.reduce(
      (sum, order) => sum + orderTotal(order, prices),
      0
    );

    grandTotal += total;

    y = addPageIfNeeded(doc, y, 25);

    doc.setFont('helvetica', 'bold');
    y = addWrappedText(
      doc,
      `${index + 1}. ${employee.name || '-'}`,
      14,
      y,
      182
    );

    doc.setFont('helvetica', 'normal');

    y = addWrappedText(
      doc,
      `SR Number: ${employee.id}   Mobile: ${employee.mobile || '-'}`,
      14,
      y + 1,
      182
    );

    doc.text(
      `Orders: ${mine.length}   Food Amount: Rs.${total.toFixed(2)}`,
      14,
      y + 1
    );

    y += 9;
  });

  y = addPageIfNeeded(doc, y, 20);

  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.text(`Monthly Total: Rs.${grandTotal.toFixed(2)}`, 14, y + 5);

  doc.save(
    `GoCanteen-Monthly-${year}-${String(month + 1).padStart(2, '0')}.pdf`
  );
}
