import type { Request, Response } from 'express';
import Stripe from 'stripe';
import { eq } from 'drizzle-orm';
import { getSecret } from '#airo/secrets';
import { db } from '@/server/db/client.js';
import { businessSubscription } from '@/server/db/schema.js';
import { getTenant } from '../../customers/tenant.js';

function getStripe(): Stripe {
  const secretKey = getSecret('STRIPE_SECRET_KEY');
  if (typeof secretKey !== 'string' || !secretKey) throw new Error('Stripe is not configured.');
  return new Stripe(secretKey);
}

export default async function handler(req: Request, res: Response) {
  try {
    const tenant = await getTenant(req, res);
    if (!tenant) return;

    const [subscription] = await db.select({ stripeCustomerId: businessSubscription.stripeCustomerId })
      .from(businessSubscription)
      .where(eq(businessSubscription.businessProfileId, tenant.id))
      .limit(1);

    if (!subscription?.stripeCustomerId) {
      res.status(400).json({ error: 'Choose a plan before managing billing.' });
      return;
    }

    const origin = req.headers.origin || `https://${req.headers.host}`;
    const session = await getStripe().billingPortal.sessions.create({
      customer: subscription.stripeCustomerId,
      return_url: `${origin}/subscription`,
    });
    res.json({ url: session.url });
  } catch (error) {
    console.error('create-customer-portal-session failed:', error);
    res.status(500).json({ error: 'Unable to open billing management right now. Please try again.' });
  }
}
