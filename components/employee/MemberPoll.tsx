import React, { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useActivePoll } from '../../hooks/usePoll';
import { loadPollResponses, submitPollResponse } from '../../services/polls';

const MemberPoll: React.FC = () => {
  const { user } = useAuth();
  const { poll, open } = useActivePoll();
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (!poll || !user) return;
    let alive = true;
    loadPollResponses(poll.id).then(rows => {
      if (!alive) return;
      const mine = rows.find(r => r.memberId === (user.id || user.identityId));
      if (mine) { setSelected(mine.selectedOptions); setSubmitted(true); }
    }).catch(() => {});
    return () => { alive = false; };
  }, [poll, user]);

  if (!poll || !open) return null;

  const toggle = (opt: string) => {
    if (poll.allowMultiple) {
      setSelected(s => s.includes(opt) ? s.filter(x => x !== opt) : [...s, opt]);
    } else {
      setSelected([opt]);
    }
  };

  const submit = async () => {
    if (busy || !user || selected.length === 0) return;
    setBusy(true); setMsg('');
    try {
      await submitPollResponse(poll.id, user.id || user.identityId || '', user.name || user.id || 'Member', selected);
      setSubmitted(true);
      setMsg('Your response has been submitted.');
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
          <p className="mt-0.5 text-xs text-gray-500">{poll.allowMultiple ? 'Select one or more' : 'Select one'}</p>
        </div>
        {submitted && <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">Submitted</span>}
      </div>
      <div className="mt-3 space-y-2">
        {poll.options.map(opt => (
          <label key={opt} className="flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2">
            <input
              type={poll.allowMultiple ? 'checkbox' : 'radio'}
              name="poll"
              checked={selected.includes(opt)}
              onChange={() => toggle(opt)}
              className="h-4 w-4"
            />
            <span className="text-sm text-gray-800">{opt}</span>
          </label>
        ))}
      </div>
      <button
        type="button"
        disabled={busy || selected.length === 0}
        onClick={() => void submit()}
        className="mt-4 w-full rounded-lg bg-primary-600 px-4 py-2.5 font-semibold text-white shadow-sm disabled:opacity-60"
      >
        {busy ? 'Submitting…' : submitted ? 'Update Response' : 'Submit Poll'}
      </button>
      {msg && <p className="mt-2 text-xs text-gray-700">{msg}</p>}
    </div>
  );
};

export default MemberPoll;
