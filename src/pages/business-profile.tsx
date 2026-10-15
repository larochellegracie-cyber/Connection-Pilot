import { Helmet } from '@dr.pogodin/react-helmet';
import { type FormEvent, useEffect, useState } from 'react';
import { Globe2, Save, Sparkles } from 'lucide-react';
import { ProtectedRoute } from '@/lib/auth/auth-client';
import PilotDocumentReview from '@/components/PilotDocumentReview';
import WorkspaceLayout from '@/layouts/WorkspaceLayout';
import { business_profile } from 'virtual:content';

type Profile = { businessName: string; businessType: string; businessEmail: string | null; address: string; city: string; region: string; postalCode: string; website: string | null };
type Knowledge = { serviceArea: string; businessHours: string; servicesOffered: string; pricingInformation: string; frequentlyAskedQuestions: string; policies: string; receptionistInstructions: string; discloseAutomation: boolean };
type FormValues = Record<'businessName' | 'businessType' | 'businessEmail' | 'address' | 'city' | 'region' | 'postalCode' | 'website' | 'serviceArea' | 'businessHours' | 'servicesOffered' | 'pricingInformation' | 'frequentlyAskedQuestions' | 'policies' | 'receptionistInstructions', string> & { discloseAutomation: boolean };
type PageData = { profile: Profile; knowledge: Knowledge };
type Suggestion = Partial<FormValues>;

const inputClass = 'mt-1 w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-secondary outline-none focus:border-primary focus:ring-2 focus:ring-ring';

function valuesFrom(data: PageData): FormValues {
  return { businessName: data.profile.businessName, businessType: data.profile.businessType, businessEmail: data.profile.businessEmail ?? '', address: data.profile.address, city: data.profile.city, region: data.profile.region, postalCode: data.profile.postalCode, website: data.profile.website ?? '', serviceArea: data.knowledge.serviceArea, businessHours: data.knowledge.businessHours, servicesOffered: data.knowledge.servicesOffered, pricingInformation: data.knowledge.pricingInformation, frequentlyAskedQuestions: data.knowledge.frequentlyAskedQuestions, policies: data.knowledge.policies, receptionistInstructions: data.knowledge.receptionistInstructions, discloseAutomation: data.knowledge.discloseAutomation };
}

