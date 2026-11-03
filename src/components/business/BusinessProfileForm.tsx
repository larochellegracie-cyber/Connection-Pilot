import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { CheckCircle2, ChevronDown, Globe2, Loader2, Save, Sparkles } from 'lucide-react';
import { cleanHours } from '@/lib/clean-hours';
import { cleanServiceList } from '@/lib/clean-services';

/**
 * The Business profile: one form for everything Pilot knows about the business, with one way to start it (read the website).
 * It reads and saves both places the details live (the business knowledge and the marketing profile) so there is only one thing to
 * fill in, review and confirm. Saving is the confirmation.
 */
type Row = Record<string, any>;
type Form = {
  businessName: string; businessType: string; website: string; phone: string; email: string;
  address: string; city: string; region: string; postalCode: string; serviceArea: string;
  description: string; services: string; hours: string;
  primary: string; secondary: string; accent: string; logoUrl: string;
  pricing: string; faqs: string; policies: string; instructions: string; disclose: boolean;
};
type Facts = { website: string; businessName: string | null; description: string | null; phone: string | null; email: string | null; address: string | null; hours: string | null; services: string[]; products: string[]; logoUrl: string | null; brandColors: string | null };
type Status = 'confirmed' | 'review';

const inputClass = 'mt-1 w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-secondary outline-none focus:border-primary focus:ring-2 focus:ring-ring';
const labelClass = 'text-sm font-bold text-secondary';

