import { type ReactNode, useEffect, useRef, useState } from 'react';
import { CalendarPlus, CheckCircle2, Copy, Download, ImagePlus, Loader2, Pencil, Sparkles, Video } from 'lucide-react';
import { platformSpecs, platforms, type ContentItem, type PlatformId } from '@/lib/marketing-content';
import { suggestedDay } from '@/lib/marketing-request';
import type { Idea } from '@/server/marketing/generate';
import { api, fieldClass, Notice, prettyDay, prettyTime, primaryButton, secondaryButton, StatusChip, waitForVideo } from './shared';

export type Reply =
  | { kind: 'ideas'; message: string; ideas: Idea[] }
  | { kind: 'created'; what: 'post' | 'video' | 'ai_video'; message: string; item: ContentItem; render?: { started: boolean }; awaitingConfirmation?: boolean }
  | { kind: 'message'; message: string; needsBusinessInformation?: boolean }
  | { kind: 'job'; message: string; jobId: string };

export type Exchange = { id: number; said: string; reply: Reply | 'working' };

type Where = { onOpen: (id: string) => void; onChanged: () => Promise<void>; onGoToCalendar: () => void; onGoToLibrary: () => void };

/**
 * What Pilot made: a clear preview, then three plain actions. It is already kept in the Library. "Save to Library" approves it
 * and keeps it there; "Add to Calendar" picks a day and time. Nothing is ever scheduled or posted unless the owner chooses it.
 */