function BusinessProfileContent() {
  const [data, setData] = useState<PageData | null>(null);
  const [form, setForm] = useState<FormValues | null>(null);
  const [website, setWebsite] = useState('');
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [websiteImportUrl, setWebsiteImportUrl] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [reviewing, setReviewing] = useState(false);

  async function load() {
    try {
      const response = await fetch('/api/business-knowledge', { credentials: 'include' });
      const payload = await response.json() as PageData & { error?: string };
      if (!response.ok) throw new Error(payload.error || business_profile.errors.load);
      setData(payload); setForm(valuesFrom(payload));
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : business_profile.errors.load); }
  }
  useEffect(() => { void load(); }, []);

  function updateField(name: keyof FormValues, value: string | boolean) {
    setForm((current) => current ? { ...current, [name]: value } : current);
  }

  async function reviewWebsite() {
    setError(''); setNotice('');
    setForm((current) => current ? { ...current, website } : current);
    setWebsiteImportUrl(website);
    setReviewing(true);
    try {
      const response = await fetch('/api/business-knowledge/preview', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: 'website', url: website }) });
      const payload = await response.json() as { suggestion?: Suggestion; error?: string };
      if (!response.ok || !payload.suggestion) throw new Error(payload.error || business_profile.errors.extract);
      setSuggestion({ ...payload.suggestion, website });
    } catch (reviewError) { setError(reviewError instanceof Error ? reviewError.message : business_profile.errors.extract); }
    finally { setReviewing(false); }
  }

  function applySuggestion() {
    if (!suggestion) return;
    setForm((current) => current ? { ...current, ...Object.fromEntries(Object.entries(suggestion).filter(([, value]) => typeof value === 'string' && value.trim())) } : current);
    setSuggestion(null); setNotice(business_profile.actions.reviewSaved);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!form) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/business-knowledge', { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...form, websiteImportUrl }) });
      const payload = await response.json() as { error?: string; importedPages?: string[] };
      if (!response.ok) throw new Error(payload.error || business_profile.errors.save);
      setWebsiteImportUrl(''); setNotice(payload.importedPages?.length ? `${business_profile.actions.saved} ${payload.importedPages.length} website pages are ready for Pilot.` : business_profile.actions.saved); await load();
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : business_profile.errors.save); }
    finally { setSaving(false); }
  }

  if (!data || !form) return <WorkspaceLayout><main className="py-xl"><p className="text-sm font-bold text-muted-foreground">{error || business_profile.loading}</p></main></WorkspaceLayout>;

  return <WorkspaceLayout><main className="grid gap-xl">
    <section className="border-b border-border pb-lg"><p className="text-sm font-bold text-primary">{business_profile.hero.eyebrow}</p><h1 className="mt-xs text-4xl font-extrabold tracking-[-0.045em] text-secondary">{business_profile.hero.title}</h1><p className="mt-sm max-w-2xl text-muted-foreground">{business_profile.hero.description}</p></section>
    <PilotDocumentReview />
    <section className="rounded-2xl border border-border bg-card p-base shadow-sm sm:p-xl" aria-labelledby="website-import-title"><div className="flex items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent text-primary"><Globe2 size={19} /></span><div><h2 id="website-import-title" className="text-xl font-extrabold text-secondary">Add your website</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">A website is a separate source of business information. Review what Connection Pilot finds before adding it to your profile.</p></div></div><div className="mt-base flex flex-col gap-3 sm:flex-row"><input value={website} onChange={(event) => setWebsite(event.target.value)} type="url" placeholder={business_profile.setup.websitePlaceholder} className={`${inputClass} mt-0 flex-1`} /><button type="button" disabled={reviewing || !website.trim()} onClick={() => void reviewWebsite()} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground hover:bg-secondary disabled:opacity-60"><Sparkles size={16} />{reviewing ? business_profile.setup.extracting : 'Review website'}</button></div>{suggestion && <div className="mt-base rounded-xl border border-primary bg-accent p-base"><h3 className="font-extrabold text-secondary">{business_profile.setup.reviewTitle}</h3><p className="mt-1 text-sm text-muted-foreground">{business_profile.setup.reviewDescription}</p><div className="mt-4 grid gap-2 text-sm text-secondary">{Object.entries(suggestion).filter(([, value]) => typeof value === 'string' && value.trim()).map(([field, value]) => <p key={field}><span className="font-bold">{field}: </span>{value}</p>)}</div><div className="mt-4 flex flex-wrap gap-3"><button type="button" onClick={applySuggestion} className="rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground">{business_profile.setup.saveSuggestions}</button><button type="button" onClick={() => setSuggestion(null)} className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-bold text-secondary">{business_profile.setup.discard}</button></div></div>}</section>
    <form onSubmit={save} className="grid gap-xl"><section className="rounded-2xl border border-border bg-card p-base shadow-sm sm:p-xl"><h2 className="text-xl font-extrabold text-secondary">{business_profile.sections.core}</h2><p className="mt-1 text-sm text-muted-foreground">{business_profile.sections.coreDescription}</p><div className="mt-base grid gap-4 sm:grid-cols-2"><label className="text-sm font-bold text-secondary">{business_profile.fields.businessName}<input required value={form.businessName} onChange={(event) => updateField('businessName', event.target.value)} className={inputClass} /></label><label className="text-sm font-bold text-secondary">{business_profile.fields.industry}<input required value={form.businessType} onChange={(event) => updateField('businessType', event.target.value)} className={inputClass} /></label><label className="text-sm font-bold text-secondary">{business_profile.fields.businessEmail}<input type="email" value={form.businessEmail} onChange={(event) => updateField('businessEmail', event.target.value)} className={inputClass} /></label><label className="text-sm font-bold text-secondary">{business_profile.fields.website}<input type="url" value={form.website} onChange={(event) => updateField('website', event.target.value)} className={inputClass} /></label><label className="text-sm font-bold text-secondary sm:col-span-2">{business_profile.fields.address}<input required value={form.address} onChange={(event) => updateField('address', event.target.value)} className={inputClass} /></label><label className="text-sm font-bold text-secondary">{business_profile.fields.city}<input required value={form.city} onChange={(event) => updateField('city', event.target.value)} className={inputClass} /></label><label className="text-sm font-bold text-secondary">{business_profile.fields.region}<input required value={form.region} onChange={(event) => updateField('region', event.target.value)} className={inputClass} /></label><label className="text-sm font-bold text-secondary">{business_profile.fields.postalCode}<input required value={form.postalCode} onChange={(event) => updateField('postalCode', event.target.value)} className={inputClass} /></label><label className="text-sm font-bold text-secondary">{business_profile.fields.serviceArea}<input required value={form.serviceArea} onChange={(event) => updateField('serviceArea', event.target.value)} className={inputClass} /></label><label className="text-sm font-bold text-secondary sm:col-span-2">{business_profile.fields.hours}<textarea required value={form.businessHours} onChange={(event) => updateField('businessHours', event.target.value)} rows={3} className={inputClass} /></label></div></section>
    <section className="rounded-2xl border border-border bg-card p-base shadow-sm sm:p-xl"><h2 className="text-xl font-extrabold text-secondary">{business_profile.sections.knowledge}</h2><p className="mt-1 text-sm text-muted-foreground">{business_profile.sections.knowledgeDescription}</p><div className="mt-base grid gap-4"><label className="text-sm font-bold text-secondary">{business_profile.fields.services}<textarea required value={form.servicesOffered} onChange={(event) => updateField('servicesOffered', event.target.value)} rows={4} className={inputClass} /></label><label className="text-sm font-bold text-secondary">{business_profile.fields.pricing}<textarea value={form.pricingInformation} onChange={(event) => updateField('pricingInformation', event.target.value)} rows={3} className={inputClass} /></label><label className="text-sm font-bold text-secondary">{business_profile.fields.faqs}<textarea value={form.frequentlyAskedQuestions} onChange={(event) => updateField('frequentlyAskedQuestions', event.target.value)} rows={4} className={inputClass} /></label><label className="text-sm font-bold text-secondary">{business_profile.fields.policies}<textarea value={form.policies} onChange={(event) => updateField('policies', event.target.value)} rows={3} className={inputClass} /></label></div></section>
    <section className="rounded-2xl border border-border bg-card p-base shadow-sm sm:p-xl"><h2 className="text-xl font-extrabold text-secondary">{business_profile.sections.advanced}</h2><div className="mt-base grid gap-4"><label className="text-sm font-bold text-secondary">{business_profile.fields.instructions}<textarea value={form.receptionistInstructions} onChange={(event) => updateField('receptionistInstructions', event.target.value)} rows={4} className={inputClass} /></label><label className="flex items-start gap-3 rounded-xl border border-border bg-muted p-4 text-sm text-secondary"><input type="checkbox" checked={form.discloseAutomation} onChange={(event) => updateField('discloseAutomation', event.target.checked)} className="mt-1 h-4 w-4 accent-primary" /><span><span className="block font-extrabold">{business_profile.fields.discloseAutomation}</span><span className="mt-1 block leading-6 text-muted-foreground">{business_profile.fields.discloseAutomationHelp}</span></span></label></div></section>
    {error && <p role="alert" className="rounded-xl border border-destructive bg-card p-4 text-sm font-bold text-destructive">{error}</p>}{notice && <p role="status" className="rounded-xl border border-primary bg-accent p-4 text-sm font-bold text-secondary">{notice}</p>}<button disabled={saving} className="inline-flex w-fit items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground hover:bg-secondary disabled:opacity-60"><Save size={16} />{saving ? business_profile.setup.saving : business_profile.actions.save}</button></form>
  </main></WorkspaceLayout>;
}

export default function BusinessProfilePage() { return <><Helmet><title>{business_profile.seo.title}</title><meta name="description" content={business_profile.seo.description} /><meta name="robots" content="noindex, nofollow" /></Helmet><ProtectedRoute><BusinessProfileContent /></ProtectedRoute></>; }
