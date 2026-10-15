import { FormEvent, useEffect, useState } from 'react';
import { Helmet } from '@dr.pogodin/react-helmet';
import { ArrowRight, LockKeyhole, RotateCcw, Sparkles } from 'lucide-react';
import { Navigate, useNavigate } from 'react-router';
import PilotAvatar from '@/components/PilotAvatar';
import { signIn, signUp, useSession } from '@/lib/auth/auth-client';
import { get_started } from 'virtual:content';

const siteUrl = 'https://connectionpilot.net';
const developmentTestEmail = 'test@connectionpilot.test';
const developmentTestPassword = 'PilotTest123!';
const isDevelopmentBuild = import.meta.env.DEV;
const fieldClass = 'mt-2 w-full rounded-xl border border-border bg-background px-4 py-3 text-sm text-secondary outline-none transition focus:border-primary focus:ring-2 focus:ring-ring';

export default function GetStartedPage() {
  const navigate = useNavigate();
  const { isAuthenticated } = useSession();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResettingTest, setIsResettingTest] = useState(false);

  useEffect(() => {
    if (isAuthenticated) navigate('/onboarding', { replace: true });
  }, [isAuthenticated, navigate]);

  async function createAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    if (password.length < 8) {
      setError(get_started.errors.passwordLength);
      return;
    }
    if (password !== confirmPassword) {
      setError(get_started.errors.passwordMatch);
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await signUp.email({ email, password, name: `${firstName.trim()} ${lastName.trim()}`.trim() });
      if (result.error) {
        setError(result.error.message || get_started.errors.signup);
        return;
      }
      navigate('/onboarding', { replace: true });
    } catch {
      setError(get_started.errors.generic);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function startCleanTestRun() {
    setError('');
    setIsResettingTest(true);
    try {
      const resetResponse = await fetch('/api/dev/test-account/reset', { method: 'POST', credentials: 'include' });
      const resetPayload = await resetResponse.json() as { error?: string };
      if (!resetResponse.ok) {
        setError(resetPayload.error || 'The development test account could not be reset.');
        return;
      }
      const signInResult = await signIn.email({ email: developmentTestEmail, password: developmentTestPassword });
      if (signInResult.error) {
        setError(signInResult.error.message || 'The development test account could not be signed in.');
        return;
      }
      navigate('/onboarding', { replace: true });
    } catch {
      setError('The development test account could not be reset.');
    } finally {
      setIsResettingTest(false);
    }
  }

  if (isAuthenticated) return <Navigate to="/onboarding" replace />;

  return <>
    <Helmet>
      <title>{get_started.meta.title}</title>
      <meta name="description" content={get_started.meta.description} />
      <link rel="canonical" href={`${siteUrl}/get-started`} />
      <meta property="og:title" content={get_started.meta.title} />
      <meta property="og:description" content={get_started.meta.description} />
      <meta property="og:type" content="website" />
      <meta property="og:url" content={`${siteUrl}/get-started`} />
      <meta property="og:image" content={`${siteUrl}/airo-assets/images/pages/home/hero`} />
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={get_started.meta.title} />
      <meta name="twitter:description" content={get_started.meta.description} />
      <meta name="twitter:image" content={`${siteUrl}/airo-assets/images/pages/home/hero`} />
    </Helmet>
    <main className="bg-muted py-xxl">
      <div className="mx-auto grid max-w-5xl gap-xl px-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:px-8">
        <section className="rounded-3xl bg-secondary p-xl text-secondary-foreground shadow-xl sm:p-xxl">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground"><Sparkles size={22} /></div>
          <p className="mt-xl text-sm font-bold text-primary-foreground">{get_started.hero.eyebrow}</p>
          <h1 className="mt-sm text-4xl font-extrabold tracking-[-0.05em] text-primary-foreground sm:text-5xl">{get_started.hero.title}</h1>
          <p className="mt-base max-w-lg text-lg leading-8 text-secondary-foreground">{get_started.hero.description}</p>
          <div className="mt-xl flex items-start gap-3 rounded-2xl border border-primary bg-background p-base text-secondary">
            <PilotAvatar size="md" state="speaking" />
            <p className="pt-1 text-sm font-semibold leading-6">{get_started.supporting.notice}</p>
          </div>
        </section>
        <section className="rounded-3xl border border-border bg-card p-base shadow-sm sm:p-xl">
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-accent text-primary"><LockKeyhole size={20} /></span>
            <div><h2 className="text-2xl font-extrabold tracking-[-0.03em] text-secondary">{get_started.hero.title}</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">{get_started.hero.description}</p></div>
          </div>
          <form onSubmit={createAccount} className="mt-xl grid gap-base">
            <div className="grid grid-cols-1 gap-base sm:grid-cols-2">
              <label className="text-sm font-bold text-secondary">{get_started.fields.firstName}<input required value={firstName} onChange={(event) => setFirstName(event.target.value)} placeholder={get_started.placeholders.firstName} className={fieldClass} autoComplete="given-name" /></label>
              <label className="text-sm font-bold text-secondary">{get_started.fields.lastName}<input required value={lastName} onChange={(event) => setLastName(event.target.value)} placeholder={get_started.placeholders.lastName} className={fieldClass} autoComplete="family-name" /></label>
            </div>
            <label className="text-sm font-bold text-secondary">{get_started.fields.email}<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder={get_started.placeholders.email} className={fieldClass} autoComplete="email" /></label>
            <label className="text-sm font-bold text-secondary">{get_started.fields.password}<input required type="password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={get_started.placeholders.password} className={fieldClass} autoComplete="new-password" /></label>
            <label className="text-sm font-bold text-secondary">{get_started.fields.confirmPassword}<input required type="password" minLength={8} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder={get_started.placeholders.confirmPassword} className={fieldClass} autoComplete="new-password" /></label>
            {error && <p role="alert" className="rounded-xl border border-destructive bg-card p-3 text-sm font-semibold text-destructive">{error}</p>}
            <button disabled={isSubmitting} type="submit" className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3.5 text-sm font-bold text-primary-foreground transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-60"><ArrowRight size={18} />{isSubmitting ? get_started.actions.creating : get_started.actions.submit}</button>
            <p className="text-center text-sm text-muted-foreground">{get_started.supporting.account} <a href="/login" className="font-bold text-primary hover:text-secondary">{get_started.actions.login}</a></p>
            {isDevelopmentBuild && <div className="rounded-2xl border border-border bg-muted p-4"><p className="text-sm font-extrabold text-secondary">Development test account</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Start a clean onboarding run with the reusable test account. This resets only its test workspace data.</p><button type="button" onClick={() => void startCleanTestRun()} disabled={isResettingTest} className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-primary bg-card px-4 py-3 text-sm font-bold text-primary transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"><RotateCcw size={17} />{isResettingTest ? 'Resetting test account…' : 'Start clean test run'}</button></div>}
          </form>
        </section>
      </div>
    </main>
  </>;
}
