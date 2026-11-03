import type { Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import { getAuth } from '@/lib/auth/auth.js';
import { db } from '@/server/db/client.js';
import { businessProfile } from '@/server/db/schema.js';
import { MarketingRetrievalError } from '@/server/marketing/firecrawl-retrieval.js';
import { describeFacts, extractWebsiteFacts } from '@/server/marketing/website-knowledge.js';
import { describeImport, importWebsiteImages } from '@/server/marketing/website-images.js';

/**
 * Reads a website with Firecrawl and returns what it found (logo, brand colours, hours, services, about, contact details). The text details are
 * not saved here: the Business information form fills itself in from this, the owner checks it, and saving the form is the confirmation.
 * The website's logo and a few real photos ARE saved, to "Photos Pilot can use" labelled "From website", where the owner can delete any of them.
 */
export default async function handler(req: Request, res: Response) {
  try {
    const session = await getAuth().api.getSession({ headers: new Headers(req.headers as Record<string, string>) });
    if (!session?.user?.id) { res.status(401).json({ error: 'Please sign in.' }); return; }
    const [profile] = await db.select({ id: businessProfile.id, name: businessProfile.businessName }).from(businessProfile).where(eq(businessProfile.userId, session.user.id)).limit(1);
    if (!profile) { res.status(404).json({ error: 'Business profile not found.' }); return; }
    const url = typeof req.body?.url === 'string' ? req.body.url.trim().slice(0, 255) : '';
    if (!url) { res.status(400).json({ error: 'Enter your website address.' }); return; }
    const facts = await extractWebsiteFacts(url);
    // the logo and a few real photos from the site go into "Photos Pilot can use", labelled "From website"
    const photos = await importWebsiteImages({ tenantId: profile.id, candidates: facts.imageCandidates, businessName: profile.name });
    const { imageCandidates: _skip, ...shown } = facts;
    res.json({ facts: shown, found: describeFacts(facts), warnings: facts.warnings, photos: { saved: photos.saved, skipped: photos.skipped, message: describeImport(photos) } });
  } catch (error) {
    if (error instanceof MarketingRetrievalError) { res.status(error.status).json({ error: error.publicMessage, stage: error.stage }); return; }
    res.status(502).json({ error: 'I could not read that website just now. Please try again, or fill in your details below.' });
  }
}
