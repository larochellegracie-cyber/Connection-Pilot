import { Helmet } from '@dr.pogodin/react-helmet';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Check } from 'lucide-react';
import { PLAN_CONFIG, type PlanName } from '@/lib/plans';
import { ProtectedRoute } from '@/lib/auth/auth-client';
import WorkspaceLayout from '@/layouts/WorkspaceLayout';
import { subscription } from 'virtual:content';

const priceIds = {
  starter: 'price_1ULvwnAhedvpkEdkGp73i1xl',
  growth: 'price_1ULvwnAhedvpkEdklZ6uIqTT',
  pro: 'price_1ULvwnAhedvpkEdkLpgY5sfY',
} as const;

type Subscription = { planKey: string; planName: string; status: string; trialEndsAt: string | null; trialDaysRemaining: number; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean; hasBillingCustomer: boolean; canResetStripeTestBilling: boolean; features: string[] };

function statusMessage(current: Subscription) {
  if (current.status === 'trial') return `${current.trialDaysRemaining} day${current.trialDaysRemaining === 1 ? '' : 's'} remaining in your free trial`;
  if (current.status === 'active' || current.status === 'trialing') return current.cancelAtPeriodEnd ? `${current.planName} remains active until the end of this billing period` : `${current.planName} plan is active`;
  if (current.status === 'past_due') return 'Your payment needs attention before paid features can be restored';
  if (current.status === 'canceled') return 'Your subscription has been cancelled. Your business data is still safely retained.';
  return 'Your free trial has ended. Choose a plan to continue using paid functionality.';
}

