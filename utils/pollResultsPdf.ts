// Admin poll results PDF (Settings → Poll). Read-only: never writes polls or responses.
// Uses the app's shared deliverPdf so it works on web (download) and on Android (Filesystem + share sheet).
// jsPDF doc.save() does nothing inside the Capacitor WebView, which is why ended-poll results could not be downloaded in the APK.
import { jsPDF } from 'jspdf';
import { deliverPdf } from './pdfLegacy';
import type { Poll, PollResponse } from '../services/polls';

const BRAND_GREEN = [5, 150, 105] as const;
const INK = [17, 24, 39] as const;
const MUTED = [75, 85, 99] as const;
const BORDER = [209, 213, 219] as const;

export interface PollTally { option: string; count: number }
export interface PollQuestionSummary { id: string; text: string; allowMultiple: boolean; tallies: PollTally[]; answered: number }
export interface PollResultsRow { sno: number; memberName: string; submittedAt: string; answers: string[] }
export interface PollResultsPdfModel {
  canteenName: string;
  title: string;
  window: string;
  status: string;
  responseCount: number;
  questions: PollQuestionSummary[];
  rows: PollResultsRow[];
  filename: string;
}

const fmt = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
};
const safeName = (s: string) => String(s || 'poll').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'poll';

export function buildPollResultsPdfModel(poll: Poll, responses: PollResponse[], canteenName = ''): PollResultsPdfModel {
  const questions = (poll.questions || []).map(q => {
    const counts = new Map<string, number>((q.options || []).map(o => [o, 0]));
    let answered = 0;
    for (const r of responses) {
      const picked = (r.answers?.[q.id] || []).filter(Boolean);
      if (picked.length) answered += 1;
      for (const p of picked) counts.set(p, (counts.get(p) || 0) + 1);
    }
    return { id: q.id, text: q.text, allowMultiple: !!q.allowMultiple, answered, tallies: [...counts].map(([option, count]) => ({ option, count })) };
  });
  const rows = [...responses]
    .sort((a, b) => String(a.submittedAt || '').localeCompare(String(b.submittedAt || '')))
    .map((r, i) => ({
      sno: i + 1,
      memberName: r.memberName || r.memberId || 'Member',
      submittedAt: fmt(r.submittedAt),
      answers: (poll.questions || []).map(q => (r.answers?.[q.id] || []).join(', ') || '-'),
    }));
  const ended = Date.now() > new Date(poll.endsAt).getTime();
  return {
    canteenName: canteenName || 'Go Canteen',
    title: poll.title || 'Poll',
    window: `${fmt(poll.startsAt)} – ${fmt(poll.endsAt)}`,
    status: ended ? 'Ended' : 'Open',
    responseCount: responses.length,
    questions,
    rows,
    filename: `GoCanteen-Poll-${safeName(poll.title)}-${String(poll.id || '').slice(0, 8)}.pdf`,
  };
}

const M = 12, W = 186, BOTTOM = 280, LINE = 4.4;

