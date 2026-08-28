import React, { createContext, useContext, ReactNode, useEffect, useRef, useState, useCallback } from 'react';
import { User, Order, Prices, Status, MenuItem } from '../types';
import { ADMIN_USER_ID, DEFAULT_ADMIN_PASSWORD } from '../constants';
import { loadSupabaseData, upsertOrder, upsertPrices, saveHoliday, removeHoliday } from '../services/supabaseSync';
import { supabaseEnabled } from '../supabase';

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
  const timer = useRef<number | undefined>(undefined);
  const refreshTimer = useRef<number | undefined>(undefined);

  const hydrate = useCallback(async () => {
    if (!supabaseEnabled) { hydrated.current = true; return; }
    try {
      const cloud = await loadSupabaseData();
      if (cloud) {
        setUsers(prev => {
          const map = new Map(prev.map(u => [u.id, u]));
          cloud.users.forEach(u => map.set(u.id, { ...(map.get(u.id) || u), ...u }));
          return Array.from(map.values());
        });
        setOrders(cloud.orders || []);
        setPrices(cloud.prices || initialPrices);
        setMenuItems(cloud.menuItems?.length ? cloud.menuItems : initialMenuItems);
        setHolidays(cloud.holidays || []);
      }
    } catch (e) {
      console.warn('Supabase load failed; keeping local state.', e);
    } finally {
      hydrated.current = true;
    }
  }, []);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  // Keep separate employee/admin app instances fresh from Supabase.
  // This also fixes stale menu/price data when one device changes it and
  // another device is already open.
  useEffect(() => {
    if (!supabaseEnabled) return;
    const refresh = () => { void hydrate(); };
    const interval = window.setInterval(refresh, 15000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    refreshTimer.current = interval;
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [hydrate]);

  useEffect(() => {
    if (!supabaseEnabled || !hydrated.current) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      setCloudSyncing(true);
      try {
        for (const order of orders) await upsertOrder(order, prices);
        if (menuItems.length) await upsertPrices(prices, menuItems);
      } catch (e) {
        console.warn('Background Supabase sync failed.', e);
      } finally {
        setCloudSyncing(false);
      }
    }, 900);
    return () => window.clearTimeout(timer.current);
  }, [orders, prices, menuItems]);

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
