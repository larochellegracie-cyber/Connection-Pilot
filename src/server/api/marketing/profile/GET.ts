import type { Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import { getAuth } from '@/lib/auth/auth.js';
import { db } from '@/server/db/client.js';
import { businessProfile, marketingProfile } from '@/server/db/schema.js';

export default async function handler(req: Request, res: Response) {
  const requestId = req.header('x-marketing-trace') || 'untraced';
  try {
    const session = await getAuth().api.getSession({ headers: new Headers(req.headers as Record<string, string>) });
    if (!session?.user?.id) { res.status(401).json({ error: 'Please sign in.' }); return; }

    const [profile] = await db.select({ id: businessProfile.id })
      .from(businessProfile)
      .where(eq(businessProfile.userId, session.user.id))
      .limit(1);
    if (!profile) { res.status(404).json({ error: 'Business profile not found.' }); return; }

    const [saved] = await db.select().from(marketingProfile)
      .where(eq(marketingProfile.businessProfileId, profile.id))
      .limit(1);
    if (!saved) { res.status(404).json({ error: 'No marketing profile yet.' }); return; }

    console.info(JSON.stringify({
      event: 'marketing-profile.read',
      requestId,
      userId: session.user.id,
      businessProfileId: profile.id,
      marketingProfileId: saved.id,
      source: 'marketing_profile',
      approvalStatus: saved.approvalStatus,
      services: JSON.parse(saved.services ?? '[]'),
      products: JSON.parse(saved.products ?? '[]'),
    }));
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.json({ marketingProfile: saved });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: `Unable to load marketing profile: ${detail.slice(0, 500)}` });
  }
}
