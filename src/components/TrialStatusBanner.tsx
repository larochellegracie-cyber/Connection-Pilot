import { useEffect, useState } from 'react';
import { Link } from 'react-router';

type Subscription = { status: string; planName: string; trialDaysRemaining: number };

export default function TrialStatusBanner() {
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  useEffect(() => { void fetch('/api/subscription', { credentials: 'include' }).then(async (response) => response.ok ? response.json() as Promise<{ subscription: Subscription }> : null).then((payload) => setSubscription(payload?.subscription ?? null)).catch(() => undefined); }, []);
  if (!subscription || subscription.status === 'active') return null;
  const expired = subscription.status === 'trial_expired';
  return <div className="border-b border-border bg-accent px-4 py-2 text-sm text-secondary"><div className="mx-auto flex max-w-content flex-wrap items-center justify-between gap-2"><p className="font-semibold">{expired ? 'Your free trial has ended. Choose a plan to continue using plan-controlled tools.' : `${subscription.trialDaysRemaining} day${subscription.trialDaysRemaining === 1 ? '' : 's'} left in your free trial.`}</p><Link to="/subscription" className="font-extrabold text-primary underline underline-offset-4">{expired ? 'Choose a plan' : 'View plan details'}</Link></div></div>;
}
