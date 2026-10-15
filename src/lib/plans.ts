export type PlanName = 'trial' | 'starter' | 'growth' | 'pro';

export type PlanFeature =
  | 'customers'
  | 'leads'
  | 'orders_jobs'
  | 'scheduling'
  | 'finance'
  | 'payments'
  | 'business_knowledge'
  | 'pilot_assistant'
  | 'basic_insights'
  | 'connections'
  | 'advanced_insights'
  | 'proactive_pilot'
  | 'pilot_actions'
  | 'ai_customer_messaging'
  | 'advanced_automation'
  | 'advanced_forecasting'
  | 'advanced_pilot_actions'
  | 'ai_phone_receptionist';

export type PlanDefinition = {
  name: string;
  description: string;
  features: readonly PlanFeature[];
};

const STARTER_FEATURES = [
  'customers',
  'leads',
  'orders_jobs',
  'scheduling',
  'finance',
  'payments',
  'business_knowledge',
  'pilot_assistant',
] as const satisfies readonly PlanFeature[];

const GROWTH_FEATURES = [
  ...STARTER_FEATURES,
  'basic_insights',
  'advanced_insights',
  'proactive_pilot',
  'pilot_actions',
] as const satisfies readonly PlanFeature[];

const PRO_FEATURES = [
  ...GROWTH_FEATURES,
  'ai_customer_messaging',
  'advanced_automation',
  'advanced_forecasting',
  'advanced_pilot_actions',
] as const satisfies readonly PlanFeature[];

export const PLAN_CONFIG: Record<PlanName, PlanDefinition> = {
  trial: {
    name: '7-day free trial',
    description: 'Explore the full Connection Pilot workspace during your trial.',
    features: PRO_FEATURES,
  },
  starter: {
    name: 'Starter',
    description: 'Run your business.',
    features: STARTER_FEATURES,
  },
  growth: {
    name: 'Growth',
    description: 'Understand your business.',
    features: GROWTH_FEATURES,
  },
  pro: {
    name: 'Pro',
    description: 'Let Pilot do more of the work.',
    features: PRO_FEATURES,
  },
};

export function planFromKey(key: string | null | undefined): PlanName {
  const name = key?.split('-')[0];
  if (name === 'essential') return 'starter';
  return name && name in PLAN_CONFIG ? name as PlanName : 'trial';
}

export function isPaidSubscriptionStatus(status: string | null | undefined) {
  return status === 'active';
}
