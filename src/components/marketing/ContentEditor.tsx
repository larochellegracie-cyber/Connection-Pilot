import { useEffect, useState } from 'react';
import { CalendarCheck, CheckCircle2, ImagePlus, Loader2, RefreshCw, Trash2, Video, X } from 'lucide-react';
import { platformSpecs, platforms, type ContentItem, type PlatformId } from '@/lib/marketing-content';
import { api, EvidenceList, fieldClass, Notice, primaryButton, secondaryButton, SocialPreview, StatusChip, waitForVideo } from './shared';

type Setup = { video: { configured: boolean; provider: string | null; message: string }; publishing: { message: string }; ai: boolean };

/** Review, edit and approve one piece of content. Nothing here posts anywhere. */
export default function ContentEditor({ item, businessName, setup, timezone, onChange, onRemoved, onClose }: { item: ContentItem; businessName: string; setup: Setup; timezone: string; onChange: (item: ContentItem) => void; onRemoved: (id: string) => void; onClose: () => void }) {
  const [draft, setDraft] = useState(item);
  const [date, setDate] = useState(item.scheduledFor ?? '');
  const [time, setTime] = useState(item.scheduledTime ?? '');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [change, setChange] = useState('');
  const [making, setMaking] = useState(false);
  useEffect(() => { setDraft(item); setDate(item.scheduledFor ?? ''); setTime(item.scheduledTime ?? ''); }, [item]);

  const dirty = ['hook', 'caption', 'cta', 'suggestedVisual', 'platform'].some((key) => (draft as any)[key] !== (item as any)[key]) || draft.hashtags.join(' ') !== item.hashtags.join(' ') || JSON.stringify(draft.video?.scenes) !== JSON.stringify(item.video?.scenes) || draft.video?.transitions !== item.video?.transitions || draft.video?.audioDirection !== item.video?.audioDirection;
  const set = <K extends keyof ContentItem>(key: K, value: ContentItem[K]) => setDraft((current) => ({ ...current, [key]: value }));

  async function run(label: string, request: () => Promise<{ ok: boolean; data: any }>, success?: (data: any) => void) {
    setBusy(label); setError(''); setMessage('');
    const result = await request();
    setBusy('');
    if (!result.ok) { setError(result.data.error || result.data.message || 'That did not work.'); return; }
    if (result.data.item) onChange(result.data.item);
    if (result.data.note) setMessage(result.data.note);
    success?.(result.data);
  }
  async function renderNow() {
    setError(''); setMessage('');
    const mode = item.video?.mode ?? 'standard';
    const started = await api(`/api/marketing/content/${item.id}/video`, 'POST', { mode });
    if (!started.ok) { setError(started.data.providerRequired ? 'Pilot can’t make that kind of video yet.' : 'The video couldn’t be started, so nothing was made. Please try again in a little while.'); return; }
    if (started.data.item) onChange(started.data.item);
    setMaking(true);
    const outcome = await waitForVideo(item.id, () => true, onChange);
    setMaking(false);
    if (outcome === 'failed') setError('The video couldn’t be made. Nothing was saved, so you can try again.');
  }
  async function askForChange() {
    const instruction = change.trim(); if (!instruction) return;
    setBusy('change'); setError(''); setMessage('');
    const result = await api<{ item: ContentItem }>(`/api/marketing/content/${item.id}/regenerate`, 'POST', { instruction });
    setBusy('');
    if (!result.ok) { setError(result.data.error || 'Pilot couldn’t make that change. Please try again.'); return; }
    setChange(''); onChange(result.data.item);
    if (result.data.item.kind === 'video' && result.data.item.video?.mode !== 'ai' && result.data.item.video?.plan) await renderNow(); // a Standard Video is quick to make again
  }
  // a video that is still being made keeps being checked while it is open, so it appears the moment it is really finished
  useEffect(() => { if (item.kind !== 'video' || item.video?.render.status !== 'processing') return; let alive = true; void waitForVideo(item.id, () => alive, onChange); return () => { alive = false; }; /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [item.id, item.video?.render.status]);
  const edits = () => ({ hook: draft.hook, caption: draft.caption, cta: draft.cta, suggestedVisual: draft.suggestedVisual, platform: draft.platform, hashtags: draft.hashtags, ...(draft.video ? { video: draft.video } : {}) });
  const act = (action: Record<string, unknown>, label: string) => run(label, () => api(`/api/marketing/content/${item.id}`, 'PATCH', { ...(dirty ? edits() : {}), action }));
  const reviewed = item.status === 'approved' || item.status === 'scheduled' || item.status === 'published';

  return <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[#0B1F44]/70 p-4 sm:p-8"><section role="dialog" aria-modal="true" aria-label="Edit content" className="w-full max-w-5xl rounded-3xl bg-card p-5 shadow-2xl sm:p-7">
    <div className="mb-4 flex items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><h2 className="text-xl font-extrabold tracking-[-0.03em] text-secondary">{item.kind === 'video' ? 'Video' : 'Post'} · {platformSpecs[item.platform].label}</h2><StatusChip status={item.status} /></div><p className="mt-0.5 text-sm text-muted-foreground">{item.topic}{item.scheduledFor ? ` · planned for ${item.scheduledFor}` : ''}</p></div><button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-2 text-muted-foreground hover:bg-muted"><X size={18} aria-hidden="true" /></button></div>
    {error && <div className="mb-3"><Notice tone="warn">{error}</Notice></div>}
    {message && <div className="mb-3"><Notice>{message}</Notice></div>}
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
      <div className="grid content-start gap-3">
        <label className="text-sm font-bold text-secondary">Platform<select value={draft.platform} onChange={(event) => set('platform', event.target.value as PlatformId)} className={fieldClass}>{platforms.map((id) => <option key={id} value={id}>{platformSpecs[id].label}</option>)}</select></label>
        <label className="text-sm font-bold text-secondary">Hook<input value={draft.hook} onChange={(event) => set('hook', event.target.value)} maxLength={300} className={fieldClass} /></label>
        <label className="text-sm font-bold text-secondary">Caption<textarea value={draft.caption} onChange={(event) => set('caption', event.target.value)} rows={7} className={fieldClass} /></label>
        <p className="-mt-2 text-xs text-muted-foreground">{draft.caption.length} / {platformSpecs[draft.platform].captionMax} characters for {platformSpecs[draft.platform].label}</p>
        <label className="text-sm font-bold text-secondary">Call to action<input value={draft.cta} onChange={(event) => set('cta', event.target.value)} maxLength={200} className={fieldClass} /></label>
        <label className="text-sm font-bold text-secondary">Hashtags<input value={draft.hashtags.join(' ')} onChange={(event) => set('hashtags', event.target.value.split(/\s+/).filter(Boolean))} className={fieldClass} aria-describedby="tag-help" /></label>
        <p id="tag-help" className="-mt-2 text-xs text-muted-foreground">Up to {platformSpecs[draft.platform].hashtagMax} for {platformSpecs[draft.platform].label}. Extra ones are dropped when you save.</p>
        <label className="text-sm font-bold text-secondary">Suggested visual<textarea value={draft.suggestedVisual} onChange={(event) => set('suggestedVisual', event.target.value)} rows={2} className={fieldClass} /></label>
        {draft.kind === 'video' && draft.video && <fieldset className="grid gap-2 rounded-xl border border-border p-3"><legend className="px-1 text-sm font-extrabold text-secondary">Video plan · {draft.video.durationSeconds} seconds</legend>
          {draft.video.scenes.map((scene, index) => <div key={index} className="grid gap-1.5 rounded-lg bg-muted p-2.5"><p className="text-xs font-extrabold text-secondary">Scene {index + 1} · {scene.seconds}s</p>
            <label className="text-xs font-bold text-secondary">Visual<input value={scene.visual} onChange={(event) => set('video', { ...draft.video!, scenes: draft.video!.scenes.map((row, at) => (at === index ? { ...row, visual: event.target.value } : row)) })} className={fieldClass} /></label>
            <label className="text-xs font-bold text-secondary">On-screen text<input value={scene.onScreenText} onChange={(event) => set('video', { ...draft.video!, scenes: draft.video!.scenes.map((row, at) => (at === index ? { ...row, onScreenText: event.target.value } : row)) })} className={fieldClass} /></label>
            {scene.voiceover !== undefined && <p className="text-xs text-muted-foreground">Voice-over: {scene.voiceover}</p>}</div>)}
          <label className="text-xs font-bold text-secondary">Transitions<input value={draft.video.transitions} onChange={(event) => set('video', { ...draft.video!, transitions: event.target.value })} className={fieldClass} /></label>
          <label className="text-xs font-bold text-secondary">Music and audio direction<input value={draft.video.audioDirection} onChange={(event) => set('video', { ...draft.video!, audioDirection: event.target.value })} className={fieldClass} /></label>
        </fieldset>}
      </div>
      <div className="grid content-start gap-4">
        <SocialPreview item={draft} businessName={businessName} />
        {item.kind === 'post' && <div className="flex flex-wrap items-center gap-2"><button type="button" disabled={!!busy || !setup.ai} onClick={() => void run('picture', () => api(`/api/marketing/content/${item.id}/image`, 'POST'))} className={secondaryButton}>{busy === 'picture' ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <ImagePlus size={14} aria-hidden="true" />}{item.image ? 'Make a new picture' : 'Make a picture'}</button>{item.image?.source === 'generated' && <span className="text-xs text-muted-foreground">Picture made by Pilot</span>}</div>}
        <div className="rounded-xl border border-border p-3"><label htmlFor="change-request" className="text-sm font-extrabold text-secondary">Ask Pilot to change it</label><div className="mt-2 flex gap-2"><input id="change-request" value={change} onChange={(event) => setChange(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void askForChange(); } }} maxLength={300} placeholder="For example: make it shorter and friendlier" className={`${fieldClass} mt-0`} /><button type="button" disabled={!!busy || !setup.ai || !change.trim()} onClick={() => void askForChange()} className={secondaryButton}>{busy === 'change' ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : null}Change it</button></div></div>
        {item.why && <div><h3 className="text-sm font-extrabold text-secondary">Why Pilot suggested this</h3><p className="mt-1 text-sm text-secondary">{item.why}</p><div className="mt-2"><EvidenceList evidence={item.evidence} /></div></div>}
        {item.kind === 'video' && <div className="rounded-xl border border-border p-3"><h3 className="flex items-center gap-1.5 text-sm font-extrabold text-secondary"><Video size={15} aria-hidden="true" />Video file</h3>
          {item.video?.render.status === 'ready' ? <p className="mt-1 text-sm text-secondary">Made with {item.video.render.provider}. <a className="font-bold text-primary underline" href={item.video.render.url} target="_blank" rel="noreferrer">Open the video</a></p> : <>
            <p className="mt-1 text-sm text-muted-foreground">{making || item.video?.render.status === 'processing' ? 'Making your video…' : 'The video isn’t made yet.'}</p>
            <button type="button" disabled={!!busy || making || item.video?.render.status === 'processing'} onClick={() => void renderNow()} className={`${secondaryButton} mt-2`}>{making ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Video size={14} aria-hidden="true" />}{item.video?.mode === 'ai' ? 'Make the AI video' : 'Make the video'}</button></>}</div>}
        <p className="rounded-xl bg-muted p-3 text-xs text-muted-foreground">{setup.publishing.message}</p>
      </div>
    </div>
    {reviewed && dirty && <div className="mt-4"><Notice>You have changed the words of {item.status} content. Saving sends it back to draft so you can approve it again.</Notice></div>}
    <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border pt-4">
      <button type="button" disabled={!!busy || !dirty} onClick={() => void run('save', () => api(`/api/marketing/content/${item.id}`, 'PATCH', edits()))} className={secondaryButton}>{busy === 'save' ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : null}Save changes</button>
      {(item.status === 'draft' || item.status === 'proposed') && <button type="button" disabled={!!busy} onClick={() => void act({ type: 'approve' }, 'approve')} className={primaryButton}><CheckCircle2 size={15} aria-hidden="true" />Approve</button>}
      {(item.status === 'approved' || item.status === 'scheduled') && <>
        <label className="flex items-center gap-1.5 text-sm font-bold text-secondary">Date<input type="date" aria-label="Schedule for" value={date} onChange={(event) => setDate(event.target.value)} className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm" /></label>
        <label className="flex items-center gap-1.5 text-sm font-bold text-secondary">Time<input type="time" aria-label="Time" value={time} onChange={(event) => setTime(event.target.value)} className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm" /></label>
        <button type="button" disabled={!!busy || !date} onClick={() => void act({ type: 'schedule', date, time: time || null }, 'schedule')} className={primaryButton}><CalendarCheck size={15} aria-hidden="true" />{item.status === 'scheduled' ? 'Move' : 'Schedule'}</button>
        <button type="button" disabled={!!busy} onClick={() => void act({ type: 'mark_published' }, 'publish')} className={secondaryButton}>I posted this — mark as published</button></>}
      {item.status !== 'draft' && <button type="button" disabled={!!busy} onClick={() => void act({ type: 'back_to_draft' }, 'draft')} className="text-sm font-bold text-muted-foreground underline">Back to draft</button>}
      <span className="flex-1" />
      <button type="button" disabled={!!busy || !setup.ai} onClick={() => void run('regenerate', () => api(`/api/marketing/content/${item.id}/regenerate`, 'POST'))} className={secondaryButton}>{busy === 'regenerate' ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <RefreshCw size={14} aria-hidden="true" />}Regenerate</button>
      <button type="button" disabled={!!busy} onClick={() => { if (window.confirm('Delete this content? This cannot be undone.')) void run('delete', () => api(`/api/marketing/content/${item.id}`, 'DELETE'), () => { onRemoved(item.id); onClose(); }); }} className="inline-flex items-center gap-1 rounded-xl px-3 py-2.5 text-sm font-bold text-destructive hover:bg-muted"><Trash2 size={14} aria-hidden="true" />Delete</button>
    </div>
    <span className="sr-only" aria-live="polite">{timezone}</span>
  </section></div>;
}
