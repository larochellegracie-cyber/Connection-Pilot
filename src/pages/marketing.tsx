import { useEffect, useRef, useState } from 'react';
import { Helmet } from '@dr.pogodin/react-helmet';
import {
  ArrowRight,
  BookOpen,
  Briefcase,
  Building2,
  Check,
  ChevronDown,
  ChevronUp,
  Globe,
  Loader2,
  Megaphone,
  Palette,
  Pencil,
  Save,
  Sparkles,
  Upload,
  Users,
  X,
} from 'lucide-react';
import { marketing } from 'virtual:content';
import { ProtectedRoute } from '@/lib/auth/auth-client';
import WorkspaceLayout from '@/layouts/WorkspaceLayout';
import PilotAvatar from '@/components/PilotAvatar';

// ─── Types ────────────────────────────────────────────────────────────────────

type MarketingProfile = {
  id: string;
  websiteUrl: string | null;
  analysisStatus: string;
  analyzedAt: string | null;
  approvalStatus: 'review_required' | 'confirmed';
  confirmedAt: string | null;
  businessName: string | null;
  businessDescription: string | null;
  location: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  businessHours: string | null;
  services: string | null;
  products: string | null;
  pricing: string | null;
  targetCustomers: string | null;
  customerNeeds: string | null;
  brandTone: string | null;
  brandDescription: string | null;
  brandColors: string | null;
  logoUrl: string | null;
  promotions: string | null;
  keySellingPoints: string | null;
  frequentlyAskedQuestions: string | null;
  importantNotes: string | null;
  socialLinks: string | null;
};

type EditableProfile = {
  businessName: string;
  businessDescription: string;
  location: string;
  contactPhone: string;
  contactEmail: string;
  businessHours: string;
  services: string[];
  products: string[];
  pricing: string;
  targetCustomers: string;
  customerNeeds: string;
  brandTone: string;
  brandDescription: string;
  brandColors: string;
  logoUrl: string;
  promotions: string;
  keySellingPoints: string[];
  frequentlyAskedQuestions: string;
  importantNotes: string;
  socialLinks: Record<string, string | null>;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseJsonArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v.filter((item): item is string => typeof item === 'string') : []; } catch { return []; }
}

function parseJsonObject(raw: string | null | undefined): Record<string, string | null> {
  if (!raw) return {};
  try { const v = JSON.parse(raw); return (v && typeof v === 'object' && !Array.isArray(v)) ? v as Record<string, string | null> : {}; } catch { return {}; }
}

function profileToEditable(p: MarketingProfile): EditableProfile {
  return {
    businessName: p.businessName ?? '',
    businessDescription: p.businessDescription ?? '',
    location: p.location ?? '',
    contactPhone: p.contactPhone ?? '',
    contactEmail: p.contactEmail ?? '',
    businessHours: p.businessHours ?? '',
    services: parseJsonArray(p.services),
    products: parseJsonArray(p.products),
    pricing: p.pricing ?? '',
    targetCustomers: p.targetCustomers ?? '',
    customerNeeds: p.customerNeeds ?? '',
    brandTone: p.brandTone ?? '',
    brandDescription: p.brandDescription ?? '',
    brandColors: p.brandColors ?? '',
    logoUrl: p.logoUrl ?? '',
    promotions: p.promotions ?? '',
    keySellingPoints: parseJsonArray(p.keySellingPoints),
    frequentlyAskedQuestions: p.frequentlyAskedQuestions ?? '',
    importantNotes: p.importantNotes ?? '',
    socialLinks: parseJsonObject(p.socialLinks),
  };
}

const LOADING_STEPS = marketing.loadingSteps.map((s) => s.text);

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionCard({ icon: Icon, heading, children, defaultOpen = true }: { icon: React.ElementType; heading: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-6 py-5 text-left transition-colors hover:bg-muted"
        aria-expanded={open}
      >
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent text-primary"><Icon size={17} /></span>
          <span className="text-base font-extrabold text-secondary">{heading}</span>
        </div>
        {open ? <ChevronUp size={18} className="shrink-0 text-muted-foreground" /> : <ChevronDown size={18} className="shrink-0 text-muted-foreground" />}
      </button>
      {open && <div className="border-t border-border px-6 pb-6 pt-5">{children}</div>}
    </div>
  );
}

