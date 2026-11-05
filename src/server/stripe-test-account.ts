export const STRIPE_TEST_BUSINESS_PROFILE_ID = 'ae8c1002-9fa7-48f7-93e6-59349d07bb52';

/** With a Stripe test key, only these businesses may start checkout: the built-in test business, and any business ids the owner lists (comma separated) in STRIPE_TEST_BUSINESS_IDS. Live keys are not limited. */
export function isAuthorizedStripeTestBusiness(businessProfileId: string): boolean {
  const listed = (process.env.STRIPE_TEST_BUSINESS_IDS ?? '').split(',').map((id) => id.trim()).filter(Boolean);
  return businessProfileId === STRIPE_TEST_BUSINESS_PROFILE_ID || listed.includes(businessProfileId);
}

export function isStripeSandboxKey(secretKey: string): boolean {
  return secretKey.startsWith('sk_test_');
}
