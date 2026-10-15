import type { Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import { getAuth } from '@/lib/auth/auth.js';
import { db } from '@/server/db/client.js';
import { businessKnowledge, businessProfile } from '@/server/db/schema.js';

export default async function handler(req: Request, res: Response) {
  try {
    const session = await getAuth().api.getSession({ headers: new Headers(req.headers as Record<string, string>) });
    if (!session?.user?.id) {
      res.status(401).json({ error: 'Please sign in to view your business information.' });
      return;
    }
    const profile = (await db.select().from(businessProfile).where(eq(businessProfile.userId, session.user.id)).limit(1))[0];
    if (!profile) {
      res.status(404).json({ error: 'Business profile not found.' });
      return;
    }
    const knowledge = (await db.select().from(businessKnowledge).where(eq(businessKnowledge.businessProfileId, profile.id)).limit(1))[0];
    if (!knowledge) {
      res.status(409).json({ error: 'Business knowledge is not available until business setup is complete.' });
      return;
    }
    res.json({ profile, knowledge });
  } catch (error) {
    res.status(500).json({ error: 'Unable to load your business information.', message: String(error) });
  }
}
