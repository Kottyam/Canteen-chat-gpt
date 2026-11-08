import React, { useEffect, useState } from 'react';
import { jsPDF } from 'jspdf';
import { useAuth } from '../../context/AuthContext';
import { loadRecentPolls, loadPollResponses, savePoll, setPollEnabled, deletePoll, cleanupOldPolls, isPollOpen, isPollEnded, Poll, PollQuestion } from '../../services/polls';

const PollSettings: React.FC = () => {
  const { hasPermission } = useAuth();
  const canEdit = hasPermission('payments') || hasPermission('menu');
  const [polls, setPolls] = useState<Poll[]>([]);
  const [title, setTitle] = useState('');
  const [questions, setQuestions] = useState<PollQuestion[]>([{ id: 'q1', text: '', options: ['', ''], allowMultiple: false }]);
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const refresh = async () => {
    await cleanupOldPolls(10);
    setPolls(await loadRecentPolls(10));
  };

  useEffect(() => { void refresh(); }, []);

  const addQuestion = () => setQuestions(q => [...q, { id: `q${Date.now()}`, text: '', options: ['', ''], allowMultiple: false }]);
  const removeQuestion = (idx: number) => setQuestions(q => q.filter((_, i) => i !== idx));
  const updateQuestion = (idx: number, patch: Partial<PollQuestion>) => setQuestions(q => q.map((item, i) => i === idx ? { ...item, ...patch } : item));
  const addOption = (qIdx: number) => setQuestions(q => q.map((item, i) => i === qIdx ? { ...item, options: [...item.options, ''] } : item));
  const removeOption = (qIdx: number, oIdx: number) => setQuestions(q => q.map((item, i) => i === qIdx ? { ...item, options: item.options.filter((_, j) => j !== oIdx) } : item));
  const updateOption = (qIdx: number, oIdx: number, val: string) => setQuestions(q => q.map((item, i) => i === qIdx ? { ...item, options: item.options.map((o, j) => j === oIdx ? val : o) } : item));

  const hasLive = polls.some(p => isPollOpen(p));
  const save = async () => {
    if (busy || hasLive) return;
    const clean = questions.map(q => ({ ...q, text: q.text.trim(), options: q.options.map(o => o.trim()).filter(Boolean) })).filter(q => q.text && q.options.length >= 2);
    if (!title.trim() || clean.length < 1 || !startsAt || !endsAt) {
      setMsg('Title, at least one question with 2 options, and start/end time are required.');
      return;
    }
    setBusy(true); setMsg('');
    try {
      await savePoll({ title: title.trim(), questions: clean, startsAt: new Date(startsAt).toISOString(), endsAt: new Date(endsAt).toISOString(), enabled });
      setTitle(''); setQuestions([{ id: `q${Date.now()}`, text: '', options: ['', ''], allowMultiple: false }]); setStartsAt(''); setEndsAt(''); setEnabled(false);
      await refresh();
      setMsg('Poll saved.');
    } catch (e: any) {
      setMsg(e?.message || 'Could not save poll.');
    } finally { setBusy(false); }
  };

  const downloadPdf = async (poll: Poll) => {
    if (!isPollEnded(poll)) return;
    const rows = await loadPollResponses(poll.id);
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text(poll.title, 14, 20);
    let y = 30;
    doc.setFontSize(11);
    if (!rows.length) doc.text('No responses.', 14, y);
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

  const remove = async (id: string) => {
    if (!confirm('Delete this poll?')) return;
    setBusy(true);
    try { await deletePoll(id); await refresh(); } catch (e: any) { setMsg(e?.message || 'Could not delete.'); }
    finally { setBusy(false); }
  };

  return (
    <div className="mt-4 space-y-4">
      <div className="rounded-xl border bg-gray-50 p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-sm font-semibold text-gray-800">Create Poll</div>
            <p className="text-xs text-gray-600">Multiple questions, each with options. Members see it in Orders while live.</p>
          </div>
          <div className="flex gap-1 rounded-lg bg-gray-200 p-1 sm:w-48">
            <button type="button" disabled={!canEdit || busy} onClick={() => setEnabled(true)} className={`min-h-11 flex-1 rounded-lg px-4 text-sm font-semibold transition ${enabled ? 'bg-white text-primary-700 shadow-sm' : 'text-gray-600'}`}>On</button>
            <button type="button" disabled={!canEdit || busy} onClick={() => setEnabled(false)} className={`min-h-11 flex-1 rounded-lg px-4 text-sm font-semibold transition ${!enabled ? 'bg-white text-primary-700 shadow-sm' : 'text-gray-600'}`}>Off</button>
          </div>
        </div>

        {canEdit && !hasLive && (
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
            <button type="button" disabled={busy} onClick={() => void save()} className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white">{busy ? 'Saving…' : 'Save Poll'}</button>
          </div>
        )}
        {hasLive && <p className="mt-2 text-sm text-amber-700">A poll is currently live. You can create a new poll only after it ends.</p>}
        {msg && <p className="mt-2 text-xs text-gray-700">{msg}</p>}
      </div>

      <div className="rounded-xl border bg-white p-4">
        <div className="text-sm font-semibold text-gray-800">Recent Polls (last 10 days)</div>
        <p className="text-xs text-gray-500">Older polls are auto-deleted.</p>
        <div className="mt-3 space-y-2">
          {polls.length === 0 && <p className="text-sm text-gray-500">No polls yet.</p>}
          {polls.map(p => {
            const live = isPollOpen(p);
            const ended = isPollEnded(p);
            return (
              <div key={p.id} className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="font-medium text-gray-800">{p.title}</div>
                  <div className="text-xs text-gray-500">{new Date(p.startsAt).toLocaleString()} – {new Date(p.endsAt).toLocaleString()}</div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {live && <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">Live</span>}
                  {!live && ended && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600">Ended</span>}
                  {!live && !ended && <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-semibold text-yellow-700">Scheduled</span>}
                  <button
                    type="button"
                    disabled={!ended}
                    onClick={() => void downloadPdf(p)}
                    className={`rounded-lg border px-3 py-1.5 text-sm font-semibold ${ended ? 'animate-pulse bg-primary-50 text-primary-700' : 'cursor-not-allowed opacity-40'}`}
                  >
                    Download Results PDF
                  </button>
                  {canEdit && <button type="button" onClick={() => void remove(p.id)} className="rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-600">Delete</button>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default PollSettings;
