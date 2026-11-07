import { useEffect, useMemo, useState } from 'react';
import { CurrentSpecials, loadCurrentSpecials, loadGuestOrdersEnabled, loadOrderSpecialSnapshots, OrderSpecialSnapshots, specialsForDate } from '../services/poolingSpecials';

type L<T> = (v: T) => void;
function shared<T>(initial: T, loader: () => Promise<T>) {
  let cache: T | null = null; let inflight: Promise<T> | null = null; const ls = new Set<L<T>>();
  const refresh = () => (inflight = inflight || loader().then(v => { inflight = null; cache = v; ls.forEach(l => l(v)); return v; }, e => { inflight = null; throw e; }));
  const set = (v: T) => { cache = v; ls.forEach(l => l(v)); };
  const use = () => {
    const [v, setV] = useState<T>(cache ?? initial);
    useEffect(() => { ls.add(setV); void refresh().catch(() => {}); return () => { ls.delete(setV); }; }, []);
    return v;
  };
  return { refresh, set, use };
}
const current = shared<CurrentSpecials>({ weekly: {}, daily: {} }, loadCurrentSpecials);
const guest = shared<boolean>(true, loadGuestOrdersEnabled);

/** CURRENT menu specials. Use only for choosing NEW items (menu lists), never for already placed orders. */
export const useCurrentSpecials = current.use;
export const refreshCurrentSpecials = current.refresh;
export function useMenuSpecialsForDate(date: string | null | undefined): Record<string, number> {
  const s = current.use();
  return useMemo(() => (date ? specialsForDate(s, date) : {}), [s, date]);
}

/** Server-RECORDED special prices for placed orders (history/calendar/today). */
export function useOrderSpecialSnapshots(orderIds: string[], refreshKey: unknown = null): OrderSpecialSnapshots {
  const key = [...new Set(orderIds.filter(Boolean))].sort().join(',');
  const [snap, setSnap] = useState<OrderSpecialSnapshots>({});
  useEffect(() => {
    let alive = true;
    loadOrderSpecialSnapshots(key ? key.split(',') : []).then(v => { if (alive) setSnap(v); }, () => { if (alive) setSnap({}); });
    return () => { alive = false; };
  }, [key, refreshKey]);
  return snap;
}

/** Guest orders On/Off for this canteen; defaults to On. */
export const useGuestOrdersEnabled = guest.use;
export const publishGuestOrdersEnabled = guest.set;
export const rupees = (paise: number) => `₹${(paise / 100).toFixed(2)}`;