export function renderPollResultsPdf(doc: any, model: PollResultsPdfModel, generatedAt: string) {
  const ink = () => doc.setTextColor(INK[0], INK[1], INK[2]);
  const cell = (x: number, y: number, w: number, h: number, fill: readonly number[]) => {
    doc.setFillColor(fill[0], fill[1], fill[2]);
    doc.setDrawColor(BORDER[0], BORDER[1], BORDER[2]);
    doc.setLineWidth(0.2);
    doc.rect(x, y, w, h, 'FD');
    ink();
  };
  const lines = (t: string, w: number) => doc.splitTextToSize(String(t ?? ''), Math.max(6, w - 3)) as string[];
  const header = () => {
    doc.setTextColor(BRAND_GREEN[0], BRAND_GREEN[1], BRAND_GREEN[2]); doc.setFont('helvetica', 'bold'); doc.setFontSize(18);
    doc.text('GO CANTEEN', 105, 14, { align: 'center' });
    ink(); doc.setFontSize(11); doc.text(model.canteenName, 105, 21, { align: 'center' });
    doc.setFontSize(12); doc.text('POLL RESULTS', 105, 28, { align: 'center' });
    return 34;
  };
  let y = header();
  const newPage = () => { doc.addPage(); y = header(); };
  const ensure = (h: number) => { if (y + h > BOTTOM) newPage(); };

  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); ink();
  for (const l of lines(model.title, W)) { ensure(6); doc.text(l, M, y + 4); y += 5.5; }
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
  doc.text(`Window: ${model.window}`, M, y + 4); y += 5;
  doc.text(`Status: ${model.status}   ·   Responses: ${model.responseCount}   ·   Generated: ${generatedAt}`, M, y + 4); y += 8;
  ink();

  // Summary per question
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); ensure(8); doc.text('Summary', M, y + 4); y += 7;
  for (const [qi, q] of model.questions.entries()) {
    const qLines = lines(`Q${qi + 1}. ${q.text}${q.allowMultiple ? ' (multiple choice)' : ''}`, W);
    const qh = qLines.length * LINE + 3;
    ensure(qh + 7);
    cell(M, y, W, qh, [209, 250, 229]);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); ink();
    qLines.forEach((l, i) => doc.text(l, M + 2, y + 4.6 + i * LINE));
    y += qh;
    for (const [ti, t] of q.tallies.entries()) {
      const pct = model.responseCount ? Math.round((t.count / model.responseCount) * 100) : 0;
      const oLines = lines(t.option, W - 50);
      const h = Math.max(7, oLines.length * LINE + 3);
      ensure(h);
      const fill = ti % 2 ? [249, 250, 251] : [255, 255, 255];
      cell(M, y, W - 50, h, fill);
      cell(M + W - 50, y, 50, h, fill);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.2); ink();
      oLines.forEach((l, i) => doc.text(l, M + 2, y + 4.6 + i * LINE));
      doc.setFont('helvetica', 'bold');
      doc.text(`${t.count} vote${t.count === 1 ? '' : 's'} (${pct}%)`, M + W - 2, y + 4.6, { align: 'right' });
      y += h;
    }
    y += 3;
  }

  // Responses table
  ensure(16);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); ink(); doc.text('Responses', M, y + 4); y += 7;
  const qCount = Math.max(1, model.questions.length);
  const fixed = [10, 38, 34];
  const ansW = (W - fixed.reduce((a, b) => a + b, 0)) / qCount;
  const cols = [...fixed, ...Array.from({ length: qCount }, () => ansW)];
  const xs = cols.reduce<number[]>((a, _w, i) => { a.push(i ? a[i - 1] + cols[i - 1] : M); return a; }, []);
  const heads = ['#', 'Member', 'Submitted', ...model.questions.map((_q, i) => `Q${i + 1}`)];
  const tableHeader = () => {
    heads.forEach((hd, i) => { cell(xs[i], y, cols[i], 7, [209, 250, 229]); doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(6, 95, 70); doc.text(hd, xs[i] + cols[i] / 2, y + 4.8, { align: 'center' }); });
    ink(); y += 7;
  };
  if (!model.rows.length) {
    ensure(10); cell(M, y, W, 9, [255, 255, 255]); doc.setFont('helvetica', 'normal'); doc.setFontSize(9); ink();
    doc.text('No responses were submitted for this poll.', M + 2, y + 6); y += 9;
  } else {
    tableHeader();
    model.rows.forEach((r, ri) => {
      const vals = [String(r.sno), r.memberName, r.submittedAt, ...r.answers];
      const wrapped = vals.map((v, i) => lines(v, cols[i]));
      const h = Math.max(7, Math.max(...wrapped.map(w => w.length)) * LINE + 3);
      if (y + h > BOTTOM) { newPage(); tableHeader(); }
      const fill = ri % 2 ? [249, 250, 251] : [255, 255, 255];
      wrapped.forEach((wl, i) => {
        cell(xs[i], y, cols[i], h, fill);
        doc.setFont('helvetica', i === 1 ? 'bold' : 'normal'); doc.setFontSize(7.8); ink();
        wl.forEach((l, li) => doc.text(l, i === 0 ? xs[i] + cols[i] / 2 : xs[i] + 1.5, y + 4.6 + li * LINE, i === 0 ? { align: 'center' } : undefined));
      });
      y += h;
    });
  }

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i); doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(107, 114, 128);
    doc.text(`Page ${i} of ${pages}`, 105, 290, { align: 'center' });
  }
  ink();
  return doc;
}

/** Swappable in tests; real path = jsPDF + deliverPdf (browser download / Android share sheet). */
export const pollResultsPdfAdapter = {
  async download(model: PollResultsPdfModel) {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    renderPollResultsPdf(doc, model, new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }));
    await deliverPdf(doc, model.filename);
  },
};
