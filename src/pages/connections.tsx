import { Helmet } from '@dr.pogodin/react-helmet';
import { useEffect, useState, type ElementType } from 'react';
import { BookOpenText, CalendarDays, CheckCircle2, CirclePlus, CreditCard, Landmark, Search, ShoppingBag, Store, Truck, Unplug } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ProtectedRoute } from '@/lib/auth/auth-client';
import { connections } from 'virtual:content';

type ConnectionStatus = 'connected' | 'not_connected';
type ConnectionRecord = { provider: string; status: ConnectionStatus; connectedAt: string | null };

const toolIcons: Record<string, ElementType> = {
  toast: Store,
  stripe: CreditCard,
  quickbooks: BookOpenText,
  'google-calendar': CalendarDays,
  'uber-eats': Truck,
  shopify: ShoppingBag,
  'business-data-import': Landmark,
};

function ConnectionsContent() {
  const [statusByProvider, setStatusByProvider] = useState<Record<string, ConnectionStatus>>({});
  const [loading, setLoading] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [updatingProvider, setUpdatingProvider] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch('/api/connections', { credentials: 'include' });
        const payload = await response.json() as { connections?: ConnectionRecord[]; error?: string };
        if (!response.ok) throw new Error(payload.error || 'Unable to load connection status.');
        setStatusByProvider(Object.fromEntries((payload.connections || []).map((connection) => [connection.provider, connection.status])));
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Unable to load connection status.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function updateConnection(provider: string, status: ConnectionStatus) {
    setUpdatingProvider(provider);
    setError('');
    try {
      const response = await fetch(`/api/connections/${provider}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const payload = await response.json() as { status?: ConnectionStatus; error?: string };
      if (!response.ok || !payload.status) throw new Error(payload.error || 'Unable to update connection status.');
      setStatusByProvider((current) => ({ ...current, [provider]: payload.status! }));
      if (status === 'connected') setPickerOpen(false);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Unable to update connection status.');
    } finally {
      setUpdatingProvider('');
    }
  }

  const hasConnected = Object.values(statusByProvider).some((status) => status === 'connected');
  const normalizedQuery = query.trim().toLowerCase();
  const hasSearchMatch = connections.categories.some((category) => category.tools.some((tool) => (
    (statusByProvider[tool.id] || 'not_connected') !== 'connected'
    && (`${category.name} ${tool.name} ${tool.description}`.toLowerCase().includes(normalizedQuery))
  )));

  return (
    <main className="py-xxl">
      <div className="mx-auto max-w-content">
        <section className="rounded-3xl border border-border bg-card p-base shadow-sm sm:p-xl">
          <p className="text-sm font-bold text-primary">{connections.hero.eyebrow}</p>
          <div className="mt-sm flex flex-col gap-base sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="max-w-3xl text-3xl font-extrabold tracking-tight text-secondary sm:text-4xl">{connections.hero.title}</h1>
              <p className="mt-base max-w-3xl text-base leading-7 text-muted-foreground">{connections.hero.description}</p>
            </div>
            <button type="button" onClick={() => setPickerOpen(true)} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-bold text-primary-foreground transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><CirclePlus className="h-4 w-4" />{connections.hero.connect}</button>
          </div>
        </section>

        <section className="mt-xl rounded-2xl border border-primary bg-accent p-base" aria-labelledby="connections-notice">
          <div className="flex gap-3">
            <Landmark className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
            <div>
              <h2 id="connections-notice" className="font-extrabold text-secondary">{connections.notice.title}</h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">{connections.notice.description}</p>
            </div>
          </div>
        </section>

        {error && <p role="alert" className="mt-base rounded-xl border border-destructive bg-card p-4 text-sm font-semibold text-destructive">{error}</p>}

        <section className="mt-xl rounded-2xl border border-border bg-card p-base shadow-sm sm:p-xl" aria-labelledby="connected-tools-title">
          <div className="flex flex-col gap-sm sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 id="connected-tools-title" className="text-2xl font-extrabold text-secondary">{connections.connected.title}</h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">{connections.connected.description}</p>
            </div>
            {hasConnected && <button type="button" onClick={() => setPickerOpen(true)} className="text-sm font-bold text-primary transition-colors hover:text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{connections.hero.connect}</button>}
          </div>

          {!hasConnected && !loading && <div className="mt-base rounded-xl bg-muted p-base"><h3 className="font-extrabold text-secondary">{connections.connected.emptyTitle}</h3><p className="mt-1 text-sm leading-6 text-muted-foreground">{connections.connected.emptyDescription}</p></div>}
          {loading && <div className="mt-base h-20 animate-pulse rounded-xl bg-muted" />}
          <div className="mt-base grid grid-cols-1 gap-sm">
            {connections.categories.map((category) => category.tools.map((tool) => {
              const connected = (statusByProvider[tool.id] || 'not_connected') === 'connected';
              const Icon = toolIcons[tool.id] || Store;
              const busy = updatingProvider === tool.id;
              return connected ? <article key={tool.id} className="flex flex-col gap-base rounded-xl border border-border p-base sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent text-primary"><Icon className="h-5 w-5" /></span><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="font-extrabold text-secondary">{tool.name}</h3><span className="inline-flex items-center gap-1 rounded-full bg-[hsl(var(--workspace-sales-soft))] px-2.5 py-1 text-xs font-bold text-[hsl(var(--workspace-sales-ink))]"><CheckCircle2 className="h-3.5 w-3.5" />{category.name}</span></div><p className="mt-1 text-sm text-muted-foreground">{connections.connected.willUse}: <span>{tool.data}</span></p></div></div>
                <button type="button" onClick={() => void updateConnection(tool.id, 'not_connected')} disabled={busy} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full border border-border bg-card px-4 py-2.5 text-sm font-bold text-secondary transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"><Unplug className="h-4 w-4" />{busy ? connections.available.working : connections.connected.disconnect}</button>
              </article> : null;
            }))}
          </div>
        </section>

        <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
          <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle className="text-2xl font-extrabold text-secondary">{connections.available.title}</DialogTitle>
              <p className="text-sm leading-6 text-muted-foreground">{connections.available.description}</p>
            </DialogHeader>
            <label className="relative mt-sm block"><span className="sr-only">{connections.available.searchLabel}</span><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search tools or categories" className="pl-10" /></label>
            <div className="mt-base grid gap-lg">
              {connections.categories.map((category) => {
                const categoryMatches = category.tools.some((tool) => (statusByProvider[tool.id] || 'not_connected') !== 'connected' && `${category.name} ${tool.name} ${tool.description}`.toLowerCase().includes(normalizedQuery));
                return categoryMatches ? <section key={category.id} aria-labelledby={`category-${category.id}`}><h3 id={`category-${category.id}`} className="text-sm font-extrabold text-secondary">{category.name}</h3><div className="mt-sm grid gap-sm">{category.tools.map((tool) => {
                  const available = (statusByProvider[tool.id] || 'not_connected') !== 'connected' && `${category.name} ${tool.name} ${tool.description}`.toLowerCase().includes(normalizedQuery);
                  const Icon = toolIcons[tool.id] || Store;
                  const busy = updatingProvider === tool.id;
                  return available ? <article key={tool.id} className="flex flex-col gap-base rounded-xl border border-border p-base sm:flex-row sm:items-center sm:justify-between"><div className="flex items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted text-primary"><Icon className="h-5 w-5" /></span><div><h4 className="font-extrabold text-secondary">{tool.name}</h4><p className="mt-1 text-sm leading-6 text-muted-foreground">{tool.description}</p></div></div><button type="button" disabled={busy} onClick={() => void updateConnection(tool.id, 'connected')} className="shrink-0 rounded-full bg-primary px-4 py-2 text-sm font-bold text-primary-foreground transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60">{busy ? connections.available.working : connections.available.connect}</button></article> : null;
                })}</div></section> : null;
              })}
              {!hasSearchMatch && <p className="rounded-xl bg-muted p-base text-sm font-semibold text-muted-foreground">{connections.available.noResults}</p>}
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </main>
  );
}

export default function ConnectionsPage() {
  return <><Helmet><title>{connections.seo.title}</title><meta name="description" content={connections.seo.description} /><link rel="canonical" href="https://connectionpilot.net/connections" /></Helmet><ProtectedRoute><ConnectionsContent /></ProtectedRoute></>;
}
