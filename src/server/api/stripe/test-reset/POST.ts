import type { Request, Response } from 'express';
import Stripe from 'stripe';
import { eq } from 'drizzle-orm';
import { getSecret } from '#airo/secrets';
import { db } from '@/server/db/client.js';
import { businessSubscription } from '@/server/db/schema.js';
import { getTenant } from '../../customers/tenant.js';
import { isAuthorizedStripeTestBusiness, isStripeSandboxKey } from '@/server/stripe-test-account.js';

function getStripe(): Stripe {
  const secretKey = getSecret('STRIPE_SECRET_KEY');
  if (typeof secretKey !== 'string' || !secretKey) throw new Error('Stripe is not configured.');
  return new Stripe(secretKey);
}

export default async function handler(req: Request, res: Response) {
  try {
    const tenant = await getTenant(req, res);
    if (!tenant) return;
    if (!isAuthorizedStripeTestBusiness(tenant.id) || !isStripeSandboxKey(String(getSecret('STRIPE_SECRET_KEY') ?? ''))) {
      res.status(404).json({ error: 'Not found.' });
      return;
    }

    const [current] = await db.select({ id: businessSubscription.id, stripeSubscriptionId: businessSubscription.stripeSubscriptionId })
      .from(businessSubscription)
      .where(eq(businessSubscription.businessProfileId, tenant.id))
      .limit(1);

    if (current?.stripeSubscriptionId) {
      await getStripe().subscriptions.cancel(current.stripeSubscriptionId);
    }

    const trialStartsAt = new Date();
    const trialEndsAt = new Date(trialStartsAt);
    trialEndsAt.setDate(trialEndsAt.getDate() + 7);
    const resetValues = {
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      stripePriceId: null,
      planKey: 'trial',
      status: 'trial',
      trialStartsAt,
      trialEndsAt,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
    };

    if (current) {
      await db.update(businessSubscription).set(resetValues).where(eq(businessSubscription.id, current.id));
    } else {
      await db.insert(businessSubscription).values({ id: randomUUID(), businessProfileId: tenant.id, ...resetValues });
    }

    res.json({ ok: true, status: 'trial', trialEndsAt });
  } catch (error) {
    console.error('stripe-test-reset failed:', error);
    res.status(500).json({ error: 'Unable to reset the controlled Stripe test account.' });
  }
}
