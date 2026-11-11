import { useEffect, useRef, useState } from 'react';
import { isPollOpen, loadActivePoll, Poll } from '../services/polls';

// Previously this polled every 20s and replaced the poll object each time, which re-ran every
// effect keyed on it (MemberPoll re-fetched responses and reset answers on each tick).
// Now: load on open, when the app becomes visible again (throttled), once at the poll's end
// time (to hide it), and a low-frequency check (5 min) only while the app is visible.
// The poll object is kept stable unless the poll actually changes.
const VISIBLE_THROTTLE_MS = 60_000;
const BACKGROUND_CHECK_MS = 5 * 60_000;
const pollKey = (p: Poll | null) => p ? `${p.id}|${p.enabled}|${p.startsAt}|${p.endsAt}|${p.title}|${JSON.stringify(p.questions)}` : '';

export function useActivePoll() {
  const [poll, setPoll] = useState<Poll | null>(null);
  const [open, setOpen] = useState(false);
  const keyRef = useRef('');
  const lastLoad = useRef(0);
  useEffect(() => {
    let alive = true;
    let endTimer: number | undefined;
    const apply = (p: Poll | null) => {
      const k = pollKey(p);
      if (k !== keyRef.current) { keyRef.current = k; setPoll(p); }
      setOpen(isPollOpen(p));
      window.clearTimeout(endTimer);
      if (p) {
        const ms = new Date(p.endsAt).getTime() - Date.now() + 1000;
        if (ms > 0 && ms < 2_147_000_000) endTimer = window.setTimeout(() => { if (alive) apply(p); }, ms);
      }
    };
    const load = async () => {
      lastLoad.current = Date.now();
      try {
        const p = await loadActivePoll();
        if (alive) apply(p);
      } catch { if (alive) apply(null); }
    };
    void load();
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastLoad.current >= VISIBLE_THROTTLE_MS) void load();
    };
    document.addEventListener('visibilitychange', onVisible);
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') void load(); }, BACKGROUND_CHECK_MS);
    return () => { alive = false; window.clearInterval(t); window.clearTimeout(endTimer); document.removeEventListener('visibilitychange', onVisible); };
  }, []);
  return { poll, open };
}
