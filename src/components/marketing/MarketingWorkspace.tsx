import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { ContentItem } from '@/lib/marketing-content';
import type { Idea } from '@/server/marketing/generate';
import ContentCalendar from './ContentCalendar';
import ContentEditor from './ContentEditor';
import ContentLibrary from './ContentLibrary';
import ContentStudio from './ContentStudio';
import PilotIdeas from './PilotIdeas';
import type { Exchange } from './PilotThread';
import { api, Notice, type WorkspaceData } from './shared';

type Tab = 'create' | 'ideas' | 'library' | 'scheduled';
const tabs: Array<[Tab, string, string]> = [
  ['create', 'Create', ''],
  ['ideas', 'Pilot’s Ideas', 'What Pilot thinks you should post.'],
  ['library', 'Library', 'What Pilot has made for you.'],
  ['scheduled', 'Scheduled', 'What’s coming up.'],
];

/**
 * Marketing as an AI employee, not a database: tell Pilot what you want, see what Pilot recommends, find what it has made,
 * and see what is coming up. Everything about the business itself (website, logo, colours, hours, services, contact, photos) is on the
 * Business information page, and every "add your business information" prompt here goes there.
 */
export default function MarketingWorkspace({ onGoToBusiness }: { onGoToBusiness: () => void }) {
  const [view, setView] = useState<Tab>('create');
  const [data, setData] = useState<WorkspaceData | null>(null);
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  // the conversation lives here, so it is still there when the owner looks at the Library or the calendar and comes back
  const [thread, setThread] = useState<Exchange[]>([]);
  const [pendingIdea, setPendingIdea] = useState<Idea | null>(null);

  const load = useCallback(async () => {
    const result = await api<WorkspaceData>('/api/marketing/workspace');
    if (!result.ok) { setError(result.data.error || 'Unable to load your marketing workspace.'); return; }
    setError(''); setData(result.data);
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (!data) return <main className="grid gap-4">{error ? <Notice tone="warn">{error}</Notice> : <div className="flex min-h-[320px] items-center justify-center"><Loader2 size={28} className="animate-spin text-primary" aria-label="Loading" /></div>}</main>;

  const opened = data.items.find((item) => item.id === openId) ?? null;
  const replace = (item: ContentItem) => setData((current) => (current ? { ...current, items: current.items.some((row) => row.id === item.id) ? current.items.map((row) => (row.id === item.id ? item : row)) : [item, ...current.items] } : current));
  const tagline = tabs.find(([id]) => id === view)![2];

  return <main className={`grid min-w-0 grid-cols-[minmax(0,1fr)] ${view === 'create' ? 'gap-3' : 'gap-6'}`}>
    <header className="flex flex-wrap items-end justify-between gap-3"><div><h1 id="marketing-title" className={`${view === 'create' ? 'text-2xl sm:text-3xl' : 'text-3xl sm:text-4xl'} font-extrabold tracking-[-0.045em] text-secondary`}>Pilot Marketing</h1>
      {tagline && <p className="mt-1 text-base text-muted-foreground">{tagline}</p>}</div></header>

    <div role="tablist" aria-label="Marketing sections" className="flex flex-wrap gap-2">{tabs.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={view === id} onClick={() => setView(id)} className={`rounded-xl px-3.5 py-2 text-sm font-bold sm:px-5 sm:py-2.5 sm:text-base ${view === id ? 'bg-secondary text-secondary-foreground' : 'border border-border bg-card text-secondary hover:border-primary'}`}>{label}</button>)}</div>
    {error && <Notice tone="warn">{error}</Notice>}

    {view === 'create' && <ContentStudio data={data} thread={thread} setThread={setThread} pendingIdea={pendingIdea} onPendingHandled={() => setPendingIdea(null)} onOpen={setOpenId} onReload={load} onGoToLibrary={() => setView('library')} onGoToCalendar={() => setView('scheduled')} onGoToBusiness={onGoToBusiness} />}
    {view === 'ideas' && <PilotIdeas data={data} onMake={(idea) => { setPendingIdea(idea); setView('create'); }} onGoToBusiness={onGoToBusiness} />}
    {view === 'library' && <ContentLibrary data={data} onOpen={setOpenId} onReload={load} />}
    {view === 'scheduled' && <ContentCalendar data={data} onOpen={setOpenId} onReload={load} />}

    {opened && <ContentEditor key={opened.id} item={opened} businessName={data.business.name} setup={data.setup} timezone={data.timezone} onChange={(item) => { replace(item); void load(); }} onRemoved={(id) => { setData((current) => (current ? { ...current, items: current.items.filter((row) => row.id !== id) } : current)); void load(); }} onClose={() => setOpenId(null)} />}
  </main>;
}
