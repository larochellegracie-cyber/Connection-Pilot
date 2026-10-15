export const STRIPE_TEST_BUSINESS_PROFILE_ID = 'ae8c1002-9fa7-48f7-93e6-59349d07bb52';

export function isAuthorizedStripeTestBusiness(businessProfileId: string): boolean {
  return businessProfileId === STRIPE_TEST_BUSINESS_PROFILE_ID;
}

export function isStripeSandboxKey(secretKey: string): boolean {
  return secretKey.startsWith('sk_test_');
}
