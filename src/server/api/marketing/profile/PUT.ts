import type { Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { getAuth } from '@/lib/auth/auth.js';
import { db } from '@/server/db/client.js';
import { businessProfile, marketingProfile } from '@/server/db/schema.js';

function str(value: unknown, max = 2000): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function jsonArray(value: unknown): string {
  if (!Array.isArray(value)) return '[]';
  return JSON.stringify(
    value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

function jsonObject(value: unknown): string {
  if (value && typeof value === 'object' && !Array.isArray(value)) return JSON.stringify(value);
  return '{}';
}

function errorDetail(error: unknown): string {
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause : null;
  return (cause?.message ?? (error instanceof Error ? error.message : String(error))).slice(0, 500);
}

export default async function handler(req: Request, res: Response) {
  const requestId = req.header('x-marketing-trace') || randomUUID();
  try {
    const session = await getAuth().api.getSession({ headers: new Headers(req.headers as Record<string, string>) });
    if (!session?.user?.id) { res.status(401).json({ error: 'Please sign in.' }); return; }

    const [profile] = await db.select({ id: businessProfile.id })
      .from(businessProfile)
      .where(eq(businessProfile.userId, session.user.id))
      .limit(1);
    if (!profile) { res.status(404).json({ error: 'Business profile not found.' }); return; }

    const body = req.body as Record<string, unknown>;
    const values = {
      businessName: str(body.businessName, 255),
      businessDescription: str(body.businessDescription),
      location: str(body.location, 512),
      contactPhone: str(body.contactPhone, 80),
      contactEmail: str(body.contactEmail, 255),
      businessHours: str(body.businessHours),
      services: jsonArray(body.services),
      products: jsonArray(body.products),
      pricing: str(body.pricing),
      targetCustomers: str(body.targetCustomers),
      customerNeeds: str(body.customerNeeds),
      brandTone: str(body.brandTone, 255),
      brandDescription: str(body.brandDescription),
      brandColors: str(body.brandColors, 255),
      logoUrl: str(body.logoUrl, 2048),
      promotions: str(body.promotions),
      keySellingPoints: jsonArray(body.keySellingPoints),
      frequentlyAskedQuestions: str(body.frequentlyAskedQuestions),
      importantNotes: str(body.importantNotes),
      socialLinks: jsonObject(body.socialLinks),
      analysisStatus: 'complete' as const,
      approvalStatus: 'confirmed' as const,
      confirmedAt: new Date(),
    };

    console.info(JSON.stringify({
      event: 'marketing-profile.confirm-request',
      requestId,
      userId: session.user.id,
      businessProfileId: profile.id,
      services: JSON.parse(values.services),
      products: JSON.parse(values.products),
    }));

    await db.insert(marketingProfile).values({
      id: randomUUID(),
      businessProfileId: profile.id,
      ...values,
    }).onDuplicateKeyUpdate({ set: values });

    const [saved] = await db.select().from(marketingProfile)
      .where(eq(marketingProfile.businessProfileId, profile.id))
      .limit(1);

    if (!saved) throw new Error('The confirmed profile could not be read back after saving.');
    if (saved.services !== values.services || saved.products !== values.products || saved.approvalStatus !== 'confirmed') {
      throw new Error('The confirmed profile readback did not match the submitted services or products.');
    }

    console.info(JSON.stringify({
      event: 'marketing-profile.persistence-confirmed',
      requestId,
      userId: session.user.id,
      businessProfileId: profile.id,
      marketingProfileId: saved.id,
      approvalStatus: saved.approvalStatus,
      services: JSON.parse(saved.services ?? '[]'),
      products: JSON.parse(saved.products ?? '[]'),
    }));
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.json({ marketingProfile: saved, verified: true });
  } catch (error) {
    const detail = errorDetail(error);
    console.error(JSON.stringify({ event: 'marketing-profile.confirm-failed', requestId }));
    res.status(500).json({ error: `Unable to save Business Profile: ${detail}` });
  }
}
