import { useEffect, useState } from 'react';
import { Helmet } from '@dr.pogodin/react-helmet';
import { Navigate, useNavigate } from 'react-router';
import { ArrowLeft, ArrowRight, Check, Loader2, Sparkles } from 'lucide-react';
import { ProtectedRoute, useSession } from '@/lib/auth/auth-client';
import PilotAvatar from '@/components/PilotAvatar';
import { businessTypes, customerChannels, emptyAnswers, exclusiveChoices, existingData, helpWanted, labelFor, teamSizes, timeConsumers, voiceHelpId, type OnboardingAnswers, type Option } from '@/lib/onboarding-options';

const siteUrl = 'https://connectionpilot.net';
const steps = ['welcome', 'name', 'type', 'channels', 'time', 'help', 'team', 'data', 'done'] as const;
type Step = (typeof steps)[number];
const storageKey = 'cp-onboarding-draft';

type Draft = { step: Step; businessName: string; answers: OnboardingAnswers };

function loadDraft(): Draft | null {
  try { const raw = window.sessionStorage.getItem(storageKey); const parsed = raw ? JSON.parse(raw) as Draft : null; return parsed && steps.includes(parsed.step) ? parsed : null; } catch { return null; }
}
function saveDraft(draft: Draft | null) {
  try { if (draft) window.sessionStorage.setItem(storageKey, JSON.stringify(draft)); else window.sessionStorage.removeItem(storageKey); } catch { /* the draft is only a convenience */ }
}

/** A large answer card. `mode` decides whether it behaves like a radio button or a checkbox. */
function Choice({ option, selected, mode, onPick }: { option: Option; selected: boolean; mode: 'single' | 'multi'; onPick: () => void }) {
  return <button type="button" role={mode === 'single' ? 'radio' : 'checkbox'} aria-checked={selected} onClick={onPick}
    className={`group relative flex min-h-[4.5rem] w-full items-center gap-3 rounded-2xl border-2 p-4 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${selected ? 'border-primary bg-accent shadow-[0_8px_24px_-14px_rgba(36,84,214,0.7)]' : 'border-border bg-card hover:border-[#9DB5EE] hover:bg-[hsl(var(--canvas))]'}`}>
    {option.emoji && <span aria-hidden="true" className="text-2xl">{option.emoji}</span>}
    <span className="min-w-0 flex-1"><span className="block text-[0.9375rem] font-bold text-secondary">{option.label}</span>{option.note && <span className="mt-0.5 block text-xs text-muted-foreground">{option.note}</span>}</span>
    <span aria-hidden="true" className={`flex h-6 w-6 shrink-0 items-center justify-center border-2 transition-colors ${mode === 'single' ? 'rounded-full' : 'rounded-md'} ${selected ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-transparent'}`}><Check size={14} strokeWidth={3} /></span>
  </button>;
}

