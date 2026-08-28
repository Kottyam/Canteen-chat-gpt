import React, { createContext, useContext, ReactNode, useEffect, useRef, useState } from 'react';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { User, Order, Prices, Status } from '../types';
import { ADMIN_USER_ID, DEFAULT_ADMIN_PASSWORD } from '../constants';
import { loadSupabaseData, upsertOrder, cancelOrder, upsertPrices } from '../services/supabaseSync';
import { supabaseEnabled } from '../supabase';

interface DataContextType {
    users: User[]; setUsers: React.Dispatch<React.SetStateAction<User[]>>;
    orders: Order[]; setOrders: React.Dispatch<React.SetStateAction<Order[]>>;
    prices: Prices; setPrices: React.Dispatch<React.SetStateAction<Prices>>;
    cloudBackupEnabled: boolean; cloudSyncing: boolean;
}
const DataContext = createContext<DataContextType | undefined>(undefined);
const initialUsers: User[] = [{ id: ADMIN_USER_ID, name: 'GoCanteen Administrator', mobile: '', password: DEFAULT_ADMIN_PASSWORD, role: 'admin', status: 'active' as Status, isFirstLogin: false }];
const initialPrices: Prices = { morningTea: 8, lunchMeals: 40, lunchEgg: 10, lunchFishMeat: 25, eveningTea: 8 };

export const DataProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [users, setUsers] = useLocalStorage<User[]>('canteen_users', initialUsers);
    const [orders, setOrders] = useLocalStorage<Order[]>('canteen_orders', []);
    const [prices, setPrices] = useLocalStorage<Prices>('canteen_prices', initialPrices);
    const [cloudSyncing, setCloudSyncing] = useState(false);
    const hydrated = useRef(false);
    const timer = useRef<number | undefined>(undefined);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            if (!supabaseEnabled) { hydrated.current = true; return; }
            try {
                const cloud = await loadSupabaseData();
                if (!cancelled && cloud) {
                    setUsers(prev => {
                        const byId = new Map(prev.map(u => [u.id, u]));
                        cloud.users.forEach(u => {
                            const old = byId.get(u.id);
                            byId.set(u.id, { ...(old || u), ...u, password: old?.password || u.password || '' });
                        });
                        return Array.from(byId.values());
                    });
                    setOrders(cloud.orders);
                    setPrices(cloud.prices);
                }
            } catch (e) { console.warn('Supabase sync unavailable; continuing with local data.', e); }
            finally { if (!cancelled) hydrated.current = true; }
        })();
        return () => { cancelled = true; };
    }, [setUsers, setOrders, setPrices]);

    useEffect(() => {
        if (!supabaseEnabled || !hydrated.current) return;
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(async () => {
            setCloudSyncing(true);
            try {
                await Promise.all(orders.map(o => upsertOrder(o, prices)));
                await upsertPrices(prices);
            } catch (e) { console.warn('Supabase write failed; local data retained.', e); }
            finally { setCloudSyncing(false); }
        }, 700);
        return () => window.clearTimeout(timer.current);
    }, [orders, prices]);

    useEffect(() => {
        if (!supabaseEnabled || !hydrated.current) return;
        const cancelledIds = orders.filter(o => false).map(o => o.id);
        void cancelledIds;
    }, [orders]);

    return <DataContext.Provider value={{ users, setUsers, orders, setOrders, prices, setPrices, cloudBackupEnabled: supabaseEnabled, cloudSyncing }}>{children}</DataContext.Provider>;
};
export const useData = () => { const context = useContext(DataContext); if (!context) throw new Error('useData must be used within a DataProvider'); return context; };
