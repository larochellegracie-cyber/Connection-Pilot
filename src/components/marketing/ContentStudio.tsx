import { useEffect, useRef, useState } from 'react';
import { Loader2, Paperclip, Sparkles, X } from 'lucide-react';
import type { Idea } from '@/server/marketing/generate';
import PilotThread, { type Exchange, type Reply } from './PilotThread';
import { api, Notice, type WorkspaceData } from './shared';

type Props = {
  data: WorkspaceData; thread: Exchange[]; setThread: (update: (current: Exchange[]) => Exchange[]) => void; pendingIdea: Idea | null; onPendingHandled: () => void;
  onOpen: (id: string) => void; onReload: () => Promise<void>; onGoToLibrary: () => void; onGoToCalendar: () => void; onGoToBusiness: () => void;
};

/**
 * The Create screen: talk to Pilot like an employee. One box, plain words. Pilot uses what it already knows about the
 * business and works out whether that means a post, a video, ideas or "make idea #3". Nothing is scheduled or posted.
 */
export default function ContentStudio({ data, thread, setThread, pendingIdea, onPendingHandled, onOpen, onReload, onGoToLibrary, onGoToCalendar, onGoToBusiness }: Props) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  // a reference video the owner attached: Pilot has read its style, and the next request copies it
  const [reference, setReference] = useState<{ id: string; fileName: string; summary: string; kind: 'video' | 'image' } | null>(null);
  const [reading, setReading] = useState(false);
  const [attachError, setAttachError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const next = useRef(Date.now());
  const canWrite = data.setup.ai && data.hasRealData;
  const examples = [`Make me a post for ${data.business.name} this weekend`, 'Make me a 20-second Instagram video about pool closing', 'Give me ideas for this week'];

  async function attach(file: File | undefined) {
    if (!file || reading) return;
    setAttachError(''); setReading(true);
    try {
      const form = new FormData(); form.append('video', file);
      const response = await fetch('/api/marketing/reference', { method: 'POST', credentials: 'include', body: form });
      const data = await response.json().catch(() => ({})) as { reference?: { id: string; fileName: string; summary: string; kind?: 'video' | 'image' }; error?: string };
      if (!response.ok || !data.reference) setAttachError(data.error || 'Pilot couldn’t read that video. Please try another.'); else setReference({ ...data.reference, kind: data.reference.kind === 'image' ? 'image' : 'video' });
    } catch { setAttachError('Could not reach Pilot. Check your connection and try again.'); }
    setReading(false);
    if (fileInput.current) fileInput.current.value = '';
  }

  const update = (id: number, reply: Exchange['reply']) => setThread((current) => current.map((row) => (row.id === id ? { ...row, reply } : row)));

  async function send(text: string, options: { ideaId?: string; shown?: string } = {}) {
    const said = text.trim() || (reference ? `Make me ${reference.kind === 'image' ? 'a post' : 'a video'} like this one for ${data.business.name}.` : '');
    if (!said || busy) return;
    const id = next.current++;
    setThread((current) => [{ id, said: options.shown ?? said, reply: 'working' }, ...current]); setMessage(''); setBusy(true);
    const result = await api<{ reply?: Reply | { kind: 'plan_week'; message: string } }>('/api/marketing/pilot', 'POST', { message: said, ...(options.ideaId ? { ideaId: options.ideaId } : {}), ...(reference && !options.ideaId ? { referenceId: reference.id } : {}) });
    if (reference && !options.ideaId) setReference(null);
    if (!result.ok || !result.data.reply) {
      update(id, { kind: 'message', message: result.data.error || 'Pilot couldn’t do that just now. Please try again.', needsBusinessInformation: (result.data as { needsBusinessInformation?: boolean }).needsBusinessInformation });
    } else if (result.data.reply.kind === 'plan_week') {
      const plan = await api('/api/marketing/plan', 'POST', { days: 7 });
      if (!plan.ok) update(id, { kind: 'message', message: plan.data.error || 'Pilot couldn’t plan your week just now. Please try again.' });
      else { await onReload(); setBusy(false); onGoToLibrary(); return; }
    } else {
      update(id, result.data.reply as Reply);
      await onReload();
    }
    setBusy(false);
  }

  // "Make it" on a Pilot's Ideas card arrives here and goes straight into the same flow
  const handled = useRef<string | null>(null);
  useEffect(() => {
    if (pendingIdea && handled.current !== pendingIdea.id) { handled.current = pendingIdea.id; onPendingHandled(); void send(`Make idea: ${pendingIdea.title}`, { ideaId: pendingIdea.id, shown: `Make it: ${pendingIdea.title}` }); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingIdea]);

  // the conversation reads top to bottom like any chat, newest at the bottom, and follows the latest message
  const messages = [...thread].reverse();
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => { bottom.current?.scrollIntoView?.({ block: 'end' }); }, [thread]);

  return <section aria-label="Ask Pilot" className="flex h-[calc(100dvh-14rem)] min-h-[28rem] flex-col">
    <h2 className="sr-only">What do you want Pilot to create?</h2>
    {(!data.setup.ai || !data.hasRealData) && <div className="mb-3 shrink-0">
      {!data.setup.ai && <Notice tone="warn">Pilot isn’t ready to create things yet. Please contact support.</Notice>}
      {data.setup.ai && !data.hasRealData && <Notice>Pilot needs to know a little about <strong>{data.business.name}</strong> first. <button type="button" onClick={onGoToBusiness} className="font-bold text-primary underline">Open Business information</button></Notice>}
    </div>}

    {/* the conversation fills the page and scrolls; the box to type in stays at the bottom */}
    <div className="min-h-0 flex-1 overflow-y-auto pr-1">
      <ol aria-label="Conversation with Pilot" className="grid gap-6 pb-4">
        <li className="grid gap-3">
          <div className="flex items-start gap-3"><span aria-hidden="true" className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"><Sparkles size={16} /></span>
            <div className="max-w-[min(100%,40rem)] rounded-2xl rounded-tl-md border border-border bg-card px-4 py-3 shadow-sm">
              <p className="text-[0.95rem] leading-6 text-secondary">Hi, I’m Pilot. What would you like me to make for {data.business.name}? A post, a video or ideas. Just tell me and I’ll make it, and keep you posted right here.</p>
              {thread.length === 0 && <ul aria-label="Examples" className="mt-3 flex flex-wrap gap-2">{examples.map((example) => <li key={example}><button type="button" onClick={() => setMessage(example)} className="rounded-full border border-border bg-accent/40 px-3.5 py-1.5 text-sm font-semibold text-primary transition hover:border-primary">{example}</button></li>)}</ul>}
            </div></div>
        </li>
        {messages.map((exchange) => <PilotThread key={exchange.id} exchange={exchange} today={data.today} onPick={(number) => void send(`Make idea #${number}`)} onOpen={onOpen} onChanged={onReload} onGoToCalendar={onGoToCalendar} onGoToLibrary={onGoToLibrary} onGoToBusiness={onGoToBusiness} />)}
      </ol>
      <div ref={bottom} />
    </div>

    <div className="shrink-0 border-t border-border bg-[hsl(var(--canvas))] pt-3">
      {reading && <p role="status" className="mb-2 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 size={14} className="animate-spin" aria-hidden="true" />Studying your reference… this takes a few seconds for a picture, about a minute for a video.</p>}
      {attachError && <div className="mb-2"><Notice tone="warn">{attachError}</Notice></div>}
      {reference && <div className="mb-2 flex items-start gap-2 rounded-xl border border-border bg-card px-3 py-2 text-sm">
        <Paperclip size={15} className="mt-0.5 shrink-0 text-primary" aria-hidden="true" />
        <p className="min-w-0 flex-1 text-secondary"><strong>{reference.fileName}</strong> — {reference.kind === 'image' ? 'Got it — I can use this as a visual reference. What would you like me to create?' : 'I’ve studied it. Tell me what to make, or just press Create.'} <span className="text-muted-foreground">{reference.summary}</span></p>
        <button type="button" onClick={() => setReference(null)} aria-label="Remove the reference" className="shrink-0 rounded p-1 text-muted-foreground hover:text-secondary"><X size={15} aria-hidden="true" /></button>
      </div>}
      <label htmlFor="create-request" className="sr-only">What do you want Pilot to create?</label>
      <div className="flex items-end gap-2 rounded-2xl border border-border bg-background p-2 shadow-sm focus-within:border-primary focus-within:ring-4 focus-within:ring-primary/20">
        <textarea id="create-request" value={message} onChange={(event) => setMessage(event.target.value)} disabled={busy} rows={2} maxLength={600}
          onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); if (canWrite) void send(message); } }}
          placeholder="Example: Pilot, make me a post for Somerset this weekend."
          className="min-h-[3rem] w-full flex-1 resize-none border-0 bg-transparent px-3 py-2 text-base text-secondary outline-none placeholder:text-muted-foreground" />
        <input ref={fileInput} type="file" accept="video/mp4,video/quicktime,video/webm,image/png,image/jpeg,image/webp,.mp4,.mov,.webm,.png,.jpg,.jpeg,.webp" className="sr-only" aria-label="Attach a reference picture or video" onChange={(event) => void attach(event.target.files?.[0])} />
        <button type="button" disabled={busy || reading || !canWrite} onClick={() => fileInput.current?.click()} aria-label="Attach a reference picture or video" title="Attach a picture or video to copy the style of" className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border text-secondary hover:bg-accent disabled:opacity-50">
          {reading ? <Loader2 size={18} className="animate-spin" aria-hidden="true" /> : <Paperclip size={18} aria-hidden="true" />}
        </button>
        <button type="button" disabled={busy || (!message.trim() && !reference) || !canWrite} onClick={() => void send(message)} className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-base font-extrabold text-primary-foreground shadow-sm transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50">
          {busy ? <Loader2 size={18} className="animate-spin" aria-hidden="true" /> : <Sparkles size={18} aria-hidden="true" />}Create
        </button>
      </div>
    </div>
  </section>;
}
