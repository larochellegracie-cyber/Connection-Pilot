import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { PLAN_CONFIG, type PlanFeature, planFromKey } from '@/lib/plans';
import { db } from '@/server/db/client.js';
import { businessProfile, businessSubscription } from '@/server/db/schema.js';

export type AccessState = {
  planKey: string;
  status: string;
  trialStartsAt: Date | null;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  stripeCustomerId: string | null;
  isTrialActive: boolean;
  isActive: boolean;
  features: readonly PlanFeature[];
};

function trialEnd(start: Date) {
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return end;
}

function accessForStatus(status: string) {
  return status === 'active' || status === 'trial' || status === 'trialing';
}

export async function subscriptionForBusiness(businessProfileId: string): Promise<AccessState> {
  const [profile] = await db.select({ createdAt: businessProfile.createdAt }).from(businessProfile).where(eq(businessProfile.id, businessProfileId)).limit(1);
  let [existing] = await db.select().from(businessSubscription).where(eq(businessSubscription.businessProfileId, businessProfileId)).limit(1);
  const start = existing?.trialStartsAt ?? profile?.createdAt ?? new Date();
  const end = existing?.trialEndsAt ?? trialEnd(start);
  const now = new Date();

  if (!existing) {
    const status = now < end ? 'trial' : 'trial_expired';
    await db.insert(businessSubscription).values({ id: randomUUID(), businessProfileId, planKey: 'trial', status, trialStartsAt: start, trialEndsAt: end });
    existing = { id: '', businessProfileId, planKey: 'trial', status, trialStartsAt: start, trialEndsAt: end } as typeof existing;
  } else if ((existing.status === 'trial' || existing.status === 'trial_expired') && (!existing.trialStartsAt || !existing.trialEndsAt || (existing.status === 'trial' && now >= end))) {
    const status = now < end ? 'trial' : 'trial_expired';
    await db.update(businessSubscription).set({ trialStartsAt: start, trialEndsAt: end, status }).where(eq(businessSubscription.id, existing.id));
    existing = { ...existing, trialStartsAt: start, trialEndsAt: end, status };
  }

  const status = existing?.status ?? (now < end ? 'trial' : 'trial_expired');
  const planKey = existing?.planKey && existing.planKey !== 'trial' ? existing.planKey : 'trial';
  const isActive = accessForStatus(status);
  const plan = PLAN_CONFIG[planFromKey(planKey)];
  return { planKey, status, trialStartsAt: start, trialEndsAt: end, currentPeriodEnd: existing?.currentPeriodEnd ?? null, cancelAtPeriodEnd: existing?.cancelAtPeriodEnd ?? false, stripeCustomerId: existing?.stripeCustomerId ?? null, isTrialActive: status === 'trial', isActive, features: isActive ? plan.features : [] };
}

export async function requirePlanFeature(businessProfileId: string, feature: PlanFeature) {
  const access = await subscriptionForBusiness(businessProfileId);
  if (!access.isActive || !access.features.includes(feature)) {
    return {
      allowed: false as const,
      error: !access.isActive ? 'Your subscription is not active. Choose a plan or update payment details to continue using this feature.' : 'This feature requires an upgraded plan.',
      access,
    };
  }
  return { allowed: true as const, access };
}
