import { useEffect, useState } from 'react';
import { loadGuestOrdersEnabled, loadPoolingSpecialPrices } from '../services/poolingSpecials';

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
const specials = shared<Record<string, number>>({}, loadPoolingSpecialPrices);
const guest = shared<boolean>(true, loadGuestOrdersEnabled);
/** itemCode -> special price (paise). Only these items show a price in Pooling. */
export const usePoolingSpecialPrices = specials.use;
export const refreshPoolingSpecialPrices = specials.refresh;
/** Guest orders On/Off for this canteen; defaults to On. */
export const useGuestOrdersEnabled = guest.use;
export const publishGuestOrdersEnabled = guest.set;
export const rupees = (paise: number) => `₹${(paise / 100).toFixed(2)}`;
