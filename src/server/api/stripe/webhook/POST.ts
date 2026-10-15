import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import Stripe from 'stripe';
import { eq } from 'drizzle-orm';
import { getSecret } from '#airo/secrets';
import { db } from '@/server/db/client.js';
import { businessSubscription, stripeWebhookEvent } from '@/server/db/schema.js';
import { businessForStripeSubscription, syncBusinessSubscription } from '@/server/stripe-subscriptions.js';
import { isAuthorizedStripeTestBusiness } from '@/server/stripe-test-account.js';

function getStripe() {
  const secretKey = getSecret('STRIPE_SECRET_KEY');
  if (typeof secretKey !== 'string' || !secretKey) throw new Error('Stripe is not configured.');
  return new Stripe(secretKey);
}

function errorClass(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError';
}

function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: string }).code === 'ER_DUP_ENTRY';
}

function subscriptionIdForEvent(event: Stripe.Event): string | null {
  const object = event.data.object as Stripe.Subscription | Stripe.Invoice;
  if (event.type.startsWith('customer.subscription.')) return (object as Stripe.Subscription).id;
  if (event.type === 'invoice.paid' || event.type === 'invoice.payment_failed') {
    const invoice = object as Stripe.Invoice;
    return typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription?.id ?? null;
  }
  return null;
}

async function alreadyProcessed(eventId: string): Promise<boolean> {
  const [existing] = await db.select({ id: stripeWebhookEvent.id })
    .from(stripeWebhookEvent)
    .where(eq(stripeWebhookEvent.stripeEventId, eventId))
    .limit(1);
  return Boolean(existing);
}

async function recordProcessedEvent(event: Stripe.Event, stripeSubscriptionId: string | null): Promise<void> {
  try {
    await db.insert(stripeWebhookEvent).values({
      id: randomUUID(),
      stripeEventId: event.id,
      eventType: event.type,
      stripeSubscriptionId,
    });
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      console.info({ route: '/api/stripe/webhook', eventId: event.id, eventType: event.type, outcome: 'duplicate-persistence' }, 'Stripe webhook event already persisted');
      return;
    }
    console.error({ route: '/api/stripe/webhook', eventId: event.id, eventType: event.type, outcome: 'persistence-failed', errorClass: errorClass(error) }, 'Stripe webhook event persistence failed');
    throw error;
  }
}

async function isResetTestSubscription(businessProfileId: string, subscription: Stripe.Subscription): Promise<boolean> {
  if (!isAuthorizedStripeTestBusiness(businessProfileId) || subscription.status !== 'canceled') return false;
  const [current] = await db.select({ stripeSubscriptionId: businessSubscription.stripeSubscriptionId, status: businessSubscription.status })
    .from(businessSubscription)
    .where(eq(businessSubscription.businessProfileId, businessProfileId))
    .limit(1);
  return current?.status === 'trial' && current.stripeSubscriptionId === null;
}

export default async function handler(req: Request, res: Response) {
  console.info({ route: '/api/stripe/webhook', outcome: 'received' }, 'Stripe webhook received');

  const signature = req.headers['stripe-signature'];
  const webhookSecret = getSecret('STRIPE_WEBHOOK_SECRET');
  if (typeof signature !== 'string' || typeof webhookSecret !== 'string' || !webhookSecret || !Buffer.isBuffer(req.body)) {
    console.warn({ route: '/api/stripe/webhook', outcome: 'missing-prerequisites' }, 'Stripe webhook request rejected');
    res.status(400).send('Invalid webhook request.');
    return;
  }

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(req.body, signature, webhookSecret);
  } catch (error) {
    console.warn({ route: '/api/stripe/webhook', outcome: 'signature-rejected', errorClass: errorClass(error) }, 'Stripe webhook signature verification failed');
    res.status(400).send('Webhook could not be verified.');
    return;
  }

  try {
    if (await alreadyProcessed(event.id)) {
      console.info({ route: '/api/stripe/webhook', eventId: event.id, eventType: event.type, outcome: 'duplicate-delivery' }, 'Stripe webhook duplicate delivery accepted');
      res.json({ received: true });
      return;
    }

    const stripe = getStripe();
    let businessProfileId: string | null = null;
    let stripeSubscriptionId: string | null = null;

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      businessProfileId = session.metadata?.businessProfileId ?? session.client_reference_id ?? null;
      stripeSubscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id ?? null;
    } else if (event.type.startsWith('customer.subscription.') || event.type === 'invoice.paid' || event.type === 'invoice.payment_failed') {
      stripeSubscriptionId = subscriptionIdForEvent(event);
    } else {
      await recordProcessedEvent(event, null);
      console.info({ route: '/api/stripe/webhook', eventId: event.id, eventType: event.type, outcome: 'processed' }, 'Stripe webhook event processed');
      res.json({ received: true });
      return;
    }

    if (!stripeSubscriptionId) throw new Error('Stripe event is missing a subscription reference.');
    const subscription = await stripe.subscriptions.retrieve(stripeSubscriptionId);
    businessProfileId = businessProfileId ?? subscription.metadata.businessProfileId ?? await businessForStripeSubscription(subscription.id);
    if (!businessProfileId) throw new Error('Stripe subscription is not linked to a Connection Pilot business.');
    if (await isResetTestSubscription(businessProfileId, subscription)) {
      await recordProcessedEvent(event, subscription.id);
      console.info({ route: '/api/stripe/webhook', eventId: event.id, eventType: event.type, outcome: 'processed' }, 'Stripe webhook event processed');
      res.json({ received: true });
      return;
    }

    await syncBusinessSubscription(businessProfileId, subscription);
    await recordProcessedEvent(event, subscription.id);
    console.info({ route: '/api/stripe/webhook', eventId: event.id, eventType: event.type, outcome: 'processed' }, 'Stripe webhook event processed');
    res.json({ received: true });
  } catch (error) {
    console.error({ route: '/api/stripe/webhook', eventId: event.id, eventType: event.type, outcome: 'processing-failed', errorClass: errorClass(error) }, 'Stripe webhook processing failed');
    res.status(500).send('Webhook processing failed.');
  }
}
