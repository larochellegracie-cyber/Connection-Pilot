import type { Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { generateText } from 'ai';
import { getChatModel, isChatConfigured } from '@/lib/chatbot/chat-config.js';
import { getAuth } from '@/lib/auth/auth.js';
import { db } from '@/server/db/client.js';
import { businessProfile, marketingProfile } from '@/server/db/schema.js';
import { FirecrawlNotConfiguredError, isFirecrawlConfigured, MarketingRetrievalError, retrieveMarketingWebsite } from '@/server/marketing/firecrawl-retrieval.js';

const SYSTEM_PROMPT = `You are a business analyst. You will be given content retrieved directly from a business website or from publicly indexed search results.
Extract structured business information from the content. Only include information that is actually present in the content — do not invent or assume anything.
If a field cannot be determined from the content, return null for that field.

Respond with a single valid JSON object matching this exact structure:
{
  "businessName": string | null,
  "businessDescription": string | null,
  "location": string | null,
  "contactPhone": string | null,
  "contactEmail": string | null,
  "businessHours": string | null,
  "services": string[],
  "products": string[],
  "pricing": string | null,
  "targetCustomers": string | null,
  "customerNeeds": string | null,
  "brandTone": string | null,
  "brandDescription": string | null,
  "brandColors": string | null,
  "logoUrl": string | null,
  "promotions": string | null,
  "keySellingPoints": string[],
  "frequentlyAskedQuestions": string | null,
  "importantNotes": string | null,
  "socialLinks": {
    "facebook": string | null,
    "instagram": string | null,
    "twitter": string | null,
    "linkedin": string | null,
    "tiktok": string | null,
    "youtube": string | null
  }
}

Guidelines:
- businessDescription: 2–4 sentences summarizing what the business does
- brandTone: describe the communication style (e.g. "Warm and approachable", "Professional and authoritative")
- keySellingPoints: list the most compelling reasons a customer would choose this business (max 6)
- services: list individual services offered (not categories)
- products: list individual products if it's a product-based business
- pricing: a plain text summary of pricing information found, or null if none found; never return an object or array
- socialLinks: only include URLs that are explicitly present in the content
- when the source is public search, only use facts in the supplied results and do not claim they came from the business website`;

function safeJson(text: string): Record<string, unknown> {
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]) as Record<string, unknown>;
  } catch { /* fall through */ }
  return {};
}

function str(v: unknown, max = 2000): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

function strArr(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean);
}

function socialObj(v: unknown): Record<string, string | null> {
  const defaults = { facebook: null, instagram: null, twitter: null, linkedin: null, tiktok: null, youtube: null };
  if (!v || typeof v !== 'object' || Array.isArray(v)) return defaults;
  const obj = v as Record<string, unknown>;
  return {
    facebook: typeof obj.facebook === 'string' ? obj.facebook : null,
    instagram: typeof obj.instagram === 'string' ? obj.instagram : null,
    twitter: typeof obj.twitter === 'string' ? obj.twitter : null,
    linkedin: typeof obj.linkedin === 'string' ? obj.linkedin : null,
    tiktok: typeof obj.tiktok === 'string' ? obj.tiktok : null,
    youtube: typeof obj.youtube === 'string' ? obj.youtube : null,
  };
}

function databaseFailureDetail(error: unknown): string {
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause : null;
  const source = cause?.message || (error instanceof Error ? error.message : String(error));
  if (source.includes("Table 'db_") && source.includes("marketing_profile' doesn't exist")) return 'Database table marketing_profile is missing.';
  if (source.includes('ER_DUP_ENTRY')) return 'Database unique constraint rejected the marketing profile record.';
  if (source.includes('ER_NO_REFERENCED_ROW')) return 'The associated business profile could not be found.';
  if (source.includes('ER_ACCESS_DENIED_ERROR')) return 'Database permission was denied.';
  return `Database operation failed: ${source.slice(0, 500)}`;
}

