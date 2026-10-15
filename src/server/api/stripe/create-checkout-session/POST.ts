/**
 * Stripe Checkout Session API
 *
 * Creates a Stripe Checkout session for one-time payments or subscriptions.
 * Automatically determines mode based on price type (recurring vs one-time).
 *
 * Security: Redirect URLs are derived from request origin - NOT accepted from frontend.
 *
 * Usage:
 *   POST /api/stripe/create-checkout-session
 *   Body: { priceId, quantity? } or { lineItems }
 */
import type { Request, Response } from 'express';
import Stripe from 'stripe';
import { getSecret } from '#airo/secrets';
import { CONNECTION_PILOT_PRICES, planKeyForPrice } from '@/server/stripe-subscriptions.js';
import { subscriptionForBusiness } from '@/server/plan-access.js';
import { isAuthorizedStripeTestBusiness, isStripeSandboxKey } from '@/server/stripe-test-account.js';
import { getTenant } from '../../customers/tenant.js';

function getStripe(): Stripe {
  const secretKey = getSecret('STRIPE_SECRET_KEY');
  if (!secretKey || typeof secretKey !== 'string') {
    throw new Error('STRIPE_SECRET_KEY not provisioned. Re-run Stripe setup or contact support.');
  }
  return new Stripe(secretKey);
}

interface LineItem {
  priceId: string;
  quantity: number;
}

interface CreateCheckoutSessionRequest {
  priceId?: string; // For single item checkout
  lineItems?: LineItem[]; // For cart checkout
  quantity?: number;
  // Note: successUrl/cancelUrl NOT accepted - derived from request origin (security)
}

export default async function handler(req: Request, res: Response) {
  try {
    const tenant = await getTenant(req, res);
    if (!tenant) return;
    const { priceId, quantity = 1 } = req.body as CreateCheckoutSessionRequest;
    const planKey = priceId ? planKeyForPrice(priceId) : null;
    const currentSubscription = await subscriptionForBusiness(tenant.id);
    const stripe = getStripe();

    if (isStripeSandboxKey(String(getSecret('STRIPE_SECRET_KEY') ?? '')) && !isAuthorizedStripeTestBusiness(tenant.id)) {
      res.status(403).json({ success: false, error: 'Subscription checkout is currently in supervised testing.' });
      return;
    }
    if (currentSubscription.stripeCustomerId) {
      res.status(409).json({ success: false, error: 'Manage an existing subscription from the billing portal.' });
      return;
    }
    if (!priceId || !planKey || !Object.values(CONNECTION_PILOT_PRICES).includes(priceId as typeof CONNECTION_PILOT_PRICES[keyof typeof CONNECTION_PILOT_PRICES])) {
      res.status(400).json({ success: false, error: 'Choose a valid Connection Pilot subscription plan.' });
      return;
    }
    if (quantity !== 1) {
      res.status(400).json({ success: false, error: 'Subscriptions can only be purchased one at a time.' });
      return;
    }

    const origin = req.headers.origin || `https://${req.headers.host}`;
    const session = await stripe.checkout.sessions.create({
      line_items: [{ price: priceId, quantity: 1 }],
      mode: 'subscription',
      success_url: `${origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/pricing`,
      billing_address_collection: 'required',
      phone_number_collection: { enabled: true },
      client_reference_id: tenant.id,
      metadata: { businessProfileId: tenant.id, planKey },
      subscription_data: { metadata: { businessProfileId: tenant.id, planKey } },
    });

    res.json({ success: true, url: session.url, sessionId: session.id, mode: 'subscription' });
  } catch (error) {
    // Log the real error server-side for debugging; never echo internal detail
    // (missing-key messages, Stripe account state) back to the shopper, who
    // sees this string rendered as the checkout error.
    console.error('create-checkout-session failed:', error);

    if (error instanceof Stripe.errors.StripeError) {
      res.status(error.statusCode || 500).json({
        success: false,
        error: 'Unable to start checkout. Please try again or contact support.',
        code: error.code,
      });
      return;
    }

    res.status(500).json({
      success: false,
      error: 'Unable to start checkout. Please try again or contact support.',
    });
  }
}

