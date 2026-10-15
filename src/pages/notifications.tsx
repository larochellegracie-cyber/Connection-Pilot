import { Helmet } from '@dr.pogodin/react-helmet';
import { BellRing, CheckCircle2, Clock3, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { ProtectedRoute } from '@/lib/auth/auth-client';
import WorkspaceLayout from '@/layouts/WorkspaceLayout';
import PilotAvatar from '@/components/PilotAvatar';
import { notifications } from 'virtual:content';

type Notification = { id: string; type: string; title: string; detail: string; beforeDetails: string | null; afterDetails: string | null; readAt: string | null; createdAt: string; customerId: string; customerName: string };

function notificationIcon(type: string) {
  if (type === 'appointment_cancelled') return <XCircle className="text-destructive" size={20} />;
  if (type === 'appointment_rescheduled') return <Clock3 className="text-primary" size={20} />;
  return <BellRing className="text-primary" size={20} />;
}

function NotificationsContent() {
  const [notificationItems, setNotificationItems] = useState<Notification[]>([]);
  const [error, setError] = useState('');

  async function loadNotifications() {
    const response = await fetch('/api/notifications', { credentials: 'include' });
    const payload = await response.json() as { notifications?: Notification[]; error?: string };
    if (!response.ok) throw new Error(payload.error || 'Unable to load notifications.');
    setNotificationItems(payload.notifications || []);
  }

  useEffect(() => { void loadNotifications().catch((loadError: unknown) => setError(loadError instanceof Error ? loadError.message : 'Unable to load notifications.')); }, []);

  async function markRead(id: string) {
    const response = await fetch(`/api/notifications/${id}`, { method: 'PATCH', credentials: 'include' });
    if (!response.ok) return;
    setNotificationItems((current) => current.map((notification) => notification.id === id ? { ...notification, readAt: new Date().toISOString() } : notification));
  }

  return <WorkspaceLayout><main className="grid gap-xl">
    <section className="border-b border-border pb-lg"><div className="flex items-center gap-2"><PilotAvatar size="sm" /><p className="text-sm font-bold text-primary">Pilot noticed</p></div><h1 className="mt-xs text-4xl font-extrabold tracking-[-0.045em] text-secondary">{notifications.hero.title}</h1><p className="mt-sm max-w-2xl text-muted-foreground">{notifications.hero.description}</p></section>
    {error && <p role="alert" className="rounded-xl border border-destructive bg-card p-4 text-sm font-bold text-destructive">{error}</p>}
    <section className="overflow-hidden rounded-3xl border border-border bg-card">
      {notificationItems.length === 0 ? <div className="px-base py-xl text-center"><CheckCircle2 className="mx-auto text-primary" size={28} /><h2 className="mt-base text-xl font-extrabold text-secondary">{notifications.empty.title}</h2><p className="mt-sm text-sm text-muted-foreground">{notifications.empty.description}</p></div> : <div className="divide-y divide-border">{notificationItems.map((notification) => <article key={notification.id} className={`grid gap-3 p-base sm:grid-cols-[auto_1fr_auto] sm:items-start ${notification.readAt ? 'bg-card' : 'bg-accent'}`}><div className="rounded-xl bg-card p-2 shadow-sm">{notificationIcon(notification.type)}</div><div><div className="flex flex-wrap items-center gap-2"><h2 className="font-extrabold text-secondary">{notification.title}</h2>{!notification.readAt && <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-bold text-primary-foreground">{notifications.labels.new}</span>}</div><p className="mt-1 text-sm leading-6 text-muted-foreground">{notification.detail}</p><div className="mt-3 grid gap-1 text-sm">{notification.beforeDetails && <p className="font-semibold text-secondary"><span>{notifications.labels.original}</span><span>{notification.beforeDetails}</span></p>}{notification.afterDetails && <p className="font-semibold text-secondary"><span>notifications.labels.updated</span><span>{notification.afterDetails}</span></p>}</div><Link to={`/dashboard/customers/${notification.customerId}`} className="mt-3 inline-block text-sm font-bold text-primary hover:text-secondary"><span>{notifications.labels.openProfile}</span><span> · </span><span>{notification.customerName}</span></Link></div><div className="flex flex-row gap-3 sm:flex-col sm:items-end"><time dateTime={notification.createdAt} className="text-xs font-semibold text-muted-foreground">{new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(notification.createdAt))}</time>{!notification.readAt && <button onClick={() => void markRead(notification.id)} className="text-sm font-bold text-primary hover:text-secondary">{notifications.labels.markRead}</button>}</div></article>)}</div>}
    </section>
  </main></WorkspaceLayout>;
}

export default function NotificationsPage() { return <><Helmet><title>{notifications.meta.title}</title><meta name="description" content={notifications.meta.description} /><meta name="robots" content="noindex, nofollow" /></Helmet><ProtectedRoute><NotificationsContent /></ProtectedRoute></>; }