export default async function handler(req: Request, res: Response) {
  const traceId = req.header('x-marketing-trace') || randomUUID();
  try {
    const session = await getAuth().api.getSession({ headers: new Headers(req.headers as Record<string, string>) });
    if (!session?.user?.id) { res.status(401).json({ error: 'Please sign in.' }); return; }

    const websiteUrl = typeof req.body?.websiteUrl === 'string' ? req.body.websiteUrl.trim() : '';
    if (!websiteUrl) { res.status(400).json({ error: 'Please provide a website URL.', stage: 'url_validation' }); return; }

    const profiles = await db.select().from(businessProfile).where(eq(businessProfile.userId, session.user.id)).limit(1);
    const profile = profiles[0];
    if (!profile) { res.status(404).json({ error: 'Business profile not found.' }); return; }

    const existingProfiles = await db.select({ id: marketingProfile.id, approvalStatus: marketingProfile.approvalStatus })
      .from(marketingProfile)
      .where(eq(marketingProfile.businessProfileId, profile.id))
      .limit(1);
    if (existingProfiles[0]?.approvalStatus === 'confirmed') {
      console.warn(JSON.stringify({ event: 'marketing-analysis', traceId, stage: 'blocked_confirmed_profile_overwrite', businessProfileId: profile.id, marketingProfileId: existingProfiles[0].id }));
      res.status(409).json({ error: 'Your confirmed Business Profile is protected from website analysis. Edit and confirm the profile directly to change its approved information.', stage: 'confirmed_profile_protected' });
      return;
    }

    console.info(JSON.stringify({ event: 'marketing-analysis', traceId, stage: 'authenticated_request', businessProfileId: profile.id, existingMarketingProfileId: existingProfiles[0]?.id ?? null }));

    // Check setup before spending a crawl: both the website reader and the analysis step need their keys.
    if (!isFirecrawlConfigured()) { const setup = new FirecrawlNotConfiguredError(); res.status(setup.status).json({ error: setup.publicMessage, stage: setup.stage, setupRequired: true }); return; }
    if (!isChatConfigured()) { res.status(503).json({ error: 'Website learning isn’t set up yet. An OpenAI API key needs to be added to this app’s settings. In the meantime you can upload your business information instead.', stage: 'openai_analysis', setupRequired: true }); return; }

    let retrieval: Awaited<ReturnType<typeof retrieveMarketingWebsite>>;
    try {
      retrieval = await retrieveMarketingWebsite(websiteUrl);
      console.info(JSON.stringify({ event: 'marketing-analysis', traceId, stage: 'retrieval_complete', source: retrieval.source, pages: retrieval.records.length }));
    } catch (error) {
      if (error instanceof MarketingRetrievalError) {
        console.error(JSON.stringify({ event: 'marketing-analysis', traceId, stage: error.stage, outcome: 'failed', detail: error.message }));
        res.status(error.status).json({ error: error.publicMessage, stage: error.stage });
        return;
      }
      console.error(JSON.stringify({ event: 'marketing-analysis', traceId, stage: 'firecrawl_retrieval', outcome: 'failed', detail: error instanceof Error ? error.message : String(error) }));
      res.status(502).json({ error: 'I could not retrieve that website. Please upload your business information instead.', stage: 'firecrawl_retrieval' });
      return;
    }

    let text: string;
    try {
      const response = await generateText({
        model: getChatModel(),
        system: SYSTEM_PROMPT,
        prompt: `Website URL: ${retrieval.website}\nRetrieval source: ${retrieval.source === 'website' ? 'Direct website retrieval' : 'Publicly indexed search results'}\n\nRetrieved content:\n${retrieval.sourceText.slice(0, 80_000)}`,
      });
      text = response.text;
      console.info(JSON.stringify({ event: 'marketing-analysis', traceId, stage: 'openai_analysis_complete', characters: text.length }));
    } catch (error) {
      console.error(JSON.stringify({ event: 'marketing-analysis', traceId, stage: 'openai_analysis', outcome: 'failed', detail: error instanceof Error ? error.message : String(error) }));
      res.status(502).json({ error: 'I retrieved the website, but could not analyse its information right now. Please try again.', stage: 'openai_analysis' });
      return;
    }

    const raw = safeJson(text);
    if (!Object.keys(raw).length || (!raw.businessName && !raw.businessDescription && !strArr(raw.services).length && !strArr(raw.products).length)) {
      console.error(JSON.stringify({ event: 'marketing-analysis', traceId, stage: 'profile_parsing', outcome: 'failed', responsePreview: text.slice(0, 500) }));
      res.status(422).json({ error: 'I found website information but could not turn it into a business profile. Please try again or upload your business information.', stage: 'profile_parsing' });
      return;
    }

    const extracted = {
      websiteUrl: retrieval.website,
      analysisStatus: 'complete' as const,
      analyzedAt: new Date(),
      approvalStatus: 'review_required' as const,
      confirmedAt: null,
      businessName: str(raw.businessName, 255) || null,
      businessDescription: str(raw.businessDescription) || null,
      location: str(raw.location, 512) || null,
      contactPhone: str(raw.contactPhone, 80) || null,
      contactEmail: str(raw.contactEmail, 255) || null,
      businessHours: str(raw.businessHours) || null,
      services: JSON.stringify(strArr(raw.services)),
      products: JSON.stringify(strArr(raw.products)),
      pricing: str(raw.pricing) || null,
      targetCustomers: str(raw.targetCustomers) || null,
      customerNeeds: str(raw.customerNeeds) || null,
      brandTone: str(raw.brandTone, 255) || null,
      brandDescription: str(raw.brandDescription) || null,
      brandColors: str(raw.brandColors, 255) || null,
      logoUrl: str(raw.logoUrl, 2048) || null,
      promotions: str(raw.promotions) || null,
      keySellingPoints: JSON.stringify(strArr(raw.keySellingPoints)),
      frequentlyAskedQuestions: str(raw.frequentlyAskedQuestions) || null,
      importantNotes: str(raw.importantNotes) || null,
      socialLinks: JSON.stringify(socialObj(raw.socialLinks)),
    };

    try {
      const existing = await db.select({ id: marketingProfile.id }).from(marketingProfile).where(eq(marketingProfile.businessProfileId, profile.id)).limit(1);
      if (existing[0]) {
        await db.update(marketingProfile).set(extracted).where(eq(marketingProfile.businessProfileId, profile.id));
      } else {
        await db.insert(marketingProfile).values({ id: randomUUID(), businessProfileId: profile.id, ...extracted });
      }
      const rows = await db.select().from(marketingProfile).where(eq(marketingProfile.businessProfileId, profile.id)).limit(1);
      console.info(JSON.stringify({ event: 'marketing-analysis', traceId, stage: 'database_save_complete', marketingProfileId: rows[0]?.id ?? null }));
      res.json({
        marketingProfile: rows[0],
        pagesAnalyzed: retrieval.records.length,
        retrievalSource: retrieval.source,
        warnings: retrieval.warnings.length > 0 ? retrieval.warnings : undefined,
      });
    } catch (error) {
      const detail = databaseFailureDetail(error);
      console.error(JSON.stringify({ event: 'marketing-analysis', traceId, stage: 'database_save', outcome: 'failed', detail }));
      res.status(500).json({ error: detail, stage: 'database_save' });
    }
  } catch (error) {
    console.error(JSON.stringify({ event: 'marketing-analysis', traceId, stage: 'unexpected', outcome: 'failed', detail: error instanceof Error ? error.message : String(error) }));
    res.status(500).json({ error: 'I could not start website learning right now. Please try again.', stage: 'unexpected' });
  }
}
