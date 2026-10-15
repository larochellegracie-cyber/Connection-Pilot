import type { Request, Response } from 'express';
import { getSecret } from '#airo/secrets';
import { PLAN_CONFIG, planFromKey } from '@/lib/plans';
import { subscriptionForBusiness } from '@/server/plan-access.js';
import { isAuthorizedStripeTestBusiness, isStripeSandboxKey } from '@/server/stripe-test-account.js';
import { getTenant } from '../customers/tenant.js';

export default async function handler(req: Request, res: Response) {
  try {
    const tenant = await getTenant(req, res);
    if (!tenant) return;
    const subscription = await subscriptionForBusiness(tenant.id);
    const plan = PLAN_CONFIG[planFromKey(subscription.planKey)];
    const remainingMs = subscription.trialEndsAt ? Math.max(0, subscription.trialEndsAt.getTime() - Date.now()) : 0;
    res.json({ subscription: { planKey: subscription.planKey, planName: plan.name, status: subscription.status, trialStartsAt: subscription.trialStartsAt, trialEndsAt: subscription.trialEndsAt, trialDaysRemaining: Math.ceil(remainingMs / 86400000), currentPeriodEnd: subscription.currentPeriodEnd, cancelAtPeriodEnd: subscription.cancelAtPeriodEnd, hasBillingCustomer: Boolean(subscription.stripeCustomerId), canResetStripeTestBilling: isAuthorizedStripeTestBusiness(tenant.id) && isStripeSandboxKey(String(getSecret('STRIPE_SECRET_KEY') ?? '')), features: subscription.features } });
  } catch { res.status(500).json({ error: 'Unable to load subscription.' }); }
}