const hexesIn = (text: string | null | undefined) => [...new Set((text?.match(/#(?:[0-9a-fA-F]{6})\b/g) ?? []).map((hex) => hex.toUpperCase()))];
const list = (raw: unknown): string[] => { try { const parsed = JSON.parse(String(raw ?? '[]')); return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []; } catch { return []; } };
const json = async (response: Response) => (await response.json().catch(() => ({}))) as Row;

/** What the form starts with: the saved business details, with anything Pilot read from the website (and the owner has not confirmed yet) on top. */
export function initialForm(bp: Row, bk: Row, mp: Row | null): { form: Form; status: Status } {
  const review = mp?.approvalStatus === 'review_required' && !!mp?.analyzedAt;
  const colours = hexesIn(mp?.brandColors);
  const mpServices = list(mp?.services);
  const services = (mpServices.length ? mpServices : cleanServiceList([String(bk.servicesOffered ?? '')])).join('\n');
  const form: Form = {
    businessName: bp.businessName ?? '', businessType: bp.businessType ?? '', website: bp.website || (review ? mp?.websiteUrl ?? '' : ''), phone: mp?.contactPhone ?? '', email: bp.businessEmail || mp?.contactEmail || '',
    address: bp.address ?? '', city: bp.city ?? '', region: bp.region ?? '', postalCode: bp.postalCode ?? '', serviceArea: bk.serviceArea ?? '',
    description: mp?.businessDescription ?? '', services, hours: cleanHours((review && mp?.businessHours) || bk.businessHours),
    primary: colours[0] ?? '', secondary: colours[1] ?? '', accent: colours[2] ?? '', logoUrl: mp?.logoUrl ?? '',
    pricing: bk.pricingInformation ?? '', faqs: bk.frequentlyAskedQuestions ?? '', policies: bk.policies ?? '', instructions: bk.receptionistInstructions ?? '', disclose: Boolean(bk.discloseAutomation),
  };
  return { form, status: mp?.approvalStatus === 'confirmed' ? 'confirmed' : 'review' };
}

/** Puts what a website says into the form: blanks are filled, the brand (logo, colours) and hours are replaced, services are added to. Returns what changed. */
export function applyFacts(form: Form, facts: Facts): { form: Form; filled: string[] } {
  const next = { ...form }; const filled: string[] = [];
  const set = (key: keyof Form, label: string, value: string | null | undefined, replace = false) => { if (value && (replace || !String(form[key] ?? '').trim()) && next[key] !== value) { (next as Row)[key] = value; filled.push(label); } };
  set('website', 'website', facts.website, false);
  set('phone', 'phone', facts.phone); set('email', 'email', facts.email); set('address', 'address', facts.address);
  set('description', 'about', facts.description); set('hours', 'hours', facts.hours, true);
  set('logoUrl', 'logo', facts.logoUrl, true);
  const colours = hexesIn(facts.brandColors);
  if (colours.length) { next.primary = colours[0] ?? ''; next.secondary = colours[1] ?? ''; next.accent = colours[2] ?? ''; filled.push('brand colours'); }
  const have = form.services.split('\n').map((line) => line.trim()).filter(Boolean);
  const added = [...facts.services, ...facts.products].filter((item) => !have.some((existing) => existing.toLowerCase() === item.toLowerCase()));
  if (added.length) { next.services = [...have, ...added].join('\n'); filled.push('services'); }
  return { form: next, filled };
}

function ColourField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className={`${labelClass} flex items-center gap-3 rounded-xl border border-border bg-background px-3 py-2`}>
    <input type="color" aria-label={label} value={value || '#CCCCCC'} onChange={(event) => onChange(event.target.value.toUpperCase())} className="h-9 w-9 shrink-0 cursor-pointer rounded-lg border border-border bg-transparent p-0.5" />
    <span className="grid leading-tight"><span>{label}</span><span className="text-xs font-semibold text-muted-foreground">{value || 'Not set'}</span></span>
    {value && <button type="button" onClick={() => onChange('')} className="ml-auto text-xs font-bold text-primary underline">Clear</button>}
  </label>;
}

export default function BusinessProfileForm() {
  const [rows, setRows] = useState<{ bp: Row; bk: Row; mp: Row | null } | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [status, setStatus] = useState<Status>('review');
  const [url, setUrl] = useState('');
  const [reading, setReading] = useState(false);
  const [readUrl, setReadUrl] = useState('');
  const [found, setFound] = useState<{ lines: string[]; warnings: string[]; filled: string[]; photos: string } | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [knowledge, marketing] = await Promise.all([fetch('/api/business-knowledge', { credentials: 'include' }), fetch('/api/marketing/profile', { credentials: 'include', cache: 'no-store' })]);
      const kb = await json(knowledge);
      if (!knowledge.ok) throw new Error(kb.error || 'Unable to load your business information.');
      const mp = marketing.ok ? (await json(marketing)).marketingProfile ?? null : null;
      const start = initialForm(kb.profile, kb.knowledge, mp);
      setRows({ bp: kb.profile, bk: kb.knowledge, mp }); setForm(start.form); setStatus(start.status); setUrl(start.form.website);
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : 'Unable to load your business information.'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const edit = (key: keyof Form, value: string | boolean) => { setForm((current) => (current ? { ...current, [key]: value } : current)); setStatus('review'); };

  async function readWebsite() {
    if (!form) return;
    setReading(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/business-knowledge/website', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) });
      const payload = await json(response);
      if (!response.ok || !payload.facts) throw new Error(payload.error || 'I could not read that website. Please fill in your details below.');
      const result = applyFacts(form, payload.facts as Facts);
      setForm(result.form); setReadUrl(url); setStatus('review');
      setFound({ lines: payload.found ?? [], warnings: payload.warnings ?? [], filled: result.filled, photos: payload.photos?.message ?? '' });
      if (payload.photos?.saved?.length) window.dispatchEvent(new Event('pilot:photos-changed')); // the Photos section below reloads and shows them
    } catch (readError) { setError(readError instanceof Error ? readError.message : 'I could not read that website.'); } finally { setReading(false); }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!form || !rows) return;
    setSaving(true); setError(''); setNotice('');
    const servicesList = form.services.split('\n').map((line) => line.trim()).filter(Boolean);
    const colours = [form.primary, form.secondary, form.accent];
    try {
      const knowledge = await fetch('/api/business-knowledge', { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        businessName: form.businessName, businessType: form.businessType, businessEmail: form.email, website: form.website, address: form.address, city: form.city, region: form.region, postalCode: form.postalCode,
        serviceArea: form.serviceArea, businessHours: form.hours, servicesOffered: servicesList.join(', '), pricingInformation: form.pricing, frequentlyAskedQuestions: form.faqs, policies: form.policies,
        receptionistInstructions: form.instructions, discloseAutomation: form.disclose, ...(readUrl ? { websiteImportUrl: readUrl } : {}),
      }) });
      const saved = await json(knowledge);
      if (!knowledge.ok) throw new Error(saved.error || 'Unable to save your business information.');
      const mp = rows.mp ?? {};
      const marketing = await fetch('/api/marketing/profile', { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        ...mp, businessName: form.businessName, businessDescription: form.description, location: [form.address, form.city, form.region, form.postalCode].filter(Boolean).join(', '),
        contactPhone: form.phone, contactEmail: form.email, businessHours: form.hours, services: servicesList, products: list(mp.products), pricing: form.pricing,
        brandColors: ['Primary', 'Secondary', 'Accent'].map((name, i) => (colours[i] ? `${name} ${colours[i]}` : '')).filter(Boolean).join(', '), logoUrl: form.logoUrl,
        frequentlyAskedQuestions: form.faqs, importantNotes: form.policies, keySellingPoints: list(mp.keySellingPoints), socialLinks: (() => { try { return JSON.parse(mp.socialLinks ?? '{}'); } catch { return {}; } })(),
      }) });
      const confirmed = await json(marketing);
      if (!marketing.ok) throw new Error(confirmed.error || 'Your details were saved, but the brand and marketing details could not be confirmed. Please try again.');
      setReadUrl(''); setFound(null); setStatus('confirmed');
      setNotice(saved.importedPages?.length ? `Saved and confirmed. ${saved.importedPages.length} website pages are ready for Pilot.` : 'Saved and confirmed. Pilot will use these details in chat, posts, videos and captions.');
      await load(); setStatus('confirmed');
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : 'Unable to save your business information.'); } finally { setSaving(false); }
  }

  if (!form) return <p role={error ? 'alert' : 'status'} className="text-sm font-bold text-muted-foreground">{error || 'Loading your business information...'}</p>;

  return <div className="grid gap-base">
    <section aria-labelledby="website-start-title" className="rounded-2xl border border-border bg-card p-base shadow-sm sm:p-lg">
      <div className="flex items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent text-primary"><Globe2 size={19} aria-hidden="true" /></span>
        <div><h2 id="website-start-title" className="text-lg font-extrabold text-secondary">Start with your website</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">Pilot reads it and fills in the form below: logo, colours, hours, services, about and contact details. You check it, then confirm.</p></div></div>
      <div className="mt-base flex flex-col gap-3 sm:flex-row">
        <label className="sr-only" htmlFor="website-to-read">Website address</label>
        <input id="website-to-read" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://yourbusiness.com" className={`${inputClass} mt-0 flex-1`} />
        <button type="button" disabled={reading || !url.trim()} onClick={() => void readWebsite()} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground hover:bg-secondary disabled:opacity-60">
          {reading ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Sparkles size={16} aria-hidden="true" />}{reading ? 'Reading your website and photos…' : 'Read my website'}</button>
      </div>
      {found && <div role="status" className="mt-base rounded-xl border border-primary/40 bg-accent/50 p-4 text-sm text-secondary">
        <p className="font-extrabold">{found.filled.length ? `Pilot filled in: ${found.filled.join(', ')}.` : 'Pilot read your website. Nothing new to add.'} Check the details below, then confirm.</p>
        {found.photos && <p className="mt-1">{found.photos} <a href="#photos-title" className="font-bold text-primary underline">See them</a></p>}
        {found.warnings.length > 0 && <p className="mt-1 text-muted-foreground">{found.warnings.join(' ')}</p>}
      </div>}
    </section>

    <form onSubmit={save} className="grid gap-base" aria-label="Business profile">
      <section className="rounded-2xl border border-border bg-card p-base shadow-sm sm:p-lg">
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-xl font-extrabold text-secondary">Business profile</h2>
          <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-extrabold ${status === 'confirmed' ? 'bg-accent text-primary' : 'bg-muted text-secondary'}`}>{status === 'confirmed' ? <><CheckCircle2 size={14} aria-hidden="true" />Confirmed</> : 'Needs your review'}</span></div>

        <h3 className="mt-base text-xs font-extrabold uppercase tracking-wide text-muted-foreground">Basics</h3>
        <div className="mt-2 grid gap-4 sm:grid-cols-2">
          <label className={labelClass}>Business name<input required value={form.businessName} onChange={(e) => edit('businessName', e.target.value)} className={inputClass} /></label>
          <label className={labelClass}>Business type<input required value={form.businessType} onChange={(e) => edit('businessType', e.target.value)} className={inputClass} /></label>
          <label className={labelClass}>Website<input type="url" value={form.website} onChange={(e) => edit('website', e.target.value)} className={inputClass} /></label>
          <label className={labelClass}>Phone<input type="tel" value={form.phone} onChange={(e) => edit('phone', e.target.value)} className={inputClass} /></label>
          <label className={`${labelClass} sm:col-span-2`}>Email<input type="email" value={form.email} onChange={(e) => edit('email', e.target.value)} className={inputClass} /></label>
        </div>

        <h3 className="mt-lg text-xs font-extrabold uppercase tracking-wide text-muted-foreground">Location</h3>
        <div className="mt-2 grid gap-4 sm:grid-cols-6">
          <label className={`${labelClass} sm:col-span-6`}>Address<input required value={form.address} onChange={(e) => edit('address', e.target.value)} className={inputClass} /></label>
          <label className={`${labelClass} sm:col-span-2`}>City<input required value={form.city} onChange={(e) => edit('city', e.target.value)} className={inputClass} /></label>
          <label className={`${labelClass} sm:col-span-2`}>Province / State<input required value={form.region} onChange={(e) => edit('region', e.target.value)} className={inputClass} /></label>
          <label className={`${labelClass} sm:col-span-2`}>Postal / ZIP code<input required value={form.postalCode} onChange={(e) => edit('postalCode', e.target.value)} className={inputClass} /></label>
          <label className={`${labelClass} sm:col-span-6`}>Service area<input required value={form.serviceArea} onChange={(e) => edit('serviceArea', e.target.value)} className={inputClass} /></label>
        </div>

        <h3 className="mt-lg text-xs font-extrabold uppercase tracking-wide text-muted-foreground">What you do</h3>
        <div className="mt-2 grid gap-4 sm:grid-cols-2">
          <label className={`${labelClass} sm:col-span-2`}>About<textarea value={form.description} onChange={(e) => edit('description', e.target.value)} rows={3} className={inputClass} /></label>
          <label className={labelClass}>Products and services<span className="block text-xs font-semibold text-muted-foreground">One per line</span><textarea required value={form.services} onChange={(e) => edit('services', e.target.value)} rows={5} className={inputClass} /></label>
          <label className={labelClass}>Hours<span className="block text-xs font-semibold text-muted-foreground">Leave blank if you don’t have set hours</span><textarea value={form.hours} onChange={(e) => edit('hours', e.target.value)} rows={5} placeholder="Mon–Fri: 9:00 AM – 5:00 PM" className={inputClass} /></label>
        </div>

        <h3 className="mt-lg text-xs font-extrabold uppercase tracking-wide text-muted-foreground">Brand</h3>
        <div className="mt-2 grid gap-4 sm:grid-cols-[auto_1fr] sm:items-start">
          <div className="flex items-center gap-3">
            <span className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-border bg-muted">{form.logoUrl ? <img src={form.logoUrl} alt="Your logo" className="max-h-full max-w-full object-contain" /> : <span className="px-1 text-center text-xs font-bold text-muted-foreground">No logo yet</span>}</span>
          </div>
          <label className={labelClass}>Logo link<input type="url" value={form.logoUrl} onChange={(e) => edit('logoUrl', e.target.value)} placeholder="https://…" className={inputClass} /></label>
          <span className={`${labelClass} sm:col-span-2`}>Brand colours</span>
          <div className="grid gap-3 sm:col-span-2 sm:grid-cols-3">
            <ColourField label="Primary" value={form.primary} onChange={(v) => edit('primary', v)} />
            <ColourField label="Secondary" value={form.secondary} onChange={(v) => edit('secondary', v)} />
            <ColourField label="Accent" value={form.accent} onChange={(v) => edit('accent', v)} />
          </div>
        </div>

        <details className="group mt-lg rounded-xl border border-border bg-background">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-extrabold text-secondary">
            <span>More for Pilot <span className="font-semibold text-muted-foreground">(optional: prices, FAQs, policies, guidance)</span></span><ChevronDown size={16} className="transition group-open:rotate-180" aria-hidden="true" /></summary>
          <div className="grid gap-4 border-t border-border p-4">
            <label className={labelClass}>Prices and estimates<textarea value={form.pricing} onChange={(e) => edit('pricing', e.target.value)} rows={2} className={inputClass} /></label>
            <label className={labelClass}>Frequently asked questions<textarea value={form.faqs} onChange={(e) => edit('faqs', e.target.value)} rows={3} className={inputClass} /></label>
            <label className={labelClass}>Policies and important notes<textarea value={form.policies} onChange={(e) => edit('policies', e.target.value)} rows={3} className={inputClass} /></label>
            <label className={labelClass}>Guidance for Pilot<textarea value={form.instructions} onChange={(e) => edit('instructions', e.target.value)} rows={3} className={inputClass} /></label>
            <label className="flex items-start gap-3 text-sm text-secondary"><input type="checkbox" checked={form.disclose} onChange={(e) => edit('disclose', e.target.checked)} className="mt-1 h-4 w-4 accent-primary" /><span><span className="block font-extrabold">Tell customers Pilot is an automated assistant</span><span className="text-muted-foreground">When on, Pilot may say it is automated in customer conversations.</span></span></label>
          </div>
        </details>
      </section>

      {error && <p role="alert" className="rounded-xl border border-destructive bg-card p-4 text-sm font-bold text-destructive">{error}</p>}
      {notice && <p role="status" className="rounded-xl border border-primary bg-accent p-4 text-sm font-bold text-secondary">{notice}</p>}
      <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card/95 px-4 py-3 shadow-lg backdrop-blur">
        <button disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground hover:bg-secondary disabled:opacity-60">{saving ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Save size={16} aria-hidden="true" />}{saving ? 'Saving…' : 'Confirm and save'}</button>
        <span className="text-xs font-semibold text-muted-foreground">{status === 'confirmed' ? 'Everything here is confirmed.' : 'Pilot only uses these details once you confirm them.'}</span>
      </div>
    </form>
  </div>;
}