function Result({ reply, said, today, where }: { reply: Extract<Reply, { kind: 'created' }>; said: string; today: string; where: Where }) {
  const [item, setItem] = useState(reply.item);
  const [making, setMaking] = useState(reply.render?.started === true);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState('');
  const [date, setDate] = useState(suggestedDay(said, today));
  const [time, setTime] = useState('09:00');
  const [platform, setPlatform] = useState<PlatformId>(reply.item.platform);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const watch = () => { setMaking(true); void waitForVideo(item.id, () => alive.current, setItem).then(async (outcome) => { if (!alive.current) return; setMaking(false); if (outcome === 'failed') setError('The video couldn’t be made. Nothing was saved, so you can try again.'); else if (outcome === 'stopped') setError('This is taking longer than expected and it isn’t ready yet. Open it from your Library in a few minutes to check.'); await where.onChanged(); }); };
  useEffect(() => { if (reply.render?.started) watch(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const patch = async (body: Record<string, unknown>) => { const result = await api<{ item: ContentItem }>(`/api/marketing/content/${item.id}`, 'PATCH', body); if (!result.ok) throw new Error(result.data.error || 'That didn’t work. Please try again.'); if (alive.current) setItem(result.data.item); return result.data.item; };
  async function run(label: string, steps: () => Promise<void>) { setBusy(label); setError(''); try { await steps(); await where.onChanged(); } catch (problem) { setError(problem instanceof Error ? problem.message : 'That didn’t work. Please try again.'); } finally { if (alive.current) setBusy(''); } }

  const makePicture = () => run('picture', async () => { const result = await api<{ item: ContentItem }>(`/api/marketing/content/${item.id}/image`, 'POST'); if (!result.ok) throw new Error(result.data.error || 'Pilot couldn’t make the picture just now. Please try again.'); if (alive.current) setItem(result.data.item); });
  const saveToLibrary = () => run('save', async () => { if (item.status === 'draft' || item.status === 'proposed') await patch({ action: { type: 'approve' } }); });
  const addToCalendar = () => run('calendar', async () => {
    if (!date) throw new Error('Choose a day.');
    let current = item;
    if (platform !== current.platform) current = await patch({ platform });
    if (current.status === 'draft' || current.status === 'proposed') current = await patch({ action: { type: 'approve' } });
    await patch({ action: { type: 'schedule', date, time: time || null } });
    if (alive.current) setAdding(false);
  });
  async function confirmAi() {
    setError('');
    const result = await api(`/api/marketing/content/${item.id}/video`, 'POST', { mode: 'ai' });
    if (!result.ok) { setError(result.data.providerRequired ? 'Pilot can’t make that kind of video yet.' : 'The video couldn’t be started, so nothing was made. Please try again in a little while.'); return; }
    if (result.data.item) setItem(result.data.item);
    watch();
  }

  const render = item.video?.render;
  const waiting = reply.awaitingConfirmation && render?.status === 'not_generated' && !making;
  const scheduled = item.status === 'scheduled' && item.scheduledFor;
  const saved = item.status === 'approved' || item.status === 'published';
  return <article className="cp-card grid gap-3 p-5">
    <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-bold text-muted-foreground">{platformSpecs[item.platform].label} {item.kind === 'video' ? 'video' : 'post'}</p><StatusChip status={item.status} /></div>
    <h3 className="text-xl font-extrabold tracking-[-0.02em] text-secondary">{item.hook}</h3>
    {item.kind === 'post' && item.image && (item.image.motion ? <video src={item.image.motion} poster={item.image.url} autoPlay loop muted playsInline aria-label="The animated picture for this post" className="max-h-[28rem] w-fit max-w-full rounded-xl bg-muted object-cover" /> : <img src={item.image.url} alt="The picture for this post" className="max-h-[28rem] w-fit max-w-full rounded-xl bg-muted object-cover" />)}
    {item.kind === 'post' && <p className="whitespace-pre-wrap text-sm leading-6 text-secondary">{item.caption}</p>}
    {item.kind === 'post' && item.hashtags.length > 0 && <p className="text-sm text-primary">{item.hashtags.join(' ')}</p>}
    {item.kind === 'video' && render?.status === 'ready' && <video src={render.url} controls playsInline preload="metadata" className="max-h-96 w-fit max-w-full rounded-xl bg-black" />}
    {item.kind === 'video' && making && <p role="status" className="flex items-center gap-2 text-sm font-bold text-primary"><Loader2 size={16} className="animate-spin" aria-hidden="true" />Making your video…</p>}
    {item.kind === 'video' && render?.status !== 'ready' && !making && !waiting && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Video size={16} aria-hidden="true" />The video isn’t made yet.</p>}
    {error && <Notice tone="warn">{error}</Notice>}

    {scheduled ? <div className="flex flex-wrap items-center gap-3"><p role="status" className="flex items-center gap-2 text-sm font-bold text-secondary"><CheckCircle2 size={16} className="text-primary" aria-hidden="true" />Added to your calendar for {prettyDay(item.scheduledFor!)}{item.scheduledTime ? ` at ${prettyTime(item.scheduledTime)}` : ''}.</p><button type="button" onClick={where.onGoToCalendar} className={secondaryButton}>See Calendar</button><button type="button" onClick={() => where.onOpen(item.id)} className={secondaryButton}>Edit</button></div> : <>
      <div className="flex flex-wrap gap-2">
        {waiting && <button type="button" onClick={() => void confirmAi()} className={primaryButton}><CheckCircle2 size={15} aria-hidden="true" />Yes, make it</button>}
        <button type="button" onClick={() => where.onOpen(item.id)} className={secondaryButton}><Pencil size={15} aria-hidden="true" />Edit</button>
        {item.kind === 'post' && !item.image && <button type="button" disabled={!!busy} onClick={() => void makePicture()} className={secondaryButton}>{busy === 'picture' ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <ImagePlus size={15} aria-hidden="true" />}Make a picture</button>}
        {saved ? <p role="status" className="inline-flex items-center gap-2 px-2 text-sm font-bold text-secondary"><CheckCircle2 size={16} className="text-primary" aria-hidden="true" />Saved to your Library <button type="button" onClick={where.onGoToLibrary} className="font-bold text-primary underline">Open Library</button></p> : <button type="button" disabled={!!busy} onClick={() => void saveToLibrary()} className={secondaryButton}>{busy === 'save' ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : null}Save to Library</button>}
        <button type="button" aria-expanded={adding} onClick={() => setAdding((value) => !value)} className={primaryButton}><CalendarPlus size={15} aria-hidden="true" />Add to Calendar</button>
      </div>
      {adding && <div role="group" aria-label="Add to Calendar" className="grid gap-3 rounded-xl border border-border bg-muted p-4 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
        <label className="text-sm font-bold text-secondary">Date<input type="date" value={date} onChange={(event) => setDate(event.target.value)} className={fieldClass} /></label>
        <label className="text-sm font-bold text-secondary">Time<input type="time" value={time} onChange={(event) => setTime(event.target.value)} className={fieldClass} /></label>
        <label className="text-sm font-bold text-secondary">Platform<select value={platform} onChange={(event) => setPlatform(event.target.value as PlatformId)} className={fieldClass}>{platforms.map((id) => <option key={id} value={id}>{platformSpecs[id].label}</option>)}</select></label>
        <button type="button" disabled={!!busy || !date} onClick={() => void addToCalendar()} className={primaryButton}>{busy === 'calendar' ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : null}Add</button>
      </div>}
    </>}
  </article>;
}

/** One turn of the conversation: what the owner said, and Pilot's answer. */
type JobStatus = { id: string; status: 'brief_ready' | 'confirmed' | 'generating' | 'ready' | 'failed'; progress: { phase: 'planning' | 'making' | 'joining' | 'music'; done: number; total: number } | null; result: { video_url: string | null; caption: string; hashtags: string[]; cta: string; total_seconds: number; music?: string | null; engine?: 'animated' | 'runway'; renderer?: 'code' | 'template' | 'explainer'; voiceover?: 'openai' | 'system' | 'none'; reference?: 'followed' | 'fallback'; reference_note?: string; code?: 'invented' | 'fell_back'; code_note?: string; generated_visual?: string; generated_kind?: 'ai-image' | 'artwork'; error: string | null } | null };

/**
 * Follows a Marketing Job while its video is being made, then shows the finished video with its caption. Copy caption and Download are
 * temporary: Pilot never posts for the owner, they copy the words and download the video and post it themselves.
 */
/** One message from Pilot in the conversation: a small avatar and a rounded bubble. `bare` leaves the bubble's own box off for content that is already a card. */
function Bubble({ children, bare = false, label }: { children: ReactNode; bare?: boolean; label?: string }) {
  return <div className="flex items-start gap-3" aria-label={label}>
    <span aria-hidden="true" className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"><Sparkles size={16} /></span>
    <div className={bare ? 'min-w-0 max-w-[min(100%,42rem)] flex-1' : 'min-w-0 max-w-[min(100%,40rem)] rounded-2xl rounded-tl-md border border-border bg-card px-4 py-3 shadow-sm'}>{children}</div>
  </div>;
}

/** Pilot's "typing" state: three dots and a short line, so a wait looks like someone working in the conversation. */
function Working({ children }: { children: ReactNode }) {
  return <Bubble><p role="status" className="flex items-center gap-2.5 text-sm font-semibold text-muted-foreground">
    <span aria-hidden="true" className="flex gap-1">{[0, 1, 2].map((dot) => <span key={dot} className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary" style={{ animationDelay: `${dot * 120}ms` }} />)}</span>{children}</p></Bubble>;
}

/**
 * Pilot's reply as a run of chat messages instead of one block. The brief summary ("Here's what I understood:" and its bullets), the note
 * about the owner's media, the cost line and the "starting" line each arrive as their own bubble. The internal mode label is not shown.
 */
export function replyParts(message: string): string[] {
  const paragraphs = message.replace(/^\s*Marketing Creative Mode(?: is on\.| : confirmed|: confirmed\.?)\s*/i, '').split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  const parts: string[] = [];
  for (const paragraph of paragraphs) { if (parts.length && /:$/.test(parts[parts.length - 1].split('\n').pop() ?? '') && /^[•\-*]/.test(paragraph)) parts[parts.length - 1] += `\n${paragraph}`; else parts.push(paragraph); }
  return parts;
}

function MessageText({ text }: { text: string }) {
  const lines = text.split('\n'); const bullets = lines.filter((line) => /^[•\-*]\s/.test(line)); const intro = lines.filter((line) => !/^[•\-*]\s/.test(line)).join('\n');
  return <div className="grid gap-2 text-[0.95rem] leading-6 text-secondary">
    {intro && <p className="whitespace-pre-line">{intro}</p>}
    {bullets.length > 0 && <ul className="grid gap-1 pl-1">{bullets.map((line, index) => <li key={index} className="flex gap-2"><span aria-hidden="true" className="mt-[0.7em] h-1.5 w-1.5 shrink-0 rounded-full bg-primary" /><span>{line.replace(/^[•\-*]\s*/, '')}</span></li>)}</ul>}
  </div>;
}

const stepLabel = (progress: JobStatus['progress'] | undefined) => (progress ? (progress.phase === 'planning' ? 'Planning your scenes…' : progress.phase === 'joining' ? 'Joining the scenes into one video…' : progress.phase === 'music' ? 'Adding music…' : progress.total === 0 ? 'Creating your free animated video…' : `Making your scenes (${progress.done} of ${progress.total} done)…`) : 'Getting started…');

/**
 * The video job, told as part of the conversation: each stage ("Planning your scenes…", "Creating your free animated video…", "Adding music…")
 * is a Pilot message that gets a tick when it is done, and the finished video, caption and actions arrive as the last message.
 */
function JobMessages({ jobId, onGoToLibrary }: { jobId: string; onGoToLibrary: () => void }) {
  const [job, setJob] = useState<JobStatus | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [steps, setSteps] = useState<string[]>([]);
  useEffect(() => {
    let alive = true; let misses = 0;
    (async () => {
      for (let attempt = 0; attempt < 400 && alive; attempt += 1) {
        const result = await api<JobStatus>(`/api/marketing/jobs/${jobId}`);
        if (!alive) return;
        if (result.ok) { misses = 0; setJob(result.data); if (result.data.status === 'ready' || result.data.status === 'failed') return; } else if (++misses >= 6) { setError('I lost track of your video. Check your Library in a moment.'); return; }
        await new Promise((resolve) => setTimeout(resolve, 4000));
      }
    })();
    return () => { alive = false; };
  }, [jobId]);
  const result = job?.result;
  const working = (!job || job.status === 'generating' || job.status === 'confirmed') && !error;
  const step = stepLabel(job?.progress);
  // the stages seen so far, in order; the last one is the one happening now
  useEffect(() => { if (working) setSteps((current) => (current[current.length - 1] === step ? current : [...current, step])); }, [working, step]);
  const shown = working ? steps : steps.filter((label) => label !== 'Getting started…');
  const copy = async () => { try { await navigator.clipboard.writeText([result?.caption, result?.cta && !result.caption.includes(result.cta) ? result.cta : '', result?.hashtags.join(' ')].filter(Boolean).join('\n\n')); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { setError('Could not copy. Select the caption and copy it instead.'); } };
  return <>
    {shown.map((label, index) => index === shown.length - 1 && working
      ? <Working key={label}>{label}</Working>
      : label === 'Getting started…' ? null : <Bubble key={label}><p className="flex items-center gap-2 text-sm font-semibold text-muted-foreground"><CheckCircle2 size={16} className="text-primary" aria-hidden="true" />{label.replace(/…$/, '')}</p></Bubble>)}
    {working && shown.length === 0 && <Working>Getting started…</Working>}
    {job?.status === 'failed' && <Bubble><Notice tone="warn">{result?.error || 'The video could not be made.'}</Notice></Bubble>}
    {error && <Bubble><Notice tone="warn">{error}</Notice></Bubble>}
    {job?.status === 'ready' && result?.video_url && <Bubble label="Your finished video">
      <div className="grid gap-3">
        <p className="text-[0.95rem] font-semibold text-secondary">Your video is ready.</p>
        <video src={result.video_url} controls playsInline preload="metadata" aria-label="Your finished video" className="max-h-[32rem] w-fit max-w-full rounded-xl bg-black" />
        {result.caption && <p className="whitespace-pre-wrap text-sm leading-6 text-secondary">{result.caption}</p>}
        {result.hashtags.length > 0 && <p className="text-sm text-primary">{result.hashtags.join(' ')}</p>}
        {result.cta && !result.caption.includes(result.cta) && <p className="text-sm font-bold text-secondary">{result.cta}</p>}
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void copy()} className={secondaryButton}><Copy size={15} aria-hidden="true" />{copied ? 'Copied' : 'Copy caption'}</button>
          <a href={`${result.video_url}?download=1`} download className={secondaryButton}><Download size={15} aria-hidden="true" />Download</a>
          <button type="button" onClick={onGoToLibrary} className={secondaryButton}>See it in your Library</button>
        </div>
        {result.engine === 'animated'
          ? <p className="text-xs text-muted-foreground">Made with Pilot’s free animation: your photos where they fit, brand colours, text and motion. No Runway credits were used.{result.music ? ` Music: ${result.music}. It was made for this video, so there’s nothing to license. You can swap the sound in Instagram or TikTok if you prefer.` : ' This video has no sound. Add music in Instagram or TikTok before you post.'}</p>
          : result.music
            ? <p className="text-xs text-muted-foreground">Made with Runway (AI-generated footage). Music: {result.music}. It was made for this video, so there’s nothing to license. You can swap the sound in Instagram or TikTok if you prefer.</p>
            : <p className="text-xs text-muted-foreground">Made with Runway (AI-generated footage). This video has no sound. Add music in Instagram or TikTok before you post.</p>}
        {result.generated_visual && <p className="text-xs text-muted-foreground">{result.generated_kind === 'ai-image' ? <>None of your photos fitted this subject, so Pilot generated a realistic image for it (“{result.generated_visual}”). It’s AI-generated, not a photo of your business or its work. It’s saved in your Photos, labelled as AI-generated.</> : <>None of your photos fitted this subject, so Pilot generated brand-coloured artwork for it (“{result.generated_visual}”). It’s saved in your Photos, and it has no text, people or real places in it.</>}</p>}
        {result.code === 'invented' && <p className="text-xs text-muted-foreground">Pilot wrote custom animation code to draw this video itself, because your ready-made scenes don’t cover the subject. It is drawn from shapes in your brand colours, so check that it looks right before you post it.</p>}
        {result.code === 'fell_back' && <p className="text-xs text-muted-foreground">I tried to draw this one from scratch but it didn’t work out{result.code_note ? ` (${result.code_note.replace(/\.$/, '')})` : ''}, so I used {result.renderer === 'code' ? 'your ready-made scenes' : 'the standard free video'} instead.</p>}
        {result.reference === 'followed' && <p className="text-xs text-muted-foreground">Made in the style of your reference video: its pace, scene order, look, text and motion. The words, colours, logo and pictures are your own; nothing from the reference was copied. Please check the words before you post it.</p>}
        {result.reference === 'fallback' && <p className="text-xs text-muted-foreground">I couldn’t follow your reference video closely this time, so I made a standard free video instead{result.reference_note ? ` (${result.reference_note.replace(/\.$/, '')})` : ''}. Ask me to try again, or attach a shorter reference.</p>}
        {result.renderer === 'explainer' && result.reference !== 'followed' && <p className="text-xs text-muted-foreground">An explainer video, drawn by Pilot from your business information and brand ({result.voiceover === 'openai' ? 'voiceover by OpenAI’s voice' : result.voiceover === 'system' ? 'voiceover by the built-in free voice' : 'no voiceover'}). The form entries, schedule and chat in it are illustrative examples, not real customers. Please check the words before you post it.</p>}
        {result.renderer === 'code' && <p className="text-xs text-muted-foreground">Drawn from a custom animation script Pilot wrote for this video (still free, no Runway credits).</p>}
        <p className="text-xs text-muted-foreground">Want a change? Just tell me, for example “make it darker”, “change the ending” or “make the music more dramatic”.</p>
      </div>
    </Bubble>}
  </>;
}

export default function PilotThread({ exchange, today, onPick, onGoToBusiness, ...where }: { exchange: Exchange; today: string; onPick: (number: number) => void; onGoToBusiness: () => void } & Where) {
  const { said, reply } = exchange;
  return <li className="grid gap-3">
    <p className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-secondary px-4 py-2.5 text-sm font-semibold text-secondary-foreground">{said}</p>
    {reply === 'working' ? <Working>Pilot is working on it…</Working> : <>
      {replyParts(reply.message).map((part, index, parts) => <Bubble key={index}>
        <MessageText text={part} />
        {index === parts.length - 1 && reply.kind === 'message' && reply.needsBusinessInformation && <button type="button" onClick={onGoToBusiness} className="mt-2 text-sm font-bold text-primary underline">Open Business information</button>}
      </Bubble>)}
      {reply.kind === 'ideas' && <Bubble bare><ol className="grid gap-2 sm:grid-cols-2">{reply.ideas.map((idea, index) => <li key={idea.id}><button type="button" onClick={() => onPick(index + 1)} className="cp-card flex h-full w-full items-start gap-3 p-4 text-left transition hover:border-primary">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-extrabold text-primary">{index + 1}</span>
        <span><span className="block text-base font-extrabold text-secondary">{idea.title}</span><span className="mt-0.5 line-clamp-2 block text-sm text-muted-foreground">{idea.why}</span></span></button></li>)}</ol></Bubble>}
      {reply.kind === 'created' && <Bubble bare><Result reply={reply} said={said} today={today} where={where} /></Bubble>}
      {reply.kind === 'job' && <JobMessages jobId={reply.jobId} onGoToLibrary={where.onGoToLibrary} />}
    </>}
  </li>;
}
