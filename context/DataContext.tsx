import React, {
  createContext,
  useContext,
  ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { User, Order, Prices, Status, MenuItem } from '../types';
import { ADMIN_USER_ID, DEFAULT_ADMIN_PASSWORD } from '../constants';
import {
  loadSupabaseData,
  upsertOrder,
  upsertPrices,
  saveHoliday,
  removeHoliday,
} from '../services/supabaseSync';
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

const initialUsers: User[] = [
  {
    id: ADMIN_USER_ID,
    name: 'GoCanteen Administrator',
    mobile: '',
    password: DEFAULT_ADMIN_PASSWORD,
    role: 'admin',
    status: 'active' as Status,
    isFirstLogin: false,
  },
];

const initialPrices: Prices = {
  morningTea: 8,
  lunchMeals: 40,
  lunchEgg: 10,
  lunchFishMeat: 25,
  eveningTea: 8,
};

const initialMenuItems: MenuItem[] = [
  { itemCode: 'morningTea', itemName: 'Morning Tea', unitPrice: 8, active: true },
  { itemCode: 'lunchMeals', itemName: 'Lunch: Meals', unitPrice: 40, active: true },
  { itemCode: 'lunchEgg', itemName: 'Lunch: Egg (add-on)', unitPrice: 10, active: true },
  { itemCode: 'lunchFishMeat', itemName: 'Lunch: Fish/Meat (add-on)', unitPrice: 25, active: true },
  { itemCode: 'eveningTea', itemName: 'Evening Tea', unitPrice: 8, active: true },
];

export const DataProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [users, setUsers] = useLocalStorage<User[]>('canteen_users', initialUsers);
  const [orders, setOrders] = useLocalStorage<Order[]>('canteen_orders', []);
  const [prices, setPrices] = useLocalStorage<Prices>('canteen_prices', initialPrices);
  const [menuItems, setMenuItems] = useLocalStorage<MenuItem[]>('canteen_menu_items', initialMenuItems);
  const [holidays, setHolidays] = useState<string[]>([]);
  const [cloudSyncing, setCloudSyncing] = useState(false);
  const hydrated = useRef(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!supabaseEnabled) {
        hydrated.current = true;
        return;
      }

      try {
        const cloud = await loadSupabaseData();

        if (!cancelled && cloud) {
          setUsers(prev => {
            const byId = new Map(prev.map(u => [u.id, u]));
            cloud.users.forEach(u => {
              const old = byId.get(u.id);
              byId.set(u.id, {
                ...(old || u),
                ...u,
                password: old?.password || u.password || '',
              });
            });
            return Array.from(byId.values());
          });

          setOrders(cloud.orders);
          setPrices(cloud.prices);
          if (cloud.menuItems?.length) setMenuItems(cloud.menuItems);
          if (Array.isArray(cloud.holidays)) setHolidays(cloud.holidays);
        }
      } catch (e) {
        console.warn('Supabase sync unavailable; continuing with local data.', e);
      } finally {
        if (!cancelled) hydrated.current = true;
      }
    })();

    return () => { cancelled = true; };
  }, [setUsers, setOrders, setPrices, setMenuItems]);

  useEffect(() => {
    if (!supabaseEnabled || !hydrated.current) return;

    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      setCloudSyncing(true);
      try {
        await Promise.all(orders.map(o => upsertOrder(o, prices)));
        await upsertPrices(prices, menuItems);
      } catch (e) {
        console.warn('Supabase write failed; local data retained.', e);
      } finally {
        setCloudSyncing(false);
      }
    }, 700);

    return () => window.clearTimeout(timer.current);
  }, [orders, prices, menuItems]);

  const addHoliday = async (date: string) => {
    if (holidays.includes(date)) return;
    await saveHoliday(date);
    setHolidays(prev => prev.includes(date) ? prev : [...prev, date]);
  };

  const deleteHoliday = async (date: string) => {
    await removeHoliday(date);
    setHolidays(prev => prev.filter(d => d !== date));
  };

  return (
    <DataContext.Provider
      value={{
        users,
        setUsers,
        orders,
        setOrders,
        prices,
        setPrices,
        menuItems,
        setMenuItems,
        holidays,
        setHolidays,
        addHoliday,
        deleteHoliday,
        cloudBackupEnabled: supabaseEnabled,
        cloudSyncing,
      }}
    >
      {children}
    </DataContext.Provider>
  );
};

export const useData = () => {
  const context = useContext(DataContext);
  if (!context) throw new Error('useData must be used within a DataProvider');
  return context;
};
