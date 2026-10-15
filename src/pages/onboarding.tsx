import { type ChangeEvent, type FormEvent, useEffect, useState } from 'react';
import { Helmet } from '@dr.pogodin/react-helmet';
import { Navigate, useNavigate } from 'react-router';
import { CheckCircle2, FileUp, Globe2, MessageCircle, PencilLine, Sparkles } from 'lucide-react';
import { ProtectedRoute, useSession } from '@/lib/auth/auth-client';
import PilotAvatar from '@/components/PilotAvatar';
import { onboarding } from 'virtual:content';

const siteUrl = 'https://connectionpilot.net';
const fieldClass = 'mt-2 w-full rounded-xl border border-border bg-background px-4 py-3 text-sm text-secondary outline-none transition focus:border-primary focus:ring-2 focus:ring-ring';

type ProfileStatus = 'loading' | 'ready' | 'needs_setup';
type Step = 'message' | 'review';
type BusinessKnowledge = { serviceArea: string; pricingInformation: string; frequentlyAskedQuestions: string; policies: string; receptionistInstructions: string };
type BusinessSummary = { businessName: string; businessType: string; location: string; businessHours: string; servicesOffered: string; knowledge: BusinessKnowledge };

function OnboardingContent() {
  const navigate = useNavigate();
  const { isAuthenticated } = useSession();
  const [status, setStatus] = useState<ProfileStatus>('loading');
  const [step, setStep] = useState<Step>('message');
  const [description, setDescription] = useState('');
  const [website, setWebsite] = useState('');
  const [fileText, setFileText] = useState('');
  const [fileName, setFileName] = useState('');
  const [showWebsite, setShowWebsite] = useState(false);
  const [showFile, setShowFile] = useState(false);
  const [summary, setSummary] = useState<BusinessSummary>({ businessName: '', businessType: '', location: '', businessHours: '', servicesOffered: '', knowledge: { serviceArea: '', pricingInformation: '', frequentlyAskedQuestions: '', policies: '', receptionistInstructions: '' } });
  const [error, setError] = useState('');
  const [isReviewing, setIsReviewing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      const response = await fetch('/api/business-profile', { credentials: 'include' });
      if (response.ok) { setStatus('ready'); return; }
      if (response.status === 404 || response.status === 409) { setStatus('needs_setup'); return; }
      setError(onboarding.status.setupCheck); setStatus('needs_setup');
    })();
  }, []);

  async function readFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 1024 * 1024) { setError(onboarding.errors.file); return; }
    try {
      setFileName(file.name);
      setFileText(await file.text());
      setError('');
    } catch { setError(onboarding.errors.file); }
  }

  async function reviewDescription(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(''); setIsReviewing(true);
    try {
      const response = await fetch('/api/onboarding/preview', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ description, website: website.trim(), supplementalText: fileText }) });
      const payload = await response.json() as { error?: string; summary?: BusinessSummary; website?: string };
      if (!response.ok || !payload.summary) { setError(payload.error || onboarding.errors.preview); return; }
      if (payload.website) setWebsite(payload.website);
      setSummary(payload.summary); setStep('review');
    } catch { setError(onboarding.errors.preview); }
    finally { setIsReviewing(false); }
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(''); setIsSaving(true);
    try {
      const response = await fetch('/api/onboarding', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'first-time', businessName: summary.businessName, businessType: summary.businessType, location: summary.location, businessHours: summary.businessHours, servicesOffered: summary.servicesOffered, ...summary.knowledge, website: website.trim(), supplementalKnowledge: fileText, supplementalFileName: fileName }) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) { setError(payload.error || onboarding.status.save); return; }
      navigate('/dashboard', { replace: true });
    } catch { setError(onboarding.status.generic); }
    finally { setIsSaving(false); }
  }

  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (status === 'ready') return <Navigate to="/dashboard" replace />;

  return <>
    <Helmet>
      <title>{onboarding.meta.title}</title><meta name="description" content={onboarding.meta.description} /><meta name="robots" content="noindex, nofollow" />
      <link rel="canonical" href={`${siteUrl}/onboarding`} /><meta property="og:title" content={onboarding.meta.title} /><meta property="og:description" content={onboarding.meta.description} /><meta property="og:type" content="website" /><meta property="og:url" content={`${siteUrl}/onboarding`} /><meta property="og:image" content={`${siteUrl}/airo-assets/images/pages/home/hero`} />
      <meta name="twitter:card" content="summary_large_image" /><meta name="twitter:title" content={onboarding.meta.title} /><meta name="twitter:description" content={onboarding.meta.description} /><meta name="twitter:image" content={`${siteUrl}/airo-assets/images/pages/home/hero`} />
    </Helmet>
    <main className="bg-muted py-xxl"><div className="mx-auto grid max-w-5xl gap-xl px-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:px-8">
      <section className="rounded-3xl bg-secondary p-xl text-secondary-foreground shadow-xl sm:p-xxl"><div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground"><Sparkles size={22} /></div><p className="mt-xl text-sm font-bold text-primary-foreground">{onboarding.hero.eyebrow}</p><h1 className="mt-sm text-4xl font-extrabold tracking-[-0.05em] text-primary-foreground sm:text-5xl">{onboarding.hero.title}</h1><p className="mt-base text-lg leading-8 text-secondary-foreground">{onboarding.hero.description}</p><div className="mt-xl flex items-start gap-3 rounded-2xl border border-primary bg-background p-base text-secondary"><PilotAvatar size="md" state="speaking" /><p className="pt-1 text-sm font-semibold leading-6">{onboarding.hero.pilotMessage}</p></div></section>
      <section className="rounded-3xl border border-border bg-card p-base shadow-sm sm:p-xl">{status === 'loading' ? <p className="text-sm font-semibold text-muted-foreground">{onboarding.status.loading}</p> : step === 'message' ? <form onSubmit={reviewDescription} className="grid gap-base"><div className="flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-accent text-primary"><MessageCircle size={20} /></span><div><label htmlFor="business-note" className="text-lg font-extrabold tracking-[-0.02em] text-secondary">{onboarding.prompt.label}</label><p className="mt-1 text-sm text-muted-foreground">{onboarding.prompt.helper}</p></div></div><textarea id="business-note" value={description} onChange={(event) => setDescription(event.target.value)} placeholder={onboarding.prompt.placeholder} className={`${fieldClass} min-h-40 resize-y`} />
        <div className="rounded-2xl border border-border bg-muted p-4"><p className="font-extrabold text-secondary">{onboarding.supplemental.title}</p><p className="mt-1 text-sm leading-6 text-muted-foreground">{onboarding.supplemental.description}</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => setShowWebsite((value) => !value)} className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-bold text-secondary"><Globe2 size={16} />{onboarding.supplemental.website}</button><button type="button" onClick={() => setShowFile((value) => !value)} className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-bold text-secondary"><FileUp size={16} />{onboarding.supplemental.file}</button></div>{showWebsite && <label className="mt-3 block text-sm font-bold text-secondary">{onboarding.supplemental.websiteLabel}<input type="url" value={website} onChange={(event) => setWebsite(event.target.value)} placeholder={onboarding.supplemental.websitePlaceholder} className={fieldClass} /></label>}{showFile && <label className="mt-3 block rounded-xl border border-dashed border-border bg-card p-3 text-sm font-semibold text-secondary"><span>{fileName || onboarding.supplemental.fileLabel}</span><span className="mt-1 block text-xs font-medium text-muted-foreground">{onboarding.supplemental.fileHelp}</span><input type="file" accept=".txt,.md,.csv,.json,.pdf,text/plain,text/markdown,text/csv,application/json,application/pdf" onChange={readFile} className="mt-3 block w-full text-sm text-muted-foreground" /></label>}</div>
        <div className="grid gap-3 sm:grid-cols-2"><button type="submit" disabled={isReviewing} className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3.5 text-sm font-bold text-primary-foreground transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-60"><Sparkles size={18} />{isReviewing ? onboarding.actions.reviewing : onboarding.actions.review}</button><button type="submit" disabled={isReviewing} onClick={() => { setWebsite(''); setFileText(''); setFileName(''); }} className="inline-flex items-center justify-center rounded-xl border border-border bg-card px-5 py-3.5 text-sm font-bold text-secondary hover:border-primary hover:text-primary disabled:opacity-60">{onboarding.actions.skip}</button></div>{error && <p role="alert" className="rounded-xl border border-destructive bg-card p-3 text-sm font-semibold text-destructive">{error}</p>}</form> : <form onSubmit={saveProfile} className="grid gap-base"><div className="flex items-start gap-3"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-accent text-primary"><PilotAvatar size="sm" state="speaking" /></span><div><p className="text-sm font-bold text-primary">{onboarding.review.eyebrow}</p><h2 className="mt-1 text-2xl font-extrabold tracking-[-0.03em] text-secondary">{onboarding.review.title}</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">{onboarding.review.description}</p></div></div><label className="text-sm font-bold text-secondary">{onboarding.review.name}<input required value={summary.businessName} onChange={(event) => setSummary({ ...summary, businessName: event.target.value })} className={fieldClass} autoComplete="organization" /></label><label className="text-sm font-bold text-secondary">{onboarding.review.type}<input required value={summary.businessType} onChange={(event) => setSummary({ ...summary, businessType: event.target.value })} className={fieldClass} /></label><label className="text-sm font-bold text-secondary">{onboarding.review.location}<input required value={summary.location} onChange={(event) => setSummary({ ...summary, location: event.target.value })} className={fieldClass} autoComplete="address-level2" /></label><label className="text-sm font-bold text-secondary">{onboarding.review.hours}<input required value={summary.businessHours} onChange={(event) => setSummary({ ...summary, businessHours: event.target.value })} className={fieldClass} /></label><label className="text-sm font-bold text-secondary">{onboarding.review.services}<textarea required value={summary.servicesOffered} onChange={(event) => setSummary({ ...summary, servicesOffered: event.target.value })} className={fieldClass} rows={3} /></label>{error && <p role="alert" className="rounded-xl border border-destructive bg-card p-3 text-sm font-semibold text-destructive">{error}</p>}<button type="submit" disabled={isSaving} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3.5 text-sm font-bold text-primary-foreground transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-60"><CheckCircle2 size={18} />{isSaving ? onboarding.actions.saving : onboarding.actions.confirm}</button><button type="button" onClick={() => { setStep('message'); setError(''); }} className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-card px-5 py-3 text-sm font-bold text-secondary transition-colors hover:border-primary hover:text-primary"><PencilLine size={17} />{onboarding.actions.startOver}</button></form>}<p className="mt-base text-center text-xs leading-5 text-muted-foreground">{onboarding.notice}</p></section>
    </div></main>
  </>;
}

export default function OnboardingPage() { return <ProtectedRoute><OnboardingContent /></ProtectedRoute>; }
