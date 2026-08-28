import React, { createContext, useContext, ReactNode, useEffect, useRef, useState, useCallback } from 'react';
import { User, Order, Prices, Status, MenuItem } from '../types';
import { ADMIN_USER_ID, DEFAULT_ADMIN_PASSWORD } from '../constants';
import { loadSupabaseData, upsertOrder, upsertPrices, saveHoliday, removeHoliday } from '../services/supabaseSync';
import { supabase, supabaseEnabled } from '../supabase';

interface DataContextType {
  users: User[];
  setUsers: React.Dispatch<React.SetStateAction<User[]>>;
  orders: Order[];
  setOrders: React.Dispatch<React.SetStateAction<Order[]>>;
  prices: Prices;
  setPrices: React.Dispatch<React.SetStateAction<Prices>>;
  menuItems: MenuItem[];
  setMenuItems: React.Dispatch<React.SetStateAction<MenuItem[]>>;
  holidays: string[];
  setHolidays: React.Dispatch<React.SetStateAction<string[]>>;
  addHoliday: (date: string) => Promise<void>;
  deleteHoliday: (date: string) => Promise<void>;
  cloudBackupEnabled: boolean;
  cloudSyncing: boolean;
}

const DataContext = createContext<DataContextType | undefined>(undefined);

const initialUsers: User[] = [{
  id: ADMIN_USER_ID,
  name: 'GoCanteen Administrator',
  mobile: '',
  password: DEFAULT_ADMIN_PASSWORD,
  role: 'admin',
  status: 'active' as Status,
  isFirstLogin: false,
}];

const initialPrices: Prices = { morningTea: 8, lunchMeals: 40, lunchEgg: 10, lunchFishMeat: 25, eveningTea: 8 };
const initialMenuItems: MenuItem[] = [
  { itemCode: 'morningTea', itemName: 'Morning Tea', unitPrice: 8, active: true },
  { itemCode: 'lunchMeals', itemName: 'Lunch: Meals', unitPrice: 40, active: true },
  { itemCode: 'lunchEgg', itemName: 'Lunch: Egg (add-on)', unitPrice: 10, active: true },
  { itemCode: 'lunchFishMeat', itemName: 'Lunch: Fish/Meat (add-on)', unitPrice: 25, active: true },
  { itemCode: 'eveningTea', itemName: 'Evening Tea', unitPrice: 8, active: true },
];

export const DataProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [users, setUsers] = useState<User[]>(initialUsers);
  const [orders, setOrders] = useState<Order[]>([]);
  const [prices, setPrices] = useState<Prices>(initialPrices);
  const [menuItems, setMenuItems] = useState<MenuItem[]>(initialMenuItems);
  const [holidays, setHolidays] = useState<string[]>([]);
  const [cloudSyncing, setCloudSyncing] = useState(false);

  const hydrated = useRef(false);
  const hydrating = useRef(false);
  const syncInFlight = useRef(false);
  const refreshRequested = useRef(false);
  const timer = useRef<number | undefined>(undefined);

  const hydrate = useCallback(async () => {
    if (!supabaseEnabled) {
      hydrated.current = true;
      return;
    }

    // Never replace fresh local state while a write is in progress.
    if (syncInFlight.current) {
      refreshRequested.current = true;
      return;
    }

    try {
      hydrating.current = true;
      const cloud = await loadSupabaseData();
      if (!cloud) return;

      setUsers(prev => {
        const map = new Map(prev.map(u => [u.id, u]));
        cloud.users.forEach(u => map.set(u.id, { ...(map.get(u.id) || u), ...u }));
        return Array.from(map.values());
      });
      setOrders(cloud.orders || []);
      setPrices(cloud.prices || initialPrices);
      setMenuItems(cloud.menuItems?.length ? cloud.menuItems : initialMenuItems);
      setHolidays(cloud.holidays || []);
    } catch (e) {
      console.warn('Supabase load failed; keeping current state.', e);
    } finally {
      hydrated.current = true;
    }
  }, []);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  // Cross-device refresh. Realtime events are used when available, with a
  // polling/focus fallback so reports eventually converge even if a realtime
  // connection is unavailable on a mobile network.
  useEffect(() => {
    if (!supabaseEnabled) return;

    const refresh = () => { void hydrate(); };
    const interval = window.setInterval(refresh, 15000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);

    let channel: ReturnType<NonNullable<typeof supabase>['channel']> | undefined;
    if (supabase) {
      channel = supabase
        .channel('gocanteen-data-sync')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, refresh)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, refresh)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'order_items' }, refresh)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'menu_prices' }, refresh)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'holidays' }, refresh)
        .subscribe();
    }

    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
      if (channel) void channel.unsubscribe();
    };
  }, [hydrate]);

  // Only local edits trigger a cloud write. A previous version also wrote the
  // just-loaded cloud state back to Supabase, creating a race between devices
  // and causing Daily/Monthly reports to intermittently show stale values.
  useEffect(() => {
    if (!supabaseEnabled || !hydrated.current) return;

    // hydrate() changed state from the cloud; do not echo that state back.
    if (hydrating.current) {
      hydrating.current = false;
      return;
    }

    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      if (syncInFlight.current) return;

      syncInFlight.current = true;
      setCloudSyncing(true);
      try {
        for (const order of orders) await upsertOrder(order, prices);
        if (menuItems.length) await upsertPrices(prices, menuItems);
      } catch (e) {
        console.warn('Background Supabase sync failed.', e);
      } finally {
        syncInFlight.current = false;
        setCloudSyncing(false);

        // If a realtime/poll refresh arrived during the write, perform it now
        // so both admin and employee instances converge on the same database state.
        if (refreshRequested.current) {
          refreshRequested.current = false;
          void hydrate();
        }
      }
    }, 500);

    return () => window.clearTimeout(timer.current);
  }, [orders, prices, menuItems, hydrate]);

  const addHoliday = async (date: string) => {
    await saveHoliday(date);
    setHolidays(prev => prev.includes(date) ? prev : [...prev, date]);
  };

  const deleteHoliday = async (date: string) => {
    await removeHoliday(date);
    setHolidays(prev => prev.filter(d => d !== date));
  };

  return (
    <DataContext.Provider value={{
      users, setUsers, orders, setOrders, prices, setPrices,
      menuItems, setMenuItems, holidays, setHolidays,
      addHoliday, deleteHoliday,
      cloudBackupEnabled: supabaseEnabled, cloudSyncing,
    }}>
      {children}
    </DataContext.Provider>
  );
};

export const useData = () => {
  const context = useContext(DataContext);
  if (!context) throw new Error('useData must be used within a DataProvider');
  return context;
};