/** Wraps a form field — label is rendered as a sibling <span> by the caller, not passed as a prop */
function FieldWrap({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-1.5">{children}</div>;
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span className="text-xs font-bold text-muted-foreground">{children}</span>;
}

function TextInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm text-secondary placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
    />
  );
}

function TextArea({ value, onChange, placeholder, rows = 3 }: { value: string; onChange: (v: string) => void; placeholder?: string; rows?: number }) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      className="w-full resize-y rounded-xl border border-border bg-background px-4 py-2.5 text-sm leading-6 text-secondary placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
    />
  );
}

function TagListEditor({ items, onChange, placeholder }: { items: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const trimmed = draft.trim();
    if (trimmed && !items.includes(trimmed)) { onChange([...items, trimmed]); setDraft(''); }
  };
  const remove = (index: number) => onChange(items.filter((_, i) => i !== index));
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-2">
        {items.map((item, i) => (
          <span key={i} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-3 py-1 text-xs font-semibold text-secondary">
            {item}
            <button type="button" onClick={() => remove(i)} aria-label={`Remove ${item}`} className="text-muted-foreground hover:text-destructive"><X size={12} /></button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          placeholder={placeholder ?? 'Add item…'}
          className="flex-1 rounded-xl border border-border bg-background px-4 py-2 text-sm text-secondary placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
        <button type="button" onClick={add} className="rounded-xl bg-accent px-4 py-2 text-sm font-bold text-primary hover:bg-primary hover:text-primary-foreground">Add</button>
      </div>
    </div>
  );
}

// ─── Website Connect Screen ───────────────────────────────────────────────────

function ConnectWebsiteScreen({ onAnalyzed }: { onAnalyzed: (profile: MarketingProfile) => void }) {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingMode, setLoadingMode] = useState<'website' | 'upload'>('website');
  const [stepIndex, setStepIndex] = useState(0);
  const [error, setError] = useState('');
  const [showUpload, setShowUpload] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startStepCycle = () => {
    setStepIndex(0);
    intervalRef.current = setInterval(() => {
      setStepIndex((prev) => (prev + 1 < LOADING_STEPS.length ? prev + 1 : prev));
    }, 2800);
  };

  const stopStepCycle = () => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
  };

  useEffect(() => () => stopStepCycle(), []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) { setError('Please enter your website URL.'); return; }
    setError('');
    setLoading(true);
    setLoadingMode('website');
    startStepCycle();
    try {
      const response = await fetch('/api/marketing/analyze', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ websiteUrl: trimmed }),
      });
      const payload = await response.json() as { marketingProfile?: MarketingProfile; error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Analysis failed.');
      if (payload.marketingProfile) onAnalyzed(payload.marketingProfile);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Something went wrong. Please try again.';
      setError(msg);
      setShowUpload(true);
    } finally {
      stopStepCycle();
      setLoading(false);
    }
  };

  const handleFileUpload = async (file: File) => {
    setError('');
    setLoading(true);
    setLoadingMode('upload');
    startStepCycle();
    try {
      const formData = new FormData();
      formData.append('file', file);
      const response = await fetch('/api/marketing/upload', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });
      const payload = await response.json() as { marketingProfile?: MarketingProfile; error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Upload failed.');
      if (payload.marketingProfile) onAnalyzed(payload.marketingProfile);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      stopStepCycle();
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[420px] flex-col items-center justify-center gap-8 rounded-3xl border border-border bg-card p-12 text-center shadow-sm">
        <div className="relative">
          <div className="pilot-glow flex h-24 w-24 items-center justify-center rounded-full border border-primary bg-card shadow-xl">
            <PilotAvatar size="lg" state="thinking" className="h-16 w-16" />
          </div>
        </div>
        <div>
          <p className="text-xl font-extrabold tracking-[-0.03em] text-secondary">{LOADING_STEPS[stepIndex]}</p>
          <p className="mt-2 text-sm text-muted-foreground">
            {loadingMode === 'upload' ? 'Reading your document…' : marketing.loadingSubtext}
          </p>
        </div>
        <div className="flex gap-1.5">
          {LOADING_STEPS.map((_, i) => (
            <span key={i} className={`h-1.5 w-6 rounded-full transition-colors ${i <= stepIndex ? 'bg-primary' : 'bg-border'}`} aria-hidden="true" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl">
      <div className="rounded-3xl border border-border bg-card p-8 shadow-sm sm:p-10">
        <div className="flex flex-col items-center text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-accent text-primary">
            <Globe size={28} />
          </div>
          <h2 className="mt-5 text-2xl font-extrabold tracking-[-0.04em] text-secondary">{marketing.connectScreen.heading}</h2>
          <p className="mt-2 text-base text-muted-foreground">{marketing.connectScreen.body}</p>
        </div>

        <form onSubmit={(e) => { void handleSubmit(e); }} className="mt-8 grid gap-4">
          <div>
            <label htmlFor="website-url" className="sr-only">Business website URL</label>
            <input
              id="website-url"
              type="url"
              value={url}
              onChange={(e) => { setUrl(e.target.value); if (error) { setError(''); setShowUpload(false); } }}
              placeholder={marketing.connectScreen.urlPlaceholder}
              required
              className="w-full rounded-xl border border-border bg-background px-5 py-3.5 text-base text-secondary placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>

          {error && (
            <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3">
              <p className="text-sm font-semibold text-destructive">{error}</p>
            </div>
          )}

          <button
            type="submit"
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-6 py-3.5 text-sm font-extrabold text-primary-foreground transition-transform hover:-translate-y-0.5 disabled:opacity-60"
          >
            <Sparkles size={16} />
            {marketing.connectScreen.cta}
          </button>
        </form>

        {/* Upload fallback — shown after a failed website analysis */}
        {showUpload && (
          <div className="mt-6">
            <div className="flex items-center gap-3 py-2">
              <div className="h-px flex-1 bg-border" />
              <span className="text-xs font-bold text-muted-foreground">{marketing.uploadFallback.orDivider}</span>
              <div className="h-px flex-1 bg-border" />
            </div>
            <div className="mt-4 rounded-2xl border border-border bg-muted p-5">
              <div className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-card text-primary shadow-sm"><Upload size={17} /></span>
                <div className="min-w-0">
                  <p className="text-sm font-extrabold text-secondary">{marketing.uploadFallback.heading}</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">{marketing.uploadFallback.body}</p>
                </div>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt,.md,.docx,.pdf,.doc"
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleFileUpload(file);
                }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-primary bg-card px-5 py-2.5 text-sm font-extrabold text-primary transition-colors hover:bg-accent"
              >
                <Upload size={15} />
                {marketing.uploadFallback.cta}
              </button>
            </div>
          </div>
        )}

        <p className="mt-6 text-center text-xs text-muted-foreground">{marketing.connectScreen.disclaimer}</p>
      </div>
    </div>
  );
}

// ─── Business Profile Editor ──────────────────────────────────────────────────

function marketingTraceId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function ProfileEditor({ initial, onSaved }: { initial: MarketingProfile; onSaved: (profile: MarketingProfile) => void }) {
  const [form, setForm] = useState<EditableProfile>(() => profileToEditable(initial));
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [saveError, setSaveError] = useState('');
  const [saved, setSaved] = useState(false);

  const set = <K extends keyof EditableProfile>(key: K, value: EditableProfile[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  const handleSave = async () => {
    if (savingRef.current) return;

    const requestId = marketingTraceId('profile-confirm');
    savingRef.current = true;
    setSaving(true);
    setSaveError('');
    console.info(JSON.stringify({ event: 'marketing-profile.confirm-click', requestId, serviceCount: form.services.length, productCount: form.products.length }));

    try {
      const submitted = {
        ...form,
        services: [...form.services],
        products: [...form.products],
        keySellingPoints: [...form.keySellingPoints],
      };
      console.info(JSON.stringify({ event: 'marketing-profile.request-start', requestId, serviceCount: submitted.services.length, productCount: submitted.products.length }));

      const response = await fetch('/api/marketing/profile', {
        method: 'PUT',
        credentials: 'include',
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
          'X-Marketing-Trace': requestId,
        },
        body: JSON.stringify(submitted),
      });
      const payload = await response.json() as { marketingProfile?: MarketingProfile; error?: string };
      console.info(JSON.stringify({ event: 'marketing-profile.response', requestId, status: response.status, profileId: payload.marketingProfile?.id ?? null }));
      if (!response.ok) throw new Error(payload.error ?? 'Save failed.');
      if (!payload.marketingProfile) throw new Error('The server did not return the saved Business Profile.');

      const reload = await fetch('/api/marketing/profile', {
        credentials: 'include',
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache', 'X-Marketing-Trace': requestId },
      });
      const reloaded = await reload.json() as { marketingProfile?: MarketingProfile; error?: string };
      console.info(JSON.stringify({ event: 'marketing-profile.readback', requestId, status: reload.status, profileId: reloaded.marketingProfile?.id ?? null, serviceCount: parseJsonArray(reloaded.marketingProfile?.services).length, productCount: parseJsonArray(reloaded.marketingProfile?.products).length }));
      if (!reload.ok || !reloaded.marketingProfile) throw new Error(reloaded.error ?? 'The Business Profile could not be reloaded after saving.');
      if (reloaded.marketingProfile.services !== payload.marketingProfile.services || reloaded.marketingProfile.products !== payload.marketingProfile.products) {
        throw new Error('The saved services or products did not match the reloaded Business Profile.');
      }

      setForm(profileToEditable(reloaded.marketingProfile));
      onSaved(reloaded.marketingProfile);
      setSaved(true);
      console.info(JSON.stringify({ event: 'marketing-profile.persistence-confirmed', requestId, profileId: reloaded.marketingProfile.id, serviceCount: parseJsonArray(reloaded.marketingProfile.services).length, productCount: parseJsonArray(reloaded.marketingProfile.products).length }));
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Unable to save. Please try again.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <form onSubmit={(e) => e.preventDefault()} className="grid gap-5">

      {/* Business Overview */}
      <SectionCard icon={Building2} heading={<span>{marketing.sections.overview}</span>}>
        <div className="grid gap-5 sm:grid-cols-2">
          <FieldWrap>
            <FieldLabel>{marketing.fields.businessName}</FieldLabel>
            <TextInput value={form.businessName} onChange={(v) => set('businessName', v)} placeholder="Your business name" />
          </FieldWrap>
          <FieldWrap>
            <FieldLabel>{marketing.fields.location}</FieldLabel>
            <TextInput value={form.location} onChange={(v) => set('location', v)} placeholder="City, Province" />
          </FieldWrap>
          <FieldWrap>
            <FieldLabel>{marketing.fields.contactPhone}</FieldLabel>
            <TextInput value={form.contactPhone} onChange={(v) => set('contactPhone', v)} placeholder="+1 (555) 000-0000" />
          </FieldWrap>
          <FieldWrap>
            <FieldLabel>{marketing.fields.contactEmail}</FieldLabel>
            <TextInput value={form.contactEmail} onChange={(v) => set('contactEmail', v)} placeholder="hello@yourbusiness.com" />
          </FieldWrap>
          <FieldWrap>
            <FieldLabel>{marketing.fields.businessHours}</FieldLabel>
            <TextInput value={form.businessHours} onChange={(v) => set('businessHours', v)} placeholder="Mon–Fri 9am–5pm" />
          </FieldWrap>
          <FieldWrap>
            <FieldLabel>{marketing.fields.website}</FieldLabel>
            <TextInput value={initial.websiteUrl ?? ''} onChange={() => undefined} placeholder="https://yourwebsite.com" />
          </FieldWrap>
        </div>
        <div className="mt-5">
          <FieldWrap>
            <FieldLabel>{marketing.fields.businessDescription}</FieldLabel>
            <TextArea value={form.businessDescription} onChange={(v) => set('businessDescription', v)} placeholder="A brief description of what your business does and who you serve." rows={4} />
          </FieldWrap>
        </div>
      </SectionCard>

      {/* Services & Products */}
      <SectionCard icon={Briefcase} heading={<span>{marketing.sections.servicesProducts}</span>}>
        <div className="grid gap-5">
          <FieldWrap>
            <FieldLabel>{marketing.fields.services}</FieldLabel>
            <TagListEditor items={form.services} onChange={(v) => set('services', v)} placeholder="Add a service…" />
          </FieldWrap>
          <FieldWrap>
            <FieldLabel>{marketing.fields.products}</FieldLabel>
            <TagListEditor items={form.products} onChange={(v) => set('products', v)} placeholder="Add a product…" />
          </FieldWrap>
          <FieldWrap>
            <FieldLabel>{marketing.fields.pricing}</FieldLabel>
            <TextArea value={form.pricing} onChange={(v) => set('pricing', v)} placeholder="Summarize your pricing, packages, or rates." rows={3} />
          </FieldWrap>
        </div>
      </SectionCard>

      {/* Customers */}
      <SectionCard icon={Users} heading={<span>{marketing.sections.customers}</span>}>
        <div className="grid gap-5">
          <FieldWrap>
            <FieldLabel>{marketing.fields.targetCustomers}</FieldLabel>
            <TextArea value={form.targetCustomers} onChange={(v) => set('targetCustomers', v)} placeholder="Who are your ideal customers? (e.g. homeowners in the GTA, small business owners, families)" rows={2} />
          </FieldWrap>
          <FieldWrap>
            <FieldLabel>{marketing.fields.customerNeeds}</FieldLabel>
            <TextArea value={form.customerNeeds} onChange={(v) => set('customerNeeds', v)} placeholder="What problems do your customers have that you solve?" rows={2} />
          </FieldWrap>
        </div>
      </SectionCard>

      {/* Brand */}
      <SectionCard icon={Palette} heading={<span>{marketing.sections.brand}</span>}>
        <div className="grid gap-5 sm:grid-cols-2">
          <FieldWrap>
            <FieldLabel>{marketing.fields.brandTone}</FieldLabel>
            <TextInput value={form.brandTone} onChange={(v) => set('brandTone', v)} placeholder="e.g. Warm and approachable" />
          </FieldWrap>
          <FieldWrap>
            <FieldLabel>{marketing.fields.brandColors}</FieldLabel>
            <TextInput value={form.brandColors} onChange={(v) => set('brandColors', v)} placeholder="e.g. Navy blue, warm gold" />
          </FieldWrap>
        </div>
        <div className="mt-5">
          <FieldWrap>
            <FieldLabel>{marketing.fields.brandDescription}</FieldLabel>
            <TextArea value={form.brandDescription} onChange={(v) => set('brandDescription', v)} placeholder="How would you describe your brand's personality and values?" rows={3} />
          </FieldWrap>
        </div>
        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <FieldWrap>
            <FieldLabel>{marketing.fields.logoUrl}</FieldLabel>
            <TextInput value={form.logoUrl} onChange={(v) => set('logoUrl', v)} placeholder="https://yourwebsite.com/logo.png" />
          </FieldWrap>
        </div>
        {/* Social links */}
        <div className="mt-5 grid gap-3">
          <p className="text-xs font-bold text-muted-foreground">{marketing.fields.socialLinks}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {(['facebook', 'instagram', 'twitter', 'linkedin', 'tiktok', 'youtube'] as const).map((platform) => (
              <FieldWrap key={platform}>
                <FieldLabel>{platform.charAt(0).toUpperCase() + platform.slice(1)}</FieldLabel>
                <TextInput
                  value={form.socialLinks[platform] ?? ''}
                  onChange={(v) => set('socialLinks', { ...form.socialLinks, [platform]: v || null })}
                  placeholder={`https://${platform}.com/yourbusiness`}
                />
              </FieldWrap>
            ))}
          </div>
        </div>
      </SectionCard>

      {/* Marketing Information */}
      <SectionCard icon={Megaphone} heading={<span>{marketing.sections.marketing}</span>}>
        <div className="grid gap-5">
          <FieldWrap>
            <FieldLabel>{marketing.fields.keySellingPoints}</FieldLabel>
            <TagListEditor items={form.keySellingPoints} onChange={(v) => set('keySellingPoints', v)} placeholder="Add a selling point…" />
          </FieldWrap>
          <FieldWrap>
            <FieldLabel>{marketing.fields.promotions}</FieldLabel>
            <TextArea value={form.promotions} onChange={(v) => set('promotions', v)} placeholder="Any current offers, promotions, or seasonal specials." rows={2} />
          </FieldWrap>
          <FieldWrap>
            <FieldLabel>{marketing.fields.faq}</FieldLabel>
            <TextArea value={form.frequentlyAskedQuestions} onChange={(v) => set('frequentlyAskedQuestions', v)} placeholder="Common questions your customers ask." rows={4} />
          </FieldWrap>
          <FieldWrap>
            <FieldLabel>{marketing.fields.importantNotes}</FieldLabel>
            <TextArea value={form.importantNotes} onChange={(v) => set('importantNotes', v)} placeholder="Anything else Pilot should know when creating marketing content for your business." rows={3} />
          </FieldWrap>
        </div>
      </SectionCard>

      {/* Save bar */}
      {saveError && <p role="alert" className="rounded-xl border border-destructive bg-card px-4 py-3 text-sm font-semibold text-destructive">{saveError}</p>}

      <div className="flex items-center justify-between gap-4 rounded-2xl border border-border bg-card px-6 py-4 shadow-sm">
        <div>
          {saved
            ? <p className="flex items-center gap-2 text-sm font-bold text-emerald-600"><Check size={16} /><span>{marketing.saveBar.savedMessage}</span></p>
            : <p className="text-sm text-muted-foreground">{marketing.saveBar.pendingMessage}</p>}
          {saved && <p className="mt-1 text-xs text-muted-foreground">{marketing.saveBar.savedSubtext}</p>}
        </div>
        <button
          type="button"
          onClick={() => { void handleSave(); }}
          disabled={saving}
          className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-extrabold text-primary-foreground transition-transform hover:-translate-y-0.5 disabled:opacity-60"
        >
              {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
              <span>{saving ? marketing.saveBar.savingLabel : marketing.saveBar.saveCta}</span>
        </button>
      </div>
    </form>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────────

function EmptyState({ onConnect }: { onConnect: () => void }) {
  return (
    <div className="grid gap-xl">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-3xl border border-primary bg-secondary p-8 shadow-xl sm:p-12">
        <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full blur-3xl" style={{ background: 'hsl(var(--pilot-glow) / 0.18)' }} aria-hidden="true" />
        <div className="relative grid items-center gap-8 lg:grid-cols-[1fr_auto]">
          <div>
            <p className="text-sm font-bold text-primary-foreground">{marketing.hero.eyebrow}</p>
            <h1 className="mt-2 text-4xl font-extrabold tracking-[-0.05em] text-primary-foreground sm:text-5xl">{marketing.hero.headline}</h1>
            <p className="mt-4 max-w-xl text-lg leading-8 text-secondary-foreground">{marketing.hero.body}</p>
            <button
              type="button"
              onClick={onConnect}
              className="mt-8 inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3.5 text-sm font-extrabold text-primary-foreground transition-transform hover:-translate-y-0.5"
            >
              <Globe size={17} />
              {marketing.hero.cta}
              <ArrowRight size={17} />
            </button>
          </div>
          <div className="hidden lg:flex">
            <div className="pilot-glow flex h-32 w-32 items-center justify-center rounded-full border border-primary bg-card shadow-xl">
              <PilotAvatar size="lg" state="idle" className="h-20 w-20" />
            </div>
          </div>
        </div>
      </section>

      {/* What comes next */}
      <section className="rounded-3xl border border-border bg-card p-8 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent text-primary"><BookOpen size={17} /></span>
          <h2 className="text-lg font-extrabold text-secondary">{marketing.whatComesNext.heading}</h2>
        </div>
        <p className="mt-3 text-base text-muted-foreground">{marketing.whatComesNext.body}</p>
        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {marketing.whatComesNext.features.map((item) => {
            const icons: Record<string, React.ElementType> = { f1: Pencil, f2: BookOpen, f3: Megaphone };
            const Icon = icons[item.id] ?? Pencil;
            return (
              <div key={item.id} className="rounded-2xl border border-border bg-muted p-5">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-card text-primary shadow-sm"><Icon size={17} /></span>
                <p className="mt-3 text-sm font-extrabold text-secondary">{item.label}</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{item.detail}</p>
              </div>
            );
          })}
        </div>
        <p className="mt-5 text-xs font-semibold text-muted-foreground">{marketing.whatComesNext.disclaimer}</p>
      </section>
    </div>
  );
}

// ─── Profile Header (after profile exists) ────────────────────────────────────

function ProfileHeader({ profile, onReconnect }: { profile: MarketingProfile; onReconnect: () => void }) {
  return (
    <div className="flex flex-col gap-4 rounded-3xl border border-border bg-card p-6 shadow-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-4">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-accent text-primary"><Sparkles size={20} /></span>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-extrabold tracking-[-0.03em] text-secondary">{marketing.profileHeader.title}</h1>
            <span className="rounded-full bg-accent px-2.5 py-1 text-xs font-bold text-primary">
              {profile.approvalStatus === 'confirmed' ? marketing.profileHeader.confirmedStatus : marketing.profileHeader.reviewStatus}
            </span>
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {profile.websiteUrl
              ? <>Pilot has learned your business from <span className="font-semibold text-primary">{profile.websiteUrl}</span></>
              : marketing.saveBar.savedMessage}
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={onReconnect}
        className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-border bg-muted px-4 py-2.5 text-sm font-bold text-secondary transition-colors hover:border-primary hover:text-primary"
      >
        <Globe size={15} />
        {marketing.profileHeader.reanalyseLabel}
      </button>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

type View = 'loading' | 'empty' | 'connect' | 'profile';

function MarketingContent() {
  const [view, setView] = useState<View>('loading');
  const [profile, setProfile] = useState<MarketingProfile | null>(null);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    void (async () => {
      try {
        const traceId = marketingTraceId('profile-page-load');
        const response = await fetch('/api/marketing/profile', {
          credentials: 'include',
          cache: 'no-store',
          headers: { 'Cache-Control': 'no-cache', 'X-Marketing-Trace': traceId },
        });
        if (response.status === 404) { setView('empty'); return; }
        if (!response.ok) throw new Error('Unable to load marketing profile.');
        const payload = await response.json() as { marketingProfile: MarketingProfile };
        console.info(JSON.stringify({ event: 'marketing-profile.page-load', requestId: traceId, profileId: payload.marketingProfile.id, serviceCount: parseJsonArray(payload.marketingProfile.services).length, productCount: parseJsonArray(payload.marketingProfile.products).length }));
        setProfile(payload.marketingProfile);
        setView('profile');
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : 'Unable to load.');
        setView('empty');
      }
    })();
  }, []);

  const handleAnalyzed = (p: MarketingProfile) => { setProfile(p); setView('profile'); };
  const handleSaved = (p: MarketingProfile) => setProfile(p);

  return (
    <WorkspaceLayout>
        <Helmet>
          <title>Marketing — Connection Pilot</title>
          <meta name="description" content="Let Pilot handle your marketing. Connect your website and Pilot will learn your business to generate social content and manage your marketing." />
          <meta name="robots" content="noindex" />
        </Helmet>

      <main className="grid gap-xl">
        {loadError && <p role="alert" className="rounded-xl border border-destructive bg-card p-base text-sm font-semibold text-destructive">{loadError}</p>}

        {view === 'loading' && (
          <div className="flex min-h-[320px] items-center justify-center">
            <Loader2 size={28} className="animate-spin text-primary" />
          </div>
        )}

        {view === 'empty' && <EmptyState onConnect={() => setView('connect')} />}

        {view === 'connect' && (
          <div className="grid gap-xl">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setView('empty')}
                className="text-sm font-semibold text-muted-foreground hover:text-primary"
              >
                ← Back
              </button>
              <h1 className="text-2xl font-extrabold tracking-[-0.04em] text-secondary">Connect Your Website</h1>
            </div>
            <ConnectWebsiteScreen onAnalyzed={handleAnalyzed} />
          </div>
        )}

        {view === 'profile' && profile && (
          <div className="grid gap-xl">
            <ProfileHeader profile={profile} onReconnect={() => setView('connect')} />
            <div>
            <div className="mb-5 flex items-center gap-3">
              <h2 className="text-xl font-extrabold tracking-[-0.03em] text-secondary">{marketing.profileHeader.sectionHeading}</h2>
              <span className="rounded-full bg-accent px-3 py-1 text-xs font-bold text-primary">{profile.approvalStatus === 'confirmed' ? marketing.profileHeader.confirmedStatus : marketing.profileHeader.reviewBadge}</span>
            </div>
            <p className="mb-6 text-sm text-muted-foreground">{marketing.profileHeader.sectionBody}</p>
              <ProfileEditor initial={profile} onSaved={handleSaved} />
            </div>
          </div>
        )}
      </main>
    </WorkspaceLayout>
  );
}

export default function MarketingPage() {
  return (
    <ProtectedRoute>
      <MarketingContent />
    </ProtectedRoute>
  );
}
