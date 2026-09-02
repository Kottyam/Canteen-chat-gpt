import React, { useEffect, useState } from 'react';
import { supabase, supabaseEnabled } from '../../supabase';
import { loadMyNotifications, markNotificationRead, NotificationRow } from '../../services/notifications';

const NotificationBell: React.FC = () => {
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [open, setOpen] = useState(false);
  const load = async () => { try { setItems(await loadMyNotifications()); } catch (e) { console.warn('Notification load failed.', e); } };
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 15000);
    let channel: ReturnType<NonNullable<typeof supabase>['channel']> | undefined;
    if (supabaseEnabled && supabase) channel = supabase.channel('employee-notifications').on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' }, () => void load()).subscribe();
    return () => { window.clearInterval(timer); if (channel) void channel.unsubscribe(); };
  }, []);
  const unread = items.filter(n => !n.read_at).length;
  const openNotification = async (n: NotificationRow) => { if (!n.read_at) { await markNotificationRead(n.id); setItems(prev => prev.map(x => x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)); } setOpen(false); };
  return <div className="relative shrink-0"><button type="button" aria-label="Notifications" onClick={() => setOpen(v => !v)} className="relative flex h-11 w-11 items-center justify-center rounded-full bg-gray-100 text-xl hover:bg-gray-200">🔔{unread > 0 && <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">{unread > 9 ? '9+' : unread}</span>}</button>{open && <div className="absolute right-0 top-12 z-50 w-[min(92vw,360px)] overflow-hidden rounded-xl border bg-white shadow-xl"><div className="flex items-center justify-between border-b px-4 py-3"><span className="font-bold text-gray-800">Notifications</span><span className="text-xs text-gray-500">{unread} unread</span></div><div className="max-h-80 overflow-y-auto">{items.length === 0 ? <p className="p-4 text-sm text-gray-500">No notifications.</p> : items.slice(0,20).map(n => <button key={n.id} type="button" onClick={() => void openNotification(n)} className={`block w-full border-b px-4 py-3 text-left ${n.read_at ? 'bg-white' : 'bg-primary-50'}`}><div className="font-semibold text-gray-800">{n.title}</div><div className="mt-1 text-sm text-gray-600">{n.message}</div><div className="mt-1 text-[11px] text-gray-400">{new Date(n.created_at).toLocaleString()}</div></button>)}</div></div>}</div>;
};
export default NotificationBell;