function OnboardingContent() {
  const navigate = useNavigate();
  const { isAuthenticated } = useSession();
  const [profile, setProfile] = useState<'loading' | 'exists' | 'needed'>('loading');
  const [draft] = useState(loadDraft);
  const [step, setStep] = useState<Step>(draft?.step ?? 'welcome');
  const [businessName, setBusinessName] = useState(draft?.businessName ?? '');
  const [answers, setAnswers] = useState<OnboardingAnswers>({ ...emptyAnswers, ...draft?.answers });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    void (async () => {
      try { const response = await fetch('/api/business-profile', { credentials: 'include' }); setProfile(response.ok ? 'exists' : 'needed'); } catch { setProfile('needed'); }
    })();
  }, []);
  useEffect(() => { if (profile === 'needed') saveDraft({ step, businessName, answers }); }, [profile, step, businessName, answers]);

  const index = steps.indexOf(step);
  const questionSteps = steps.length - 1;
  const set = <K extends keyof OnboardingAnswers>(key: K, value: OnboardingAnswers[K]) => setAnswers((current) => ({ ...current, [key]: value }));
  function toggle(key: 'channels' | 'timeConsumers' | 'helpWanted', id: string) {
    setAnswers((current) => {
      const exclusive = exclusiveChoices[key];
      const has = current[key].includes(id);
      if (has) return { ...current, [key]: current[key].filter((item) => item !== id) };
      return { ...current, [key]: exclusive && id === exclusive ? [id] : [...current[key].filter((item) => item !== exclusive), id] };
    });
  }

  const valid: Record<Step, boolean> = {
    welcome: true,
    name: businessName.trim().length > 0,
    type: Boolean(answers.businessType) && (answers.businessType !== 'other' || answers.otherType.trim().length > 0),
    channels: answers.channels.length > 0, time: answers.timeConsumers.length > 0, help: answers.helpWanted.length > 0,
    team: Boolean(answers.teamSize), data: Boolean(answers.existingData), done: true,
  };
  const optional: Step[] = ['channels', 'time', 'help', 'team'];
  const next = () => { setError(''); setStep(steps[Math.min(steps.length - 1, index + 1)]); };
  const back = () => { setError(''); setStep(steps[Math.max(0, index - 1)]); };

  async function finish() {
    setSaving(true); setError('');
    try {
      const response = await fetch('/api/onboarding', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'guided', businessName: businessName.trim(), answers }) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) { setError(payload.error || 'Pilot could not set up your business. Please try again.'); return; }
      saveDraft(null);
      navigate(answers.existingData === 'files' || answers.existingData === 'software' ? '/setup-with-pilot?import=1' : '/dashboard', { replace: true });
    } catch { setError('Pilot could not reach the server. Check your connection and try again.'); }
    finally { setSaving(false); }
  }

  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (profile === 'exists') return <Navigate to="/dashboard" replace />;

  const heading = (title: string, subtitle?: string) => <div className="mb-6"><h1 id="question-title" className="text-[1.75rem] font-extrabold leading-tight tracking-[-0.04em] text-secondary sm:text-[2.1rem]">{title}</h1>{subtitle && <p className="mt-2 text-base text-muted-foreground">{subtitle}</p>}</div>;
  const grid = (children: React.ReactNode, columns = 'sm:grid-cols-2') => <div className={`grid gap-3 ${columns}`}>{children}</div>;
  const typeLabel = answers.businessType === 'other' ? answers.otherType.trim() : labelFor(businessTypes, answers.businessType);
  const summary = [typeLabel, labelFor(teamSizes, answers.teamSize), answers.channels.length ? `${answers.channels.length} way${answers.channels.length === 1 ? '' : 's'} customers find you` : '', answers.helpWanted.length ? `${answers.helpWanted.length} thing${answers.helpWanted.length === 1 ? '' : 's'} Pilot will help with` : ''].filter(Boolean);
  const wantsImport = answers.existingData === 'files' || answers.existingData === 'software';

  return <>
    <Helmet><title>Set up your business | Connection Pilot</title><meta name="description" content="Answer a few quick questions and Pilot will set up your workspace." /><meta name="robots" content="noindex, nofollow" /><link rel="canonical" href={`${siteUrl}/onboarding`} /></Helmet>
    <div className="flex min-h-screen flex-col bg-[linear-gradient(180deg,#0B1F44_0,#0B1F44_7.5rem,hsl(var(--canvas))_7.5rem)]">
      <header className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4 px-5 pt-6 text-white">
        <a href="/" aria-label="Connection Pilot home"><img src="/airo-assets/images/logo/horizontal" alt="Connection Pilot" width={176} height={40} className="h-9 w-auto brightness-0 invert" /></a>
        {step !== 'welcome' && <p className="text-sm font-semibold text-[#C9D8F5]" aria-live="polite">Step {index} of {questionSteps}</p>}
      </header>
      {step !== 'welcome' && <div className="mx-auto mt-4 w-full max-w-3xl px-5"><div role="progressbar" aria-label="Setup progress" aria-valuemin={0} aria-valuemax={questionSteps} aria-valuenow={index} className="h-1.5 overflow-hidden rounded-full bg-white/20"><div className="h-full rounded-full bg-[#6C98FF] transition-all duration-500" style={{ width: `${(index / questionSteps) * 100}%` }} /></div></div>}

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-5 pb-10 pt-8">
        <section aria-labelledby={step === 'welcome' || step === 'done' ? undefined : 'question-title'} className="rounded-3xl border border-border bg-card p-6 shadow-[0_24px_60px_-32px_rgba(11,31,68,0.45)] sm:p-10">
          {step === 'welcome' && <div className="text-center">
            <div className="mb-4 flex justify-center"><PilotAvatar size="lg" state="idle" /></div>
            <h1 className="text-3xl font-extrabold tracking-[-0.04em] text-secondary sm:text-4xl">Welcome to Connection Pilot 👋</h1>
            <p className="mt-3 text-xl font-bold text-primary">Let’s get to know your business.</p>
            <p className="mx-auto mt-3 max-w-md text-base text-muted-foreground">Answer a few quick questions and Pilot will use your answers to set up your workspace.</p>
            <button type="button" onClick={next} className="mt-8 inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-8 py-4 text-base font-bold text-primary-foreground shadow-sm transition hover:brightness-110">Let’s get started<ArrowRight size={18} aria-hidden="true" /></button>
          </div>}

          {step === 'name' && <>{heading('What’s your business called?', 'This is the only thing you need to type.')}
            <label className="block"><span className="sr-only">Business name</span><input autoFocus value={businessName} onChange={(event) => setBusinessName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && valid.name) next(); }} maxLength={255} placeholder="For example: Somerset Pool Service" className="w-full rounded-2xl border-2 border-border bg-background px-5 py-4 text-lg font-semibold text-secondary outline-none transition focus:border-primary focus:ring-2 focus:ring-ring" /></label></>}

          {step === 'type' && <>{heading('What type of business do you run?', 'Choose the one that fits best.')}
            <div role="radiogroup" aria-labelledby="question-title">{grid(businessTypes.map((option) => <Choice key={option.id} option={option} mode="single" selected={answers.businessType === option.id} onPick={() => set('businessType', option.id)} />), 'sm:grid-cols-2 lg:grid-cols-3')}</div>
            {answers.businessType === 'other' && <label className="mt-4 block text-sm font-bold text-secondary">What kind of business is it?<input autoFocus value={answers.otherType} onChange={(event) => set('otherType', event.target.value)} maxLength={100} className="mt-2 w-full rounded-xl border-2 border-border bg-background px-4 py-3 text-base text-secondary outline-none transition focus:border-primary focus:ring-2 focus:ring-ring" /></label>}</>}

          {step === 'channels' && <>{heading('How do you usually get new customers?', 'Choose all that apply.')}<div role="group" aria-labelledby="question-title">{grid(customerChannels.map((option) => <Choice key={option.id} option={option} mode="multi" selected={answers.channels.includes(option.id)} onPick={() => toggle('channels', option.id)} />))}</div></>}
          {step === 'time' && <>{heading('What takes up the most of your time?', 'Choose as many as you like.')}<div role="group" aria-labelledby="question-title">{grid(timeConsumers.map((option) => <Choice key={option.id} option={option} mode="multi" selected={answers.timeConsumers.includes(option.id)} onPick={() => toggle('timeConsumers', option.id)} />))}</div></>}
          {step === 'help' && <>{heading('What would you like Pilot to help with?', 'Choose all that apply.')}<div role="group" aria-labelledby="question-title">{grid(helpWanted.map((option) => <Choice key={option.id} option={option.id === voiceHelpId ? { ...option, emoji: '📞' } : option} mode="multi" selected={answers.helpWanted.includes(option.id)} onPick={() => toggle('helpWanted', option.id)} />))}</div></>}
          {step === 'team' && <>{heading('How big is your team?')}<div role="radiogroup" aria-labelledby="question-title">{grid(teamSizes.map((option) => <Choice key={option.id} option={option} mode="single" selected={answers.teamSize === option.id} onPick={() => set('teamSize', option.id)} />), 'sm:grid-cols-2 lg:grid-cols-3')}</div></>}

          {step === 'data' && <>{heading('Do you already have business information somewhere?')}
            <div role="radiogroup" aria-labelledby="question-title" className="grid gap-3">{existingData.map((option) => <Choice key={option.id} option={option} mode="single" selected={answers.existingData === option.id} onPick={() => set('existingData', option.id)} />)}</div>
            {answers.existingData === 'files' && <p className="mt-5 rounded-2xl bg-accent p-4 text-sm leading-6 text-secondary">You can upload customer lists, invoices, quotes, jobs, employees, services and other business information. Pilot will organize it for you.</p>}
            {answers.existingData === 'software' && <p className="mt-5 rounded-2xl bg-accent p-4 text-sm leading-6 text-secondary">Most business software can export your customers, invoices, quotes and jobs as an Excel or CSV file, and Pilot can import those exports and organize them for you. Direct connections to other software aren’t available during setup.</p>}</>}

          {step === 'done' && <div className="text-center">
            <div className="mb-4 flex justify-center"><PilotAvatar size="lg" state="idle" /></div>
            <h1 className="text-3xl font-extrabold tracking-[-0.04em] text-secondary sm:text-4xl">Perfect. I’ve got it.</h1>
            <p className="mx-auto mt-3 max-w-lg text-base text-muted-foreground">Pilot now has a better understanding of your business and can use what you told me to personalize your workspace.</p>
            <ul aria-label="What you told Pilot" className="mt-5 flex flex-wrap justify-center gap-2"><li className="rounded-full bg-accent px-3 py-1.5 text-sm font-bold text-primary">{businessName.trim()}</li>{summary.map((item) => <li key={item} className="rounded-full bg-muted px-3 py-1.5 text-sm font-semibold text-secondary">{item}</li>)}</ul>
            <p className="mt-6 text-lg font-bold text-secondary">Next, let’s get your business information organized.</p>
            {error && <p role="alert" className="mx-auto mt-4 max-w-md rounded-xl border border-destructive p-3 text-sm font-bold text-destructive">{error}</p>}
            <button type="button" disabled={saving} onClick={() => void finish()} className="mt-6 inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-8 py-4 text-base font-bold text-primary-foreground shadow-sm transition hover:brightness-110 disabled:opacity-60">{saving ? <><Loader2 size={18} className="animate-spin" aria-hidden="true" />Setting up…</> : wantsImport ? <><Sparkles size={18} aria-hidden="true" />Let’s organize it</> : <>Take me to my workspace<ArrowRight size={18} aria-hidden="true" /></>}</button>
            <div className="mt-4"><button type="button" disabled={saving} onClick={back} className="text-sm font-bold text-muted-foreground underline">Change an answer</button></div>
          </div>}

          {step !== 'welcome' && step !== 'done' && <div className="mt-8 flex items-center justify-between gap-3 border-t border-border pt-5">
            <button type="button" onClick={back} className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2.5 text-sm font-bold text-muted-foreground transition hover:text-primary"><ArrowLeft size={16} aria-hidden="true" />Back</button>
            <div className="flex items-center gap-3">
              {optional.includes(step) && !valid[step] && <button type="button" onClick={next} className="px-2 py-2.5 text-sm font-bold text-muted-foreground underline">Skip</button>}
              <button type="button" disabled={!valid[step]} onClick={next} className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-7 py-3.5 text-sm font-bold text-primary-foreground shadow-sm transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45">{step === 'data' && answers.existingData === 'files' ? 'Upload my information' : 'Next'}<ArrowRight size={16} aria-hidden="true" /></button>
            </div>
          </div>}
        </section>
      </main>
    </div>
  </>;
}

export default function OnboardingPage() { return <ProtectedRoute><OnboardingContent /></ProtectedRoute>; }
