import React, { useEffect, useState } from 'react';
import { Bell, CheckCheck, CircleAlert } from 'lucide-react';
import { fetchSaccoJson } from '../lib/api';

type NotificationItem = {
  id: string;
  category: string;
  title: string;
  message: string;
  destination?: string;
  created_at: string;
  read_at?: string;
};

type NotificationResponse = { items: NotificationItem[]; unreadCount: number };

export default function NotificationCenter({ token, onNavigate }: { token: string; onNavigate: (destination: string) => void }) {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);

  const load = async () => {
    try {
      const result = await fetchSaccoJson<NotificationResponse>('/api/notifications?limit=20', {}, token);
      setNotifications(result.items);
      setUnreadCount(result.unreadCount);
    } catch {
      // A notification refresh must not interrupt normal SACCO work.
    }
  };

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(timer);
  }, [token]);

  const markRead = async (notification: NotificationItem) => {
    if (!notification.read_at) {
      try {
        await fetchSaccoJson<{ updated: true }>(`/api/notifications/${notification.id}/read`, { method: 'POST' }, token);
        setNotifications(current => current.map(item => item.id === notification.id ? { ...item, read_at: new Date().toISOString() } : item));
        setUnreadCount(current => Math.max(0, current - 1));
      } catch {
        return;
      }
    }
    if (notification.destination) onNavigate(notification.destination);
    setOpen(false);
  };

  const markAllRead = async () => {
    try {
      await fetchSaccoJson<{ updated: true }>('/api/notifications/read-all', { method: 'POST' }, token);
      setNotifications(current => current.map(item => ({ ...item, read_at: item.read_at || new Date().toISOString() })));
      setUnreadCount(0);
    } catch {
      // Keep the unread state unchanged when the request cannot be completed.
    }
  };

  return <div className="relative"><button type="button" onClick={() => { setOpen(current => !current); if (!open) void load(); }} className="relative rounded-xl p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800" aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ''}`}><Bell className="h-5 w-5" />{unreadCount > 0 && <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-black text-white">{unreadCount > 99 ? '99+' : unreadCount}</span>}</button>{open && <section className="absolute right-0 z-50 mt-2 w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"><header className="flex items-center justify-between border-b border-slate-100 px-4 py-3"><div><h2 className="text-sm font-black text-slate-900">Notifications</h2><p className="text-[11px] text-slate-500">Workflow reminders for your account</p></div>{unreadCount > 0 && <button type="button" onClick={() => void markAllRead()} className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700"><CheckCheck className="h-4 w-4" /> Mark all read</button>}</header><div className="max-h-[min(70vh,32rem)] overflow-y-auto">{notifications.map(notification => <button key={notification.id} type="button" onClick={() => void markRead(notification)} className={`w-full border-b border-slate-100 p-4 text-left transition hover:bg-slate-50 ${notification.read_at ? 'bg-white' : 'bg-emerald-50/60'}`}><div className="flex gap-2"><CircleAlert className={`mt-0.5 h-4 w-4 shrink-0 ${notification.read_at ? 'text-slate-400' : 'text-emerald-700'}`} /><div className="min-w-0"><div className="flex items-center justify-between gap-3"><p className="text-sm font-bold text-slate-900">{notification.title}</p>{!notification.read_at && <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-600" />}</div><p className="mt-1 text-xs leading-5 text-slate-600">{notification.message}</p><p className="mt-2 text-[10px] font-medium uppercase tracking-wider text-slate-400">{new Date(notification.created_at).toLocaleString('en-KE')}{notification.destination ? ` · Open ${notification.destination}` : ''}</p></div></div></button>)}{!notifications.length && <div className="p-8 text-center text-sm text-slate-500"><Bell className="mx-auto mb-2 h-5 w-5 text-slate-300" />No notifications yet.</div>}</div></section>}</div>;
}
