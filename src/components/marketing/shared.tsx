import type { ReactNode } from 'react';
import { Link2, Sparkles, Video } from 'lucide-react';
import { platformSpecs, type ContentItem, type ContentStatus, type Evidence } from '@/lib/marketing-content';

export type { WorkspaceData } from '@/server/api/marketing/workspace/summary';

export async function api<T = Record<string, any>>(url: string, method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE' = 'GET', body?: unknown): Promise<{ ok: boolean; status: number; data: T & { error?: string; message?: string } }> {
  try {
    const response = await fetch(url, { method, credentials: 'include', headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await response.json().catch(() => ({})) as T & { error?: string; message?: string };
    return { ok: response.ok, status: response.status, data };
  } catch { return { ok: false, status: 0, data: { error: 'Could not reach Pilot. Check your connection and try again.' } as T & { error?: string } }; }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Checks on a video being made until it is ready or has really failed. A hiccup while checking is not a failure: the video may
 * still be coming, so only a failure the provider reports counts. Returns "stopped" if it is still not done when we give up
 * waiting (the video keeps being made, and opening it later checks again).
 */
export async function waitForVideo(id: string, alive: () => boolean, onItem: (item: ContentItem) => void): Promise<'ready' | 'failed' | 'stopped'> {
  let hiccups = 0;
  for (let attempt = 0; attempt < 150 && alive(); attempt += 1) {
    const result = await api<{ status?: string; item?: ContentItem }>(`/api/marketing/content/${id}/video`);
    if (result.data.item) onItem(result.data.item);
    if (result.data.status === 'ready') return 'ready';
    if (result.data.status === 'failed') return 'failed';
    if (!result.ok) { hiccups += 1; if (hiccups >= 6) return 'stopped'; } else hiccups = 0;
    await sleep(2000);
  }
  return 'stopped';
}

export const statusStyle: Record<ContentStatus, string> = {
  proposed: 'bg-[#EADFFD] text-[#4C1D95]', draft: 'bg-muted text-secondary', approved: 'bg-[#DCE7FF] text-[#12306b]', scheduled: 'bg-primary text-primary-foreground', published: 'bg-[#DDF3DF] text-[#14532d]',
};

/** What to call a piece of content: a video Pilot designed uses its own headline, not the sentence the owner typed. */
export const titleOf = (item: Pick<ContentItem, 'topic' | 'hook' | 'video'>) => (item.video?.plan ? item.hook : item.topic || item.hook);

/** The owner never needs to know "draft" from "proposed": both are simply waiting for them. */
export const friendlyStatus: Record<ContentStatus, string> = { proposed: 'Ready to review', draft: 'Ready to review', approved: 'Approved', scheduled: 'Scheduled', published: 'Posted' };

export function StatusChip({ status }: { status: ContentStatus }) { return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[0.6875rem] font-bold ${statusStyle[status]}`}>{friendlyStatus[status]}</span>; }

export function Section({ title, description, action, children, id, className = '' }: { title: string; description?: string; action?: ReactNode; children: ReactNode; id: string; className?: string }) {
  return <section aria-labelledby={id} className={`cp-card p-5 ${className}`}><div className="mb-4 flex flex-wrap items-start justify-between gap-3"><div><h2 id={id} className="text-base font-extrabold tracking-[-0.015em] text-secondary">{title}</h2>{description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}</div>{action}</div>{children}</section>;
}

export const Notice = ({ tone = 'info', children }: { tone?: 'info' | 'warn'; children: ReactNode }) => <p role={tone === 'warn' ? 'alert' : 'status'} className={`rounded-xl border p-3 text-sm ${tone === 'warn' ? 'border-destructive bg-card font-semibold text-destructive' : 'border-border bg-muted text-secondary'}`}>{children}</p>;

const sourceLabel: Record<Evidence['source'], string> = { insight: 'From your business', season: 'From the calendar', trend: 'Current web research', business: 'About your business' };

/** What a suggestion rests on, so nothing is taken on trust. */
export function EvidenceList({ evidence }: { evidence: Evidence[] }) {
  if (!evidence.length) return null;
  return <ul aria-label="What this is based on" className="grid gap-1.5">{evidence.map((row, index) => <li key={index} className="rounded-lg bg-muted px-2.5 py-1.5 text-xs text-secondary">
    <span className="font-bold">{sourceLabel[row.source]}:</span> {row.detail}
    {(row.asOf || row.confidence || row.url) && <span className="mt-0.5 block text-muted-foreground">{row.asOf ? `as of ${row.asOf}` : ''}{row.confidence ? ` · ${row.confidence} confidence` : ''}{row.url ? <> · <a href={row.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-semibold text-primary underline"><Link2 size={10} aria-hidden="true" />source</a></> : null}</span>}
  </li>)}</ul>;
}

/** A plain preview of how the content will look. It never claims to be the live post. */
export function SocialPreview({ item, businessName }: { item: Pick<ContentItem, 'platform' | 'kind' | 'hook' | 'caption' | 'cta' | 'hashtags' | 'suggestedVisual' | 'video' | 'image'>; businessName: string }) {
  const spec = platformSpecs[item.platform];
  return <article aria-label={`${spec.label} preview`} className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
    <header className="flex items-center gap-2 border-b border-border px-3 py-2"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-extrabold text-primary-foreground">{(businessName || 'B').charAt(0).toUpperCase()}</span><div><p className="text-sm font-extrabold text-secondary">{businessName || 'Your business'}</p><p className="text-[0.6875rem] text-muted-foreground">{spec.label} · preview</p></div></header>
    {item.kind === 'post' && item.image ? (item.image.motion ? <video src={item.image.motion} poster={item.image.url} autoPlay loop muted playsInline aria-label="The animated picture for this post" className="w-full bg-muted object-cover" /> : <img src={item.image.url} alt="The picture for this post" className="w-full bg-muted object-cover" />) : <div className="m-3 flex min-h-28 items-center justify-center rounded-xl border border-dashed border-border bg-[hsl(var(--canvas))] p-3 text-center text-xs text-muted-foreground">{item.kind === 'video' ? <span className="flex flex-col items-center gap-1"><Video size={18} aria-hidden="true" />{item.video?.render.status === 'ready' ? <><video src={item.video.render.url} controls playsInline preload="metadata" className="max-h-80 rounded-lg bg-black" /><a className="font-bold text-primary underline" href={item.video.render.url} target="_blank" rel="noreferrer">Open the video</a></> : 'Video not made yet. This is the plan.'}</span> : <span><Sparkles size={16} className="mx-auto mb-1" aria-hidden="true" />Suggested visual: {item.suggestedVisual || '—'}</span>}</div>}
    <div className="grid gap-1.5 px-3 pb-3 text-sm text-secondary"><p className="font-extrabold">{item.hook}</p><p className="whitespace-pre-wrap">{item.caption}</p><p className="font-bold text-primary">{item.cta}</p>{item.hashtags.length > 0 && <p className="text-primary">{item.hashtags.join(' ')}</p>}</div>
  </article>;
}

export const prettyTime = (time: string) => { const [hours, minutes] = time.split(':').map(Number); const hour12 = hours % 12 || 12; return `${hour12}:${String(minutes).padStart(2, '0')} ${hours < 12 ? 'a.m.' : 'p.m.'}`; };
export const todayKey = (timezone: string) => new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
export const prettyDay = (day: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' }).format(new Date(`${day}T12:00:00Z`));
export const primaryButton = 'inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60';
export const secondaryButton = 'inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-bold text-secondary transition hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-60';
export const fieldClass = 'mt-1 w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-secondary outline-none focus:border-primary focus:ring-2 focus:ring-ring';
