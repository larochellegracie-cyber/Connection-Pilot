import { useCallback, useEffect, useRef, useState } from 'react';
import { ImagePlus, Loader2, Trash2 } from 'lucide-react';
import { tones } from '@/lib/marketing-content';
import { api, fieldClass, Notice, primaryButton, Section, type WorkspaceData } from './shared';

type Photo = { id: string; label: string; kind: string; url: string; tags?: string[] };
const fromWebsite = (photo: Photo) => photo.tags?.includes('website') === true;
const madeByPilot = (photo: Photo) => photo.tags?.includes('generated') === true && photo.tags?.includes('ai-image') !== true;
const aiImage = (photo: Photo) => photo.tags?.includes('ai-image') === true;

const readAsBase64 = (file: File) => new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('read failed')); reader.readAsDataURL(file); });

/** Photos Pilot may use in posts and videos. Each one says what it shows, so Pilot picks the right one for each request. */
function Photos() {
  const [photos, setPhotos] = useState<Photo[] | null>(null);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const load = useCallback(async () => { const result = await api<{ assets: Photo[] }>('/api/marketing/assets'); if (result.ok) setPhotos(result.data.assets); else setError(result.data.error || 'Could not load your photos.'); }, []);
  useEffect(() => { void load(); }, [load]);
  // reading a website saves its logo and photos here; the Business profile form says so, and this list reloads to show them
  useEffect(() => { const reload = () => void load(); window.addEventListener('pilot:photos-changed', reload); return () => window.removeEventListener('pilot:photos-changed', reload); }, [load]);

  async function upload() {
    const chosen = file.current?.files?.[0];
    if (!chosen) { setError('Choose a photo first.'); return; }
    if (!label.trim()) { setError('Say what the photo shows, for example “Chocolate birthday cake”.'); return; }
    setBusy(true); setError('');
    try {
      const result = await api('/api/marketing/assets', 'POST', { fileName: chosen.name, base64: await readAsBase64(chosen), kind: 'product', label: label.trim() });
      if (!result.ok) { setError(result.data.error || 'The photo could not be saved.'); return; }
      setLabel(''); if (file.current) file.current.value = ''; await load();
    } catch { setError('The photo could not be read.'); } finally { setBusy(false); }
  }
  async function remove(id: string) {
    if (!window.confirm('Delete this photo?')) return;
    const result = await api(`/api/marketing/assets/${id}`, 'DELETE');
    if (!result.ok) setError(result.data.error || 'Could not delete that photo.'); else await load();
  }

  return <Section id="photos-title" title="Photos Pilot can use" description="Pilot uses your uploaded photos in posts and videos. If there isn’t a suitable photo, Pilot creates a branded graphic instead.">
    {error && <div className="mb-3"><Notice tone="warn">{error}</Notice></div>}
    <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
      <label className="text-sm font-bold text-secondary">Photo<input ref={file} type="file" accept="image/jpeg,image/png,image/webp" className={fieldClass} /></label>
      <label className="text-sm font-bold text-secondary">What does it show?<input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="For example: Chocolate birthday cake" maxLength={120} className={fieldClass} /></label>
      <button type="button" disabled={busy} onClick={() => void upload()} className={primaryButton}>{busy ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <ImagePlus size={15} aria-hidden="true" />}Add photo</button>
    </div>
    {photos && photos.length === 0 && <p className="mt-4 rounded-xl bg-muted px-4 py-6 text-center text-sm text-muted-foreground">No photos yet. Posts and videos will use a branded graphic until you add some.</p>}
    {photos && photos.some(aiImage) && <p className="mt-4 rounded-xl bg-accent/50 px-4 py-2.5 text-sm text-secondary"><strong>{photos.filter(aiImage).length} AI-generated.</strong> When none of your photos fitted a post or video, Pilot generated a realistic image for it. It is not a photo of your business or its work, has no text or people in it, and is always labelled. Delete any you don’t want.</p>}
    {photos && photos.some(madeByPilot) && <p className="mt-4 rounded-xl bg-accent/50 px-4 py-2.5 text-sm text-secondary"><strong>{photos.filter(madeByPilot).length} made by Pilot.</strong> When none of your photos fitted a post or video, Pilot drew brand-coloured artwork for it. It has no text, people or real places in it. Delete any you don’t want.</p>}
    {photos && photos.some(fromWebsite) && <p className="mt-4 rounded-xl bg-accent/50 px-4 py-2.5 text-sm text-secondary"><strong>{photos.filter(fromWebsite).length} from your website.</strong> Pilot found these when it read your site. Delete any you don’t want Pilot to use.</p>}
    {photos && photos.length > 0 && <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">{photos.map((photo) => <li key={photo.id} className="relative overflow-hidden rounded-xl border border-border">
      {aiImage(photo) && <span className="absolute left-1.5 top-1.5 rounded-full bg-primary px-2 py-0.5 text-[0.65rem] font-extrabold text-primary-foreground">AI-generated</span>}
      {madeByPilot(photo) && <span className="absolute left-1.5 top-1.5 rounded-full bg-primary px-2 py-0.5 text-[0.65rem] font-extrabold text-primary-foreground">Made by Pilot</span>}
      {fromWebsite(photo) && <span className="absolute left-1.5 top-1.5 rounded-full bg-secondary/90 px-2 py-0.5 text-[0.65rem] font-extrabold text-secondary-foreground">{photo.kind === 'logo' ? 'Website logo' : 'From website'}</span>}
      <img src={photo.url} alt={photo.label} loading="lazy" className={`aspect-square w-full ${photo.kind === 'logo' ? 'bg-white object-contain p-3' : 'object-cover'}`} />
      <div className="flex items-center justify-between gap-1 p-2"><span className="truncate text-xs font-bold text-secondary">{photo.label}</span><button type="button" aria-label={`Delete ${photo.label}`} onClick={() => void remove(photo.id)} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive"><Trash2 size={14} aria-hidden="true" /></button></div></li>)}</ul>}
  </Section>;
}

/** How Pilot sounds. It writes in this voice and remembers it. */
function Voice({ data }: { data: WorkspaceData }) {
  const [voice, setVoice] = useState(data.brandVoice.tone);
  const [note, setNote] = useState(data.brandVoice.description);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  async function save(tone: string) {
    setVoice(tone); setSaved(false);
    const result = await api('/api/marketing/brand-voice', 'PUT', { tone, description: note });
    if (result.ok) setSaved(true); else setError(result.data.error || 'Could not save the brand voice.');
  }
  return <Section id="voice-title" title="How Pilot sounds" description="Pilot writes in this voice and remembers it.">
    {error && <div className="mb-3"><Notice tone="warn">{error}</Notice></div>}
    <div role="radiogroup" aria-label="Brand voice" className="flex flex-wrap gap-2">{tones.map((tone) => <button key={tone} type="button" role="radio" aria-checked={voice === tone} onClick={() => void save(tone)} className={`rounded-full border px-4 py-2 text-sm font-bold ${voice === tone ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-secondary hover:border-primary'}`}>{tone}</button>)}</div>
    <label className="mt-3 block text-sm font-bold text-secondary">Or describe your own<input value={tones.includes(voice as (typeof tones)[number]) ? '' : voice} onChange={(event) => { setVoice(event.target.value); setSaved(false); }} onBlur={(event) => { if (event.target.value.trim()) void save(event.target.value.trim()); }} placeholder="For example: warm, a bit cheeky, always practical" className={fieldClass} /></label>
    <label className="mt-3 block text-sm font-bold text-secondary">Anything else about how you sound (optional)<textarea value={note} onChange={(event) => setNote(event.target.value)} onBlur={() => { if (voice.trim()) void save(voice); }} rows={2} className={fieldClass} /></label>
    {saved && <p role="status" className="mt-2 text-xs font-bold text-primary">Saved. Pilot will use this voice.</p>}
  </Section>;
}

export default function BusinessExtras({ data }: { data: WorkspaceData }) { return <div className="grid gap-4"><Photos /><Voice data={data} /></div>; }
