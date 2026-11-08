import React, { useEffect, useState } from 'react';
import { jsPDF } from 'jspdf';
import { useAuth } from '../../context/AuthContext';
import { loadActivePoll, loadPollResponses, savePoll, setPollEnabled, Poll } from '../../services/polls';

const PollSettings: React.FC = () => {
  const { hasPermission } = useAuth();
  const canEdit = hasPermission('payments') || hasPermission('menu');
  const [poll, setPoll] = useState<Poll | null>(null);
  const [title, setTitle] = useState('');
  const [options, setOptions] = useState<string[]>(['', '']);
  const [allowMultiple, setAllowMultiple] = useState(false);
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
      setOptions(p.options.length ? p.options : ['', '']);
      setAllowMultiple(p.allowMultiple);
      setStartsAt(p.startsAt.slice(0, 16));
      setEndsAt(p.endsAt.slice(0, 16));
      setEnabled(p.enabled);
    }).catch(() => {});
  }, []);

  const addOption = () => setOptions(o => [...o, '']);
  const removeOption = (idx: number) => setOptions(o => o.filter((_, i) => i !== idx));
  const updateOption = (idx: number, val: string) => setOptions(o => o.map((v, i) => i === idx ? val : v));

  const save = async () => {
    if (busy) return;
    const clean = options.map(s => s.trim()).filter(Boolean);
    if (!title.trim() || clean.length < 2 || !startsAt || !endsAt) {
      setMsg('Title, at least 2 options, and start/end time are required.');
      return;
    }
    setBusy(true); setMsg('');
    try {
      const saved = await savePoll({
        title: title.trim(),
        options: clean,
        allowMultiple,
        startsAt: new Date(startsAt).toISOString(),
        endsAt: new Date(endsAt).toISOString(),
        enabled,
      });
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
      try {
        await setPollEnabled(poll.id, true);
        setPoll({ ...poll, enabled: true });
        setMsg('Poll turned on.');
      } catch (e: any) {
        setMsg(e?.message || 'Could not turn on.');
      } finally { setBusy(false); }
    }
  };

  const setOff = async () => {
    if (!canEdit || busy) return;
    setEnabled(false);
    setMsg('Poll turned off. Save to apply.');
    if (poll) {
      setBusy(true);
      try {
        await setPollEnabled(poll.id, false);
        setPoll({ ...poll, enabled: false });
        setMsg('Poll turned off.');
      } catch (e: any) {
        setMsg(e?.message || 'Could not turn off.');
      } finally { setBusy(false); }
    }
  };

  const downloadPdf = async () => {
    if (!poll) return;
    const rows = await loadPollResponses(poll.id);
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text(poll.title, 14, 20);
    doc.setFontSize(11);
    doc.text(`Selection: ${poll.allowMultiple ? 'Multiple' : 'Single'}`, 14, 28);
    doc.text(`Window: ${new Date(poll.startsAt).toLocaleString()} – ${new Date(poll.endsAt).toLocaleString()}`, 14, 35);
    let y = 46;
    doc.setFontSize(10);
    if (!rows.length) doc.text('No responses yet.', 14, y);
    rows.forEach((r, i) => {
      if (y > 270) { doc.addPage(); y = 20; }
      doc.text(`${i + 1}. ${r.memberName} (${r.memberId})`, 14, y);
      y += 6;
      doc.text(`   Selected: ${r.selectedOptions.join(', ') || '—'}`, 14, y);
      y += 8;
    });
    doc.save(`poll-${poll.id.slice(0, 8)}.pdf`);
  };

  return (
    <div className="mt-4 rounded-xl border bg-gray-50 p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-sm font-semibold text-gray-800">Poll</div>
          <p className="text-xs text-gray-600">When on, members see a Poll button in the Orders tab during the set time window. Admin decides single or multiple selection.</p>
        </div>
        <div className="flex gap-1 rounded-lg bg-gray-200 p-1 sm:w-48">
          <button type="button" disabled={!canEdit || busy} onClick={() => void setOn()} className={`min-h-11 flex-1 rounded-lg px-4 text-sm font-semibold transition ${enabled ? 'bg-white text-primary-700 shadow-sm' : 'text-gray-600'}`}>On</button>
          <button type="button" disabled={!canEdit || busy} onClick={() => void setOff()} className={`min-h-11 flex-1 rounded-lg px-4 text-sm font-semibold transition ${!enabled ? 'bg-white text-primary-700 shadow-sm' : 'text-gray-600'}`}>Off</button>
        </div>
      </div>

      {canEdit && (
        <div className="mt-4 space-y-3">
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Poll title" className="w-full rounded-lg border px-3 py-2 text-sm" />

          <div className="space-y-2">
            <div className="text-xs font-medium text-gray-600">Options</div>
            {options.map((opt, idx) => (
              <div key={idx} className="flex gap-2">
                <input
                  value={opt}
                  onChange={e => updateOption(idx, e.target.value)}
                  placeholder={`Option ${idx + 1}`}
                  className="flex-1 rounded-lg border px-3 py-2 text-sm"
                />
                {options.length > 2 && (
                  <button type="button" onClick={() => removeOption(idx)} className="rounded-lg border px-3 text-sm text-red-600">Remove</button>
                )}
              </div>
            ))}
            <button type="button" onClick={addOption} className="rounded-lg border border-dashed px-3 py-2 text-sm text-primary-700">+ Add option</button>
          </div>

          <div className="flex items-center gap-3 text-sm">
            <label className="flex items-center gap-2"><input type="radio" checked={!allowMultiple} onChange={() => setAllowMultiple(false)} /> Single select</label>
            <label className="flex items-center gap-2"><input type="radio" checked={allowMultiple} onChange={() => setAllowMultiple(true)} /> Multiple select</label>
          </div>
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
