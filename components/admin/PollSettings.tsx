import React, { useEffect, useState } from 'react';
import { jsPDF } from 'jspdf';
import { useAuth } from '../../context/AuthContext';
import { loadActivePoll, loadPollResponses, savePoll, setPollEnabled, Poll, PollQuestion } from '../../services/polls';

const PollSettings: React.FC = () => {
  const { hasPermission } = useAuth();
  const canEdit = hasPermission('payments') || hasPermission('menu');
  const [poll, setPoll] = useState<Poll | null>(null);
  const [title, setTitle] = useState('');
  const [questions, setQuestions] = useState<PollQuestion[]>([{ id: 'q1', text: '', options: ['', ''], allowMultiple: false }]);
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    void loadActivePoll().then(p => {
      if (!p) return;
      setPoll(p);
      setTitle(p.title);
      setQuestions(p.questions.length ? p.questions : [{ id: 'q1', text: '', options: ['', ''], allowMultiple: false }]);
      setStartsAt(p.startsAt.slice(0, 16));
      setEndsAt(p.endsAt.slice(0, 16));
      setEnabled(p.enabled);
    }).catch(() => {});
  }, []);

  const addQuestion = () => setQuestions(q => [...q, { id: `q${Date.now()}`, text: '', options: ['', ''], allowMultiple: false }]);
  const removeQuestion = (idx: number) => setQuestions(q => q.filter((_, i) => i !== idx));
  const updateQuestion = (idx: number, patch: Partial<PollQuestion>) => setQuestions(q => q.map((item, i) => i === idx ? { ...item, ...patch } : item));
  const addOption = (qIdx: number) => setQuestions(q => q.map((item, i) => i === qIdx ? { ...item, options: [...item.options, ''] } : item));
  const removeOption = (qIdx: number, oIdx: number) => setQuestions(q => q.map((item, i) => i === qIdx ? { ...item, options: item.options.filter((_, j) => j !== oIdx) } : item));
  const updateOption = (qIdx: number, oIdx: number, val: string) => setQuestions(q => q.map((item, i) => i === qIdx ? { ...item, options: item.options.map((o, j) => j === oIdx ? val : o) } : item));

  const save = async () => {
    if (busy) return;
    const clean = questions.map(q => ({ ...q, text: q.text.trim(), options: q.options.map(o => o.trim()).filter(Boolean) })).filter(q => q.text && q.options.length >= 2);
    if (!title.trim() || clean.length < 1 || !startsAt || !endsAt) {
      setMsg('Title, at least one question with 2 options, and start/end time are required.');
      return;
    }
    setBusy(true); setMsg('');
    try {
      const saved = await savePoll({ title: title.trim(), questions: clean, startsAt: new Date(startsAt).toISOString(), endsAt: new Date(endsAt).toISOString(), enabled });
      setPoll(saved);
      setMsg(enabled ? 'Poll saved and turned on.' : 'Poll saved.');
    } catch (e: any) {
      setMsg(e?.message || 'Could not save poll.');
    } finally { setBusy(false); }
  };

  const setOn = async () => {
    if (!canEdit || busy) return;
    setEnabled(true);
    setMsg('Poll turned on. Save to apply.');
    if (poll) {
      setBusy(true);
      try { await setPollEnabled(poll.id, true); setPoll({ ...poll, enabled: true }); setMsg('Poll turned on.'); }
      catch (e: any) { setMsg(e?.message || 'Could not turn on.'); }
      finally { setBusy(false); }
    }
  };

  const setOff = async () => {
    if (!canEdit || busy) return;
    setEnabled(false);
    setMsg('Poll turned off. Save to apply.');
    if (poll) {
      setBusy(true);
      try { await setPollEnabled(poll.id, false); setPoll({ ...poll, enabled: false }); setMsg('Poll turned off.'); }
      catch (e: any) { setMsg(e?.message || 'Could not turn off.'); }
      finally { setBusy(false); }
    }
  };

  const downloadPdf = async () => {
    if (!poll) return;
    const rows = await loadPollResponses(poll.id);
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text(poll.title, 14, 20);
    let y = 30;
    doc.setFontSize(11);
    rows.forEach((r, i) => {
      if (y > 260) { doc.addPage(); y = 20; }
      doc.text(`${i + 1}. ${r.memberName}`, 14, y);
      y += 6;
      poll.questions.forEach(q => {
        const ans = (r.answers[q.id] || []).join(', ') || '—';
        doc.text(`   ${q.text}: ${ans}`, 14, y);
        y += 5;
      });
      y += 4;
    });
    doc.save(`poll-${poll.id.slice(0, 8)}.pdf`);
  };

  return (
    <div className="mt-4 rounded-xl border bg-gray-50 p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-sm font-semibold text-gray-800">Poll</div>
          <p className="text-xs text-gray-600">Multiple questions, each with its own options. Members select per question.</p>
        </div>
        <div className="flex gap-1 rounded-lg bg-gray-200 p-1 sm:w-48">
          <button type="button" disabled={!canEdit || busy} onClick={() => void setOn()} className={`min-h-11 flex-1 rounded-lg px-4 text-sm font-semibold transition ${enabled ? 'bg-white text-primary-700 shadow-sm' : 'text-gray-600'}`}>On</button>
          <button type="button" disabled={!canEdit || busy} onClick={() => void setOff()} className={`min-h-11 flex-1 rounded-lg px-4 text-sm font-semibold transition ${!enabled ? 'bg-white text-primary-700 shadow-sm' : 'text-gray-600'}`}>Off</button>
        </div>
      </div>

      {canEdit && (
        <div className="mt-4 space-y-4">
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Poll title" className="w-full rounded-lg border px-3 py-2 text-sm" />

          {questions.map((q, qIdx) => (
            <div key={q.id} className="rounded-lg border bg-white p-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium text-gray-600">Question {qIdx + 1}</div>
                {questions.length > 1 && <button type="button" onClick={() => removeQuestion(qIdx)} className="text-xs text-red-600">Remove question</button>}
              </div>
              <input value={q.text} onChange={e => updateQuestion(qIdx, { text: e.target.value })} placeholder="Question text" className="mt-2 w-full rounded-lg border px-3 py-2 text-sm" />
              <div className="mt-2 space-y-2">
                {q.options.map((opt, oIdx) => (
                  <div key={oIdx} className="flex gap-2">
                    <input value={opt} onChange={e => updateOption(qIdx, oIdx, e.target.value)} placeholder={`Option ${oIdx + 1}`} className="flex-1 rounded-lg border px-3 py-2 text-sm" />
                    {q.options.length > 2 && <button type="button" onClick={() => removeOption(qIdx, oIdx)} className="rounded-lg border px-3 text-sm text-red-600">Remove</button>}
                  </div>
                ))}
                <button type="button" onClick={() => addOption(qIdx)} className="rounded-lg border border-dashed px-3 py-1 text-sm text-primary-700">+ Add option</button>
              </div>
              <div className="mt-2 flex items-center gap-3 text-sm">
                <label className="flex items-center gap-2"><input type="radio" checked={!q.allowMultiple} onChange={() => updateQuestion(qIdx, { allowMultiple: false })} /> Single</label>
                <label className="flex items-center gap-2"><input type="radio" checked={q.allowMultiple} onChange={() => updateQuestion(qIdx, { allowMultiple: true })} /> Multiple</label>
              </div>
            </div>
          ))}

          <button type="button" onClick={addQuestion} className="rounded-lg border border-dashed px-3 py-2 text-sm text-primary-700">+ Add question</button>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div><label className="text-xs text-gray-600">Starts</label><input type="datetime-local" value={startsAt} onChange={e => setStartsAt(e.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" /></div>
            <div><label className="text-xs text-gray-600">Ends</label><input type="datetime-local" value={endsAt} onChange={e => setEndsAt(e.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" /></div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => void save()} className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white">{busy ? 'Saving…' : 'Save Poll'}</button>
            {poll && <button type="button" onClick={() => void downloadPdf()} className="rounded-lg border px-4 py-2 text-sm font-semibold">Download Results PDF</button>}
          </div>
        </div>
      )}
      {msg && <p className="mt-2 text-xs text-gray-700">{msg}</p>}
    </div>
  );
};

export default PollSettings;
