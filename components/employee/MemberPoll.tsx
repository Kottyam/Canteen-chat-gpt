import React, { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useActivePoll } from '../../hooks/usePoll';
import { loadPollResponses, submitPollResponse } from '../../services/polls';
import { supabase } from '../../supabase';

const MemberPoll: React.FC = () => {
  const { user } = useAuth();
  const { poll, open } = useActivePoll();
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [notified, setNotified] = useState(false);

  useEffect(() => {
    if (!poll || !user || notified) return;
    // Create in-app notification for the member when poll is open
    const createNotif = async () => {
      try {
        await supabase?.from('notifications').insert({
          recipient_id: user.identityId || user.id,
          canteen_id: (await supabase.from('profiles').select('canteen_id').eq('id', user.identityId || user.id).maybeSingle()).data?.canteen_id,
          notification_type: 'poll_open',
          title: 'New Poll',
          message: `"${poll.title}" is open. Please submit your response.`,
          payload: { poll_id: poll.id, screen: 'orders' },
        });
        setNotified(true);
      } catch { /* ignore */ }
    };
    if (open) void createNotif();
  }, [poll, open, user, notified]);

  useEffect(() => {
    if (!poll || !user) return;
    let alive = true;
    loadPollResponses(poll.id).then(rows => {
      if (!alive) return;
      const mine = rows.find(r => r.memberId === (user.id || user.identityId));
      if (mine) { setAnswers(mine.answers); setSubmitted(true); }
    }).catch(() => {});
    return () => { alive = false; };
  }, [poll, user]);

  if (!poll) return null;

  if (!open) {
    return (
      <div className="mt-5 rounded-2xl border bg-gray-50 p-4">
        <h3 className="font-bold text-gray-800">Poll</h3>
        <p className="mt-1 text-sm text-gray-600">"{poll.title}" is not open right now.</p>
        <p className="mt-1 text-xs text-gray-500">Opens: {new Date(poll.startsAt).toLocaleString()} – {new Date(poll.endsAt).toLocaleString()}</p>
      </div>
    );
  }

  const toggle = (qId: string, opt: string, allowMultiple: boolean) => {
    setAnswers(a => {
      const cur = a[qId] || [];
      if (allowMultiple) {
        return { ...a, [qId]: cur.includes(opt) ? cur.filter(x => x !== opt) : [...cur, opt] };
      }
      return { ...a, [qId]: [opt] };
    });
  };

  const submit = async () => {
    if (busy || !user) return;
    setBusy(true); setMsg('');
    try {
      await submitPollResponse(poll.id, user.id || user.identityId || '', user.name || user.id || 'Member', answers);
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
                <label key={opt} className="flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2">
                  <input
                    type={q.allowMultiple ? 'checkbox' : 'radio'}
                    name={q.id}
                    checked={(answers[q.id] || []).includes(opt)}
                    onChange={() => toggle(q.id, opt, q.allowMultiple)}
                    className="h-4 w-4"
                  />
                  <span className="text-sm text-gray-800">{opt}</span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
      <button
        type="button"
        disabled={busy}
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