function SubscriptionContent() {
  const [current, setCurrent] = useState<Subscription | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [action, setAction] = useState<string | null>(null);

  useEffect(() => {
    void fetch('/api/subscription', { credentials: 'include' })
      .then(async (response) => {
        const payload = await response.json() as { subscription?: Subscription; error?: string };
        if (!response.ok) setError(payload.error || 'Unable to load plan details.');
        else setCurrent(payload.subscription || null);
      })
      .catch(() => setError('Unable to load plan details.'));
  }, []);

  async function choosePlan(plan: keyof typeof priceIds) {
    setAction(plan);
    setError('');
    try {
      const response = await fetch('/api/stripe/create-checkout-session', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ priceId: priceIds[plan] }) });
      const payload = await response.json() as { url?: string; error?: string };
      if (response.ok && payload.url) window.location.assign(payload.url);
      else setError(payload.error || 'Unable to start secure checkout. Please try again.');
    } catch {
      setError('Unable to start secure checkout. Please try again.');
    } finally {
      setAction(null);
    }
  }

  async function manageBilling() {
    setAction('manage');
    setError('');
    try {
      const response = await fetch('/api/stripe/customer-portal', { method: 'POST', credentials: 'include' });
      const payload = await response.json() as { url?: string; error?: string };
      if (response.ok && payload.url) window.location.assign(payload.url);
      else setError(payload.error || 'Unable to open billing management right now.');
    } catch {
      setError('Unable to open billing management right now.');
    } finally {
      setAction(null);
    }
  }

  async function resetStripeTestBilling() {
    if (!window.confirm(subscription.testBilling.confirm)) return;
    setAction('reset-test-billing');
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/stripe/test-reset', { method: 'POST', credentials: 'include' });
      const payload = await response.json() as { error?: string };
      if (!response.ok) {
        setError(payload.error || 'Unable to reset test billing.');
        return;
      }
      const refreshed = await fetch('/api/subscription', { credentials: 'include' });
      const refreshedPayload = await refreshed.json() as { subscription?: Subscription; error?: string };
      if (!refreshed.ok || !refreshedPayload.subscription) {
        setError(refreshedPayload.error || 'Test billing was reset, but the plan details could not be refreshed.');
        return;
      }
      setCurrent(refreshedPayload.subscription);
      setNotice(subscription.testBilling.success);
    } catch {
      setError('Unable to reset test billing.');
    } finally {
      setAction(null);
    }
  }

  const plans = (Object.entries(PLAN_CONFIG) as [PlanName, typeof PLAN_CONFIG[PlanName]][]).filter(([key]) => key !== 'trial');

  return <WorkspaceLayout><main>
    <section className="rounded-3xl border border-border bg-card p-base sm:p-xl"><p className="text-sm font-bold text-primary">{subscription.hero.eyebrow}</p><h1 className="mt-1 text-3xl font-extrabold text-secondary">{subscription.hero.title}</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{subscription.hero.description}</p>{current && <div className="mt-base rounded-2xl bg-accent p-base"><p className="font-extrabold text-secondary">{statusMessage(current)}</p>{current.trialEndsAt && current.status === 'trial' && <p className="mt-1 text-sm text-muted-foreground">Trial end date: {new Date(current.trialEndsAt).toLocaleDateString('en-CA', { month: 'long', day: 'numeric', year: 'numeric' })}</p>}{current.currentPeriodEnd && current.status === 'active' && <p className="mt-1 text-sm text-muted-foreground">Current billing period ends: {new Date(current.currentPeriodEnd).toLocaleDateString('en-CA', { month: 'long', day: 'numeric', year: 'numeric' })}</p>}{current.hasBillingCustomer && <button type="button" onClick={() => void manageBilling()} disabled={action === 'manage'} className="mt-base inline-flex rounded-full border border-primary bg-card px-4 py-2 text-sm font-bold text-primary disabled:cursor-not-allowed disabled:opacity-60">{action === 'manage' ? 'Opening billing...' : subscription.actions.manage}</button>}</div>}{current?.canResetStripeTestBilling && <aside className="mt-base rounded-2xl border border-primary bg-muted p-base"><h2 className="font-extrabold text-secondary">{subscription.testBilling.title}</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">{subscription.testBilling.description}</p><button type="button" onClick={() => void resetStripeTestBilling()} disabled={action !== null} className="mt-base inline-flex rounded-full border border-primary bg-card px-4 py-2 text-sm font-bold text-primary disabled:cursor-not-allowed disabled:opacity-60">{action === 'reset-test-billing' ? subscription.testBilling.resetting : subscription.testBilling.reset}</button></aside>}{notice && <p role="status" className="mt-base text-sm font-bold text-primary">{notice}</p>}{error && <p role="alert" className="mt-base text-sm font-bold text-destructive">{error}</p>}</section>
    <section className="mt-xl grid grid-cols-1 gap-base lg:grid-cols-3">{plans.map(([key, plan]) => <article key={key} className="flex flex-col rounded-2xl border border-border bg-card p-base"><h2 className="text-xl font-extrabold text-secondary">{plan.name}</h2><p className="mt-2 min-h-12 text-sm leading-6 text-muted-foreground">{plan.description}</p><ul className="mt-base grid gap-2 text-sm text-secondary">{plan.features.map((feature) => <li key={feature} className="flex items-start gap-2"><Check className="mt-0.5 shrink-0 text-primary" size={16} />{feature.replaceAll('_', ' ')}</li>)}</ul><button type="button" onClick={() => void choosePlan(key as keyof typeof priceIds)} disabled={action !== null || current?.hasBillingCustomer === true} className="mt-base w-full rounded-full bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60">{action === key ? 'Starting secure checkout...' : current?.hasBillingCustomer ? 'Manage billing above' : subscription.actions.choose}</button></article>)}</section>
    <Link to="/dashboard" className="mt-xl inline-flex rounded-full border border-border px-5 py-3 text-sm font-bold text-secondary">{subscription.actions.back}</Link>
  </main></WorkspaceLayout>;
}

export default function SubscriptionPage() { return <><Helmet><title>{subscription.seo.title}</title><meta name="description" content={subscription.seo.description} /><meta name="robots" content="noindex,nofollow" /></Helmet><ProtectedRoute><SubscriptionContent /></ProtectedRoute></>; }
