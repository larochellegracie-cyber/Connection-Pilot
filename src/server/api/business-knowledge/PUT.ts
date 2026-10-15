import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { getAuth } from '@/lib/auth/auth.js';
import { db } from '@/server/db/client.js';
import { businessKnowledge, businessProfile } from '@/server/db/schema.js';
import { crawlBusinessWebsite } from '@/server/business-knowledge/website-crawl.js';
import { replaceWebsiteKnowledgeSources } from '@/server/business-knowledge/sources.js';

function value(input: unknown, limit = 12000): string {
  return typeof input === 'string' ? input.trim().slice(0, limit) : '';
}

export default async function handler(req: Request, res: Response) {
  const requestId = randomUUID();
  try {
    const session = await getAuth().api.getSession({ headers: new Headers(req.headers as Record<string, string>) });
    if (!session?.user?.id) {
      res.status(401).json({ error: 'Please sign in before saving business information.' });
      return;
    }
    const profile = (await db.select().from(businessProfile).where(eq(businessProfile.userId, session.user.id)).limit(1))[0];
    if (!profile) {
      res.status(404).json({ error: 'Business profile not found.' });
      return;
    }
    const businessName = value(req.body?.businessName, 255);
    const businessType = value(req.body?.businessType, 100);
    const address = value(req.body?.address, 255);
    const city = value(req.body?.city, 120);
    const region = value(req.body?.region, 120);
    const postalCode = value(req.body?.postalCode, 24);
    const businessEmail = value(req.body?.businessEmail, 255);
    const website = value(req.body?.website, 255);
    const websiteImportUrl = value(req.body?.websiteImportUrl, 255);
    const serviceArea = value(req.body?.serviceArea);
    const businessHours = value(req.body?.businessHours);
    const servicesOffered = value(req.body?.servicesOffered);
    const pricingInformation = value(req.body?.pricingInformation);
    const frequentlyAskedQuestions = value(req.body?.frequentlyAskedQuestions);
    const policies = value(req.body?.policies);
    const receptionistInstructions = value(req.body?.receptionistInstructions);
    const discloseAutomation = Boolean(req.body?.discloseAutomation);
    if (!businessName || !businessType || !address || !city || !region || !postalCode || !serviceArea || !businessHours || !servicesOffered) {
      res.status(400).json({ error: 'Add your business name, type, location, hours, service area, and products or services before saving.' });
      return;
    }
    if (businessEmail && !/^\S+@\S+\.\S+$/.test(businessEmail)) {
      res.status(400).json({ error: 'Enter a valid business email address.' });
      return;
    }
    const importUrl = websiteImportUrl || (website !== (profile.website ?? '') ? website : '');
    let crawledWebsite: Awaited<ReturnType<typeof crawlBusinessWebsite>> | null = null;
    if (website) {
      try {
        const parsed = new URL(website);
        if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Unsupported protocol');
        if (importUrl) {
          console.info(JSON.stringify({ event: 'business-website-import', requestId, stage: 'crawl', businessProfileId: profile.id, url: importUrl }));
          crawledWebsite = await crawlBusinessWebsite(importUrl);
          console.info(JSON.stringify({ event: 'business-website-import', requestId, stage: 'crawl-complete', businessProfileId: profile.id, pages: crawledWebsite.records.length }));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Pilot could not read that website. Check the URL and try again.';
        console.error(JSON.stringify({ event: 'business-website-import', requestId, stage: 'crawl', businessProfileId: profile.id, error: message }));
        res.status(400).json({ error: message, requestId });
        return;
      }
    }
    await db.transaction(async (tx) => {
      await tx.update(businessProfile).set({ businessName, businessType, address, city, region, postalCode, businessEmail: businessEmail || null, website: website || null }).where(eq(businessProfile.id, profile.id));
      await tx.update(businessKnowledge).set({ serviceArea, businessHours, servicesOffered, pricingInformation, frequentlyAskedQuestions, policies, receptionistInstructions, discloseAutomation }).where(eq(businessKnowledge.businessProfileId, profile.id));
    });
    if (crawledWebsite) {
      try {
        console.info(JSON.stringify({ event: 'business-website-import', requestId, stage: 'database-save', businessProfileId: profile.id, pages: crawledWebsite.records.length }));
        await replaceWebsiteKnowledgeSources(profile.id, crawledWebsite.records);
        console.info(JSON.stringify({ event: 'business-website-import', requestId, stage: 'database-save-complete', businessProfileId: profile.id, pages: crawledWebsite.records.length }));
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown database error';
        console.error(JSON.stringify({ event: 'business-website-import', requestId, stage: 'database-save', businessProfileId: profile.id, error: message }));
        res.status(500).json({ error: 'Your business information was saved, but the website pages could not be saved. Please try Save again to retry the website import.', requestId });
        return;
      }
    }
    res.json({ ok: true, importedPages: crawledWebsite?.pages ?? [], requestId });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(JSON.stringify({ event: 'business-website-import', requestId, stage: 'profile-save', error: message }));
    res.status(500).json({ error: 'Unable to save your business information. Please try again.', requestId });
  }
}
