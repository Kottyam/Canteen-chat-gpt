import { useEffect, useState } from 'react';
import { isPollOpen, loadActivePoll, Poll } from '../services/polls';

export function useActivePoll() {
  const [poll, setPoll] = useState<Poll | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const p = await loadActivePoll();
        if (!alive) return;
        setPoll(p);
        setOpen(isPollOpen(p));
      } catch { if (alive) { setPoll(null); setOpen(false); } }
    };
    void load();
    const t = window.setInterval(load, 20000);
    return () => { alive = false; window.clearInterval(t); };
  }, []);
  return { poll, open };
}
