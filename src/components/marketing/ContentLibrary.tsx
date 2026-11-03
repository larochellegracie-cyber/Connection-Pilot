import { useState } from 'react';
import { FileText, Loader2, Search, Video } from 'lucide-react';
import { platformSpecs } from '@/lib/marketing-content';
import { api, friendlyStatus, Notice, primaryButton, titleOf, type WorkspaceData } from './shared';


/** What Pilot has made that isn't on the calendar yet, as simple cards. Open one to edit, approve, schedule or delete it. */
export default function ContentLibrary({ data, onOpen, onReload }: { data: WorkspaceData; onOpen: (id: string) => void; onReload: () => Promise<void> }) {
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const query = search.trim().toLowerCase();
  const inLibrary = data.items.filter((item) => item.status !== 'scheduled' && item.status !== 'published'); // scheduled and posted content lives on the calendar
  const shown = inLibrary.filter((item) => !query || `${item.topic} ${item.hook} ${item.caption}`.toLowerCase().includes(query));
  const proposed = inLibrary.filter((item) => item.status === 'proposed');

  async function approveAll() {
    setBusy(true); setError('');
    const result = await api('/api/marketing/plan/decision', 'POST', { ids: proposed.map((item) => item.id), decision: 'approve' });
    setBusy(false);
    if (!result.ok) { setError(result.data.error || 'That did not work.'); return; }
    await onReload();
  }

  if (inLibrary.length === 0) return <p className="cp-card px-6 py-12 text-center text-lg text-muted-foreground">Nothing here yet. Tell Pilot what you want on the Create tab.</p>;

  return <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-5">
    {inLibrary.length > 6 && <label className="relative block max-w-md"><span className="sr-only">Search your library</span><Search size={16} className="pointer-events-none absolute left-3.5 top-3.5 text-muted-foreground" aria-hidden="true" /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search your library" className="w-full rounded-xl border border-border bg-card py-3 pl-10 pr-3 text-sm text-secondary outline-none focus:border-primary focus:ring-2 focus:ring-ring" /></label>}
    {proposed.length > 0 && <div className="cp-card flex flex-wrap items-center justify-between gap-3 p-4"><p className="text-sm font-bold text-secondary">Pilot planned {proposed.length} {proposed.length === 1 ? 'piece' : 'pieces'} for you. Nothing is approved until you say so.</p><button type="button" disabled={busy} onClick={() => void approveAll()} className={primaryButton}>{busy ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : null}Approve all</button></div>}
    {error && <Notice tone="warn">{error}</Notice>}
    {shown.length === 0 ? <p className="rounded-xl bg-muted px-4 py-8 text-center text-sm text-muted-foreground">Nothing matches that.</p> :
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{shown.map((item) => {
        const url = item.video?.render.status === 'ready' ? item.video.render.url : '';
        return <li key={item.id} className="min-w-0"><button type="button" onClick={() => onOpen(item.id)} className="cp-card grid h-full w-full content-start gap-3 overflow-hidden p-0 text-left transition hover:border-primary">
          {item.kind === 'post' && item.image && <img src={item.image.url} alt="" loading="lazy" className="aspect-video w-full bg-muted object-cover" />}
          {item.kind === 'video' && (url ? <video src={`${url}#t=0.5`} muted playsInline preload="metadata" aria-hidden="true" className="aspect-video w-full bg-black object-cover" /> : <span className="flex aspect-video w-full items-center justify-center bg-accent text-primary"><Video size={28} aria-hidden="true" /></span>)}
          <span className="grid gap-1.5 px-5 pb-5 pt-1" style={item.kind === 'video' || item.image ? undefined : { paddingTop: '1.25rem' }}>
            <span className="flex items-center gap-1.5 text-xs font-bold text-muted-foreground">{item.kind === 'video' ? <Video size={13} aria-hidden="true" /> : <FileText size={13} aria-hidden="true" />}{item.kind === 'video' ? 'Video' : 'Post'} · {platformSpecs[item.platform].label}</span>
            <span className="line-clamp-2 text-lg font-extrabold leading-snug tracking-[-0.02em] text-secondary">{titleOf(item)}</span>
            {item.kind === 'post' && <span className="line-clamp-2 text-sm text-muted-foreground">{item.caption}</span>}
            <span className={`mt-1 text-sm font-bold ${item.status === 'draft' || item.status === 'proposed' ? 'text-primary' : 'text-muted-foreground'}`}>{friendlyStatus[item.status]}</span>
          </span></button></li>;
      })}</ul>}
  </div>;
}
