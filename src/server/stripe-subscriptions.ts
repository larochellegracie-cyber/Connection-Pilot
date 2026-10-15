import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type Stripe from 'stripe';
import { db } from '@/server/db/client.js';
import { businessSubscription } from '@/server/db/schema.js';

export const CONNECTION_PILOT_PRICES = {
  'starter-monthly': 'price_1ULvwnAhedvpkEdkGp73i1xl',
  'growth-monthly': 'price_1ULvwnAhedvpkEdklZ6uIqTT',
  'pro-monthly': 'price_1ULvwnAhedvpkEdkLpgY5sfY',
} as const;

export type PlanKey = keyof typeof CONNECTION_PILOT_PRICES;
export const PLAN_FEATURES = {
  starter: ['customers', 'leads', 'orders_jobs', 'scheduling', 'finance', 'payments', 'business_knowledge', 'pilot_assistant'],
  growth: ['customers', 'leads', 'orders_jobs', 'scheduling', 'finance', 'payments', 'business_knowledge', 'pilot_assistant', 'basic_insights', 'advanced_insights', 'proactive_pilot', 'pilot_actions'],
  pro: ['customers', 'leads', 'orders_jobs', 'scheduling', 'finance', 'payments', 'business_knowledge', 'pilot_assistant', 'basic_insights', 'advanced_insights', 'proactive_pilot', 'pilot_actions', 'ai_customer_messaging', 'advanced_automation', 'advanced_forecasting', 'advanced_pilot_actions'],
} as const;

export function planKeyForPrice(priceId: string): PlanKey | null {
  return (Object.entries(CONNECTION_PILOT_PRICES).find(([, value]) => value === priceId)?.[0] as PlanKey | undefined) ?? null;
}

function planName(planKey: string | null): keyof typeof PLAN_FEATURES | null {
  if (!planKey) return null;
  const [rawPlan] = planKey.split('-');
  const plan = rawPlan === 'essential' ? 'starter' : rawPlan;
  return plan in PLAN_FEATURES ? plan as keyof typeof PLAN_FEATURES : null;
}

export function featuresForPlan(planKey: string | null): readonly string[] {
  const plan = planName(planKey);
  return plan ? PLAN_FEATURES[plan] : [];
}

export async function businessForStripeSubscription(stripeSubscriptionId: string): Promise<string | null> {
  const [record] = await db.select({ businessProfileId: businessSubscription.businessProfileId })
    .from(businessSubscription)
    .where(eq(businessSubscription.stripeSubscriptionId, stripeSubscriptionId))
    .limit(1);
  return record?.businessProfileId ?? null;
}

export async function syncBusinessSubscription(businessProfileId: string, subscription: Stripe.Subscription, priceId?: string) {
  const resolvedPriceId = priceId ?? subscription.items.data[0]?.price.id ?? null;
  const planKey = resolvedPriceId ? planKeyForPrice(resolvedPriceId) : null;
  if (!planKey) throw new Error('Stripe subscription does not use a configured Connection Pilot price.');

  const periodEnd = subscription.items.data[0]?.current_period_end;
  const values = {
    stripeCustomerId: typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id,
    stripeSubscriptionId: subscription.id,
    stripePriceId: resolvedPriceId,
    planKey,
    status: subscription.status,
    currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
  };
  const existing = await db.select({ id: businessSubscription.id }).from(businessSubscription).where(eq(businessSubscription.businessProfileId, businessProfileId)).limit(1);
  if (existing[0]) {
    await db.update(businessSubscription).set(values).where(eq(businessSubscription.id, existing[0].id));
    return;
  }
  await db.insert(businessSubscription).values({ id: randomUUID(), businessProfileId, ...values });
}
