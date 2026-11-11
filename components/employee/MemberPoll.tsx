import React, { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useActivePoll } from '../../hooks/usePoll';
import { loadPollResponses, submitPollResponse, isPollOpen } from '../../services/polls';

const MemberPoll: React.FC = () => {
  const { user } = useAuth();
  const { poll } = useActivePoll();
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const open = isPollOpen(poll);

  const pollId = poll?.id;
  const meId = user ? (user.id || user.identityId) : undefined;
  // Load the member's own answer once per poll (not on every re-render / token refresh).
  useEffect(() => {
    if (!poll || !user) return;
    let alive = true;
    loadPollResponses(poll.id).then(rows => {
      if (!alive) return;
      const mine = rows.find(r => r.memberId === meId);
      if (mine) { setAnswers(mine.answers); setSubmitted(true); }
    }).catch(() => {});
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollId, meId]);

  // Members see only a currently live poll — never ended history/results or a pre-start preview.
  if (!poll || !open) return null;

  const toggle = (qId: string, opt: string, allowMultiple: boolean) => {
    if (submitted) return;
    setAnswers(a => {
      const cur = a[qId] || [];
      if (allowMultiple) {
        return { ...a, [qId]: cur.includes(opt) ? cur.filter(x => x !== opt) : [...cur, opt] };
      }
      return { ...a, [qId]: [opt] };
    });
  };

  const submit = async () => {
    if (busy || !user || submitted) return;
    if (!confirm('Submit your response? You cannot change it later.')) return;
    setBusy(true); setMsg('');
    try {
      await submitPollResponse(poll.id, user.id || user.identityId || '', user.name || user.id || 'Member', answers);
      setSubmitted(true);
      setMsg('Your response has been submitted. You cannot change it.');
      alert('Submitted successfully. You cannot change your response.');
    } catch (e: any) {
      setMsg(e?.message || 'Could not submit.');
    } finally { setBusy(false); }
  };

  return (
    <div className="mt-5 rounded-2xl border bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-bold text-gray-800">Poll</h3>
          <p className="mt-1 text-sm text-gray-600">{poll.title}</p>
        </div>
        {submitted && <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">Submitted</span>}
      </div>
      <div className="mt-4 space-y-4">
        {poll.questions.map(q => (
          <div key={q.id}>
            <div className="text-sm font-semibold text-gray-800">{q.text}</div>
            <p className="text-xs text-gray-500">{q.allowMultiple ? 'Select one or more' : 'Select one'}</p>
            <div className="mt-2 space-y-2">
              {q.options.map(opt => (
                <label key={opt} className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${submitted ? 'opacity-70' : 'cursor-pointer'}`}>
                  <input
                    type={q.allowMultiple ? 'checkbox' : 'radio'}
                    name={q.id}
                    checked={(answers[q.id] || []).includes(opt)}
                    onChange={() => toggle(q.id, opt, q.allowMultiple)}
                    disabled={submitted}
                    className="h-4 w-4"
                  />
                  <span className="text-sm text-gray-800">{opt}</span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
      {!submitted && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void submit()}
          className="mt-4 w-full rounded-lg bg-primary-600 px-4 py-2.5 font-semibold text-white shadow-sm disabled:opacity-60"
        >
          {busy ? 'Submitting…' : 'Submit Poll'}
        </button>
      )}
      {submitted && <p className="mt-3 text-sm font-medium text-green-700">Submitted. You cannot change your response.</p>}
      {msg && <p className="mt-2 text-xs text-gray-700">{msg}</p>}
    </div>
  );
};

export default MemberPoll;
