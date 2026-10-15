import { eq } from 'drizzle-orm';
import { getAuth } from '@/lib/auth/auth.js';
import { db } from '@/server/db/client.js';
import { businessProfile, user } from '@/server/db/schema.js';

const TEST_EMAIL = 'test@connectionpilot.test';
const TEST_PASSWORD = 'PilotTest123!';

function developmentPreviewOnly(): boolean {
  return process.env.AIRO_PREVIEW === 'true' && process.env.NODE_ENV !== 'production';
}

export default async function handler(_req: Request, res: Response) {
  if (!developmentPreviewOnly()) {
    res.status(404).json({ error: 'Not found.' });
    return;
  }

  try {
    let testUser = (await db.select({ id: user.id }).from(user).where(eq(user.email, TEST_EMAIL)).limit(1))[0];
    if (!testUser) {
      const result = await getAuth().api.signUpEmail({
        body: { email: TEST_EMAIL, password: TEST_PASSWORD, name: 'Connection Pilot Test' },
      });
      if (!result.user?.id) {
        res.status(500).json({ error: 'Unable to create the development test account.' });
        return;
      }
      testUser = { id: result.user.id };
    }

    // The profile is the tenant root. Its database cascades clear its Business
    // Knowledge, customers, scheduling, finance, communications, and related data.
    await db.delete(businessProfile).where(eq(businessProfile.userId, testUser.id));

    res.json({ ok: true, email: TEST_EMAIL, onboardingPath: '/onboarding' });
  } catch (error) {
    res.status(500).json({ error: 'Unable to reset the development test account.', message: String(error) });
  }
}
