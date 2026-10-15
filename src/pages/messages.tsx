import { BotMessageSquare, MessageSquareText, Radio, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Helmet } from '@dr.pogodin/react-helmet';
import { ProtectedRoute } from '@/lib/auth/auth-client';
import WorkspaceLayout from '@/layouts/WorkspaceLayout';
import { messages } from 'virtual:content';

type Message = { id: string; customerId: string; customerName: string; channel: string; direction: string; content: string; occurredAt: string };
type MessagingStatus = { proAccess: boolean; phoneConnected: boolean; enabled: boolean; ready: boolean; phoneNumber: string | null; message: string };

function MessagesContent() {
  const [items, setItems] = useState<Message[]>([]);
  const [messaging, setMessaging] = useState<MessagingStatus | null>(null);
  const [error, setError] = useState('');
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const [messageResponse, statusResponse] = await Promise.all([
          fetch('/api/messages', { credentials: 'include' }),
          fetch('/api/customer-messaging', { credentials: 'include' }),
        ]);
        const messagePayload = await messageResponse.json() as { messages?: Message[]; error?: string };
        const statusPayload = await statusResponse.json() as { messaging?: MessagingStatus; error?: string };
        if (!messageResponse.ok) throw new Error(messagePayload.error || 'Unable to load customer messages.');
        if (!statusResponse.ok || !statusPayload.messaging) throw new Error(statusPayload.error || 'Unable to load AI Customer Messaging status.');
        setItems(messagePayload.messages || []);
        setMessaging(statusPayload.messaging);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Unable to load customer messages.');
      }
    })();
  }, []);

  async function toggleMessaging() {
    if (!messaging) return;
    setUpdating(true);
    setError('');
    try {
      const response = await fetch('/api/customer-messaging', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !messaging.enabled }),
      });
      const payload = await response.json() as { messaging?: MessagingStatus; error?: string };
      if (!response.ok || !payload.messaging) throw new Error(payload.error || 'Unable to update AI Customer Messaging.');
      setMessaging(payload.messaging);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Unable to update AI Customer Messaging.');
    } finally {
      setUpdating(false);
    }
  }

  return <WorkspaceLayout><main className="grid gap-xl"><section className="border-b border-border pb-lg"><p className="text-sm font-bold text-primary">{messages.hero.eyebrow}</p><h1 className="mt-xs text-4xl font-extrabold tracking-[-0.045em] text-secondary">{messages.hero.title}</h1><p className="mt-sm max-w-2xl text-muted-foreground">{messages.hero.description}</p></section>
    <section className="rounded-3xl border border-border bg-card p-base shadow-sm sm:p-xl" aria-labelledby="ai-customer-messaging-title">
      <div className="flex flex-col gap-base sm:flex-row sm:items-start sm:justify-between"><div className="flex gap-3"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-accent text-primary"><BotMessageSquare size={21} /></span><div><div className="flex flex-wrap items-center gap-2"><h2 id="ai-customer-messaging-title" className="text-xl font-extrabold text-secondary">{messages.labels.aiMessaging}</h2>{messaging?.ready ? <span className="rounded-full bg-primary px-2.5 py-1 text-xs font-bold text-primary-foreground">{messages.labels.active}</span> : <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-bold text-muted-foreground">{messaging?.proAccess ? messages.labels.comingSoon : messages.labels.proRequired}</span>}</div><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{messaging?.message || 'Loading AI Customer Messaging status.'}</p></div></div>
      {messaging?.proAccess && messaging.phoneConnected && <button type="button" onClick={() => void toggleMessaging()} disabled={updating} className="rounded-full bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60">{updating ? 'Updating…' : messaging.enabled ? messages.labels.deactivate : messages.labels.activate}</button>}</div>
      <div className="mt-base grid grid-cols-1 gap-sm border-t border-border pt-base sm:grid-cols-2"><div className="flex items-start gap-2 text-sm text-muted-foreground"><Radio className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><span><strong className="text-secondary">{messages.labels.provider}:</strong> {messaging?.phoneConnected ? messaging.phoneNumber : messages.labels.notConnected}</span></div><div className="flex items-start gap-2 text-sm text-muted-foreground"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><span>{messages.labels.deliveryNote}</span></div></div>
    </section>
    {error && <p role="alert" className="rounded-xl border border-destructive bg-card p-4 text-sm font-bold text-destructive">{error}</p>}
    <section className="overflow-hidden rounded-3xl border border-border bg-card" aria-label="Customer conversation history">{items.length === 0 ? <div className="px-base py-xl text-center"><MessageSquareText className="mx-auto text-primary" size={28} /><h2 className="mt-base text-xl font-extrabold text-secondary">{messages.empty.title}</h2><p className="mt-sm text-sm text-muted-foreground">{messages.empty.description}</p></div> : <div className="divide-y divide-border">{items.map((message) => <article key={`${message.channel}-${message.id}`} className="grid gap-3 p-base sm:grid-cols-[1fr_auto]"><div><div className="flex flex-wrap items-center gap-2"><h2 className="font-extrabold text-secondary">{message.customerName}</h2><span className="rounded-full bg-accent px-2.5 py-1 text-xs font-bold text-primary">{message.direction === 'outbound' ? messages.labels.outbound : messages.labels.inbound}</span><span className="text-xs font-semibold text-muted-foreground">{message.channel}</span></div><p className="mt-2 text-sm leading-6 text-secondary">{message.content}</p><Link to={`/dashboard/customers/${message.customerId}`} className="mt-3 inline-block text-sm font-bold text-primary hover:text-secondary">{messages.labels.openCustomer}</Link></div><time dateTime={message.occurredAt} className="text-xs font-semibold text-muted-foreground">{new Intl.DateTimeFormat('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(message.occurredAt))}</time></article>)}</div>}</section>
  </main></WorkspaceLayout>;
}

export default function MessagesPage() {
  return <><Helmet><title>{messages.meta.title}</title><meta name="description" content={messages.meta.description} /><meta name="robots" content="noindex, nofollow" /></Helmet><ProtectedRoute><MessagesContent /></ProtectedRoute></>;
}
