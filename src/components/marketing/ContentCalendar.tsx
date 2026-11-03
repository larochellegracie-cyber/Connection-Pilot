import { useMemo, useState } from 'react';
import { CheckCircle2, ChevronLeft, ChevronRight, FileText, Video } from 'lucide-react';
import { platformSpecs, type ContentItem } from '@/lib/marketing-content';
import { api, Notice, prettyTime, secondaryButton, titleOf, type WorkspaceData } from './shared';

const addDays = (day: string, days: number) => { const next = new Date(`${day}T12:00:00Z`); next.setUTCDate(next.getUTCDate() + days); return next.toISOString().slice(0, 10); };
const dow = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay();
const longDay = (day: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(`${day}T12:00:00Z`));
const byTime = (a: ContentItem, b: ContentItem) => (a.scheduledTime ?? '99:99').localeCompare(b.scheduledTime ?? '99:99') || a.createdAt.localeCompare(b.createdAt);

/**
 * A real calendar of what is scheduled, by month or by week. Posts and videos look different. Open an item to see it, or drag
 * it to another day. Moving content only changes its planned day: nothing is ever posted from here.
 */
export default function ContentCalendar({ data, onOpen, onReload }: { data: WorkspaceData; onOpen: (id: string) => void; onReload: () => Promise<void> }) {
  const [view, setView] = useState<'month' | 'week'>('month');
  const [cursor, setCursor] = useState(data.today);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState<string | null>(null);

  // what is on the calendar: scheduled content, and anything the owner has marked as posted on its day
  const byDay = useMemo(() => { const map = new Map<string, ContentItem[]>(); for (const item of data.items) if (item.scheduledFor && (item.status === 'scheduled' || item.status === 'published')) map.set(item.scheduledFor, [...(map.get(item.scheduledFor) ?? []), item].sort(byTime)); return map; }, [data.items]);
  const anything = byDay.size > 0;

  const monthKey = cursor.slice(0, 7);
  const first = `${monthKey}-01`;
  const monthDays = useMemo(() => Array.from({ length: 42 }, (_, index) => addDays(first, index - dow(first))), [first]);
  const weekStart = addDays(cursor, -dow(cursor));
  const weekDays = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const title = view === 'month'
    ? new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(new Date(`${first}T12:00:00Z`))
    : `${longDay(weekDays[0])} – ${longDay(weekDays[6])}, ${weekDays[6].slice(0, 4)}`;
  const step = (direction: -1 | 1) => { if (view === 'week') { setCursor(addDays(cursor, 7 * direction)); return; } const base = new Date(`${first}T12:00:00Z`); base.setUTCMonth(base.getUTCMonth() + direction); setCursor(base.toISOString().slice(0, 10)); };

  async function moveTo(id: string, date: string) {
    setError('');
    const result = await api(`/api/marketing/content/${id}`, 'PATCH', { action: { type: 'move', date } });
    if (!result.ok) setError(result.data.error || 'Could not move that.'); else await onReload();
  }

  const chip = (item: ContentItem, roomy: boolean) => {
    const video = item.kind === 'video'; const posted = item.status === 'published';
    return <button key={item.id} type="button" draggable={!posted} onDragStart={(event) => { setDragging(item.id); event.dataTransfer.setData('text/plain', item.id); }} onClick={() => onOpen(item.id)}
      aria-label={`${video ? 'Video' : 'Post'}, ${platformSpecs[item.platform].label}${item.scheduledTime ? `, ${prettyTime(item.scheduledTime)}` : ''}${posted ? ', posted' : ''}: ${titleOf(item)}`}
      className={`flex w-full items-start gap-1.5 rounded-lg px-2 py-1.5 text-left font-bold ${roomy ? 'text-sm' : 'text-[0.6875rem]'} ${video ? 'bg-[#0B1F44] text-white' : 'bg-[#DCE7FF] text-[#12306b]'} ${posted ? 'opacity-55' : ''}`}>
      {video ? <Video size={roomy ? 15 : 12} className="mt-0.5 shrink-0" aria-hidden="true" /> : <FileText size={roomy ? 15 : 12} className="mt-0.5 shrink-0" aria-hidden="true" />}
      <span className="min-w-0 flex-1">{item.scheduledTime && <span className="block font-semibold opacity-80">{prettyTime(item.scheduledTime)}</span>}<span className={roomy ? 'block' : 'block truncate'}>{titleOf(item)}</span>{roomy && <span className="block text-xs font-semibold opacity-80">{platformSpecs[item.platform].label}</span>}</span>
      {posted && <CheckCircle2 size={13} className="mt-0.5 shrink-0" aria-label="Posted" />}
    </button>;
  };
  const cell = (day: string, roomy: boolean) => <div key={day} data-day={day} onDragOver={(event) => { if (dragging) event.preventDefault(); }} onDrop={(event) => { event.preventDefault(); const id = dragging ?? event.dataTransfer.getData('text/plain'); setDragging(null); if (id) void moveTo(id, day); }}
    className={`${roomy ? 'min-h-40' : 'min-h-28'} min-w-0 overflow-hidden border-b border-r border-border p-1.5 ${view === 'month' && day.slice(0, 7) !== monthKey ? 'bg-muted' : 'bg-card'}`}>
    <p className={`mb-1 inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-xs font-bold ${day === data.today ? 'bg-primary text-primary-foreground' : 'text-secondary'}`}>{roomy ? longDay(day) : Number(day.slice(8))}</p>
    <div className="grid gap-1">{(byDay.get(day) ?? []).map((item) => chip(item, roomy))}</div>
  </div>;

  return <section aria-label="Calendar" className="cp-card grid gap-4 p-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2"><button type="button" aria-label={view === 'month' ? 'Previous month' : 'Previous week'} onClick={() => step(-1)} className="rounded-lg border border-border p-2 text-secondary hover:border-primary"><ChevronLeft size={16} aria-hidden="true" /></button>
        <h2 className="min-w-44 text-center text-lg font-extrabold tracking-[-0.02em] text-secondary">{title}</h2>
        <button type="button" aria-label={view === 'month' ? 'Next month' : 'Next week'} onClick={() => step(1)} className="rounded-lg border border-border p-2 text-secondary hover:border-primary"><ChevronRight size={16} aria-hidden="true" /></button>
        <button type="button" onClick={() => setCursor(data.today)} className={secondaryButton}>Today</button></div>
      <div role="group" aria-label="Calendar view" className="flex rounded-xl bg-muted p-1">{(['month', 'week'] as const).map((value) => <button key={value} type="button" aria-pressed={view === value} onClick={() => setView(value)} className={`rounded-lg px-4 py-1.5 text-sm font-bold ${view === value ? 'bg-card text-secondary shadow-sm' : 'text-muted-foreground'}`}>{value === 'month' ? 'Month' : 'Week'}</button>)}</div>
    </div>
    {error && <Notice tone="warn">{error}</Notice>}
    <p className="flex flex-wrap items-center gap-4 text-xs font-bold text-muted-foreground"><span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-[#DCE7FF]" aria-hidden="true" />Post</span><span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-[#0B1F44]" aria-hidden="true" />Video</span></p>

    {view === 'month' ? <div className="overflow-x-auto"><div className="min-w-[720px]">
      <div className="grid grid-cols-7 border-l border-t border-border">{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((label) => <div key={label} className="border-b border-r border-border bg-muted px-2 py-1.5 text-xs font-bold text-muted-foreground">{label}</div>)}</div>
      <div className="grid grid-cols-7 border-l border-border">{monthDays.map((day) => cell(day, false))}</div>
    </div></div> : <div className="grid grid-cols-1 border-l border-t border-border sm:grid-cols-7">{weekDays.map((day) => cell(day, true))}</div>}

    {!anything && <p className="rounded-xl bg-muted px-4 py-3 text-center text-sm text-muted-foreground">Nothing is scheduled yet. When you choose “Add to Calendar” on something Pilot made, it shows up here.</p>}
  </section>;
}
