import type { Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import { getAuth } from '@/lib/auth/auth.js';
import { db } from '@/server/db/client.js';
import { businessProfile } from '@/server/db/schema.js';

export async function getTenant(req: Request, res: Response) {
  const auth = getAuth();
  const activeSession = await auth.api.getSession({ headers: new Headers(req.headers as Record<string, string>) });
  if (!activeSession?.user?.id) {
    res.status(401).json({ error: 'Please sign in to access customer records.' });
    return null;
  }

  const profiles = await db.select({ id: businessProfile.id, businessName: businessProfile.businessName, businessType: businessProfile.businessType }).from(businessProfile).where(eq(businessProfile.userId, activeSession.user.id)).limit(1);
  const profile = profiles[0];
  if (!profile) {
    res.status(403).json({ error: 'Complete your business setup before managing customers.' });
    return null;
  }

  return profile;
}

export function textValue(value: unknown, maxLength = 255): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

export function normalizePhone(value: string): string {
  return value.replace(/[^0-9+]/g, '');
}
