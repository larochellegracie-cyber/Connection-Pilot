import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { getAuth } from '@/lib/auth/auth.js';
import { db } from '@/server/db/client.js';
import { businessKnowledge, businessProfile, businessSubscription } from '@/server/db/schema.js';
import { crawlBusinessWebsite } from '@/server/business-knowledge/website-crawl.js';
import { replaceWebsiteKnowledgeSources } from '@/server/business-knowledge/sources.js';

function stringValue(value: unknown, limit = 12000): string {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim())
    : [];
}

function readableFileText(value: unknown): string {
  const raw = typeof value === 'string' ? value : '';
  if (!raw.startsWith('%PDF')) return stringValue(raw, 12000);
  return (raw.match(/\((?:\\.|[^\\)])*\)/g)?.map((part) => part.slice(1, -1).replace(/\\([()\\])/g, '$1')).join(' ') || '').slice(0, 12000);
}

function normalizePhone(value: unknown): string {
  const trimmed = stringValue(value, 40);
  if (!trimmed) return '';
  const digits = trimmed.replace(/\D/g, '');
  return trimmed.startsWith('+') ? `+${digits}` : digits.length === 10 ? `+1${digits}` : `+${digits}`;
}

export default async function handler(req: Request, res: Response) {
  try {
    const auth = getAuth();
    const session = await auth.api.getSession({ headers: new Headers(req.headers as Record<string, string>) });
    if (!session?.user?.id) {
      res.status(401).json({ error: 'Please sign in before saving your business profile.' });
      return;
    }

    if (req.body.mode === 'first-time') {
      const businessName = stringValue(req.body.businessName, 255);
      const businessType = stringValue(req.body.businessType, 100);
      const location = stringValue(req.body.location, 255);
      const businessHours = stringValue(req.body.businessHours);
      const servicesOffered = stringValue(req.body.servicesOffered);
      const website = stringValue(req.body.website, 255);
      const supplementalKnowledge = readableFileText(req.body.supplementalKnowledge);
      const supplementalFileName = stringValue(req.body.supplementalFileName, 255);
      const serviceArea = stringValue(req.body.serviceArea) || location;
      const pricingInformation = stringValue(req.body.pricingInformation) || 'Not provided';
      const frequentlyAskedQuestions = stringValue(req.body.frequentlyAskedQuestions) || 'Not provided';
      const policies = stringValue(req.body.policies) || 'Not provided';
      const receptionistInstructions = stringValue(req.body.receptionistInstructions);
      let crawledWebsite: Awaited<ReturnType<typeof crawlBusinessWebsite>> | null = null;
      if (website) {
        try {
          crawledWebsite = await crawlBusinessWebsite(website);
        } catch (error) {
          res.status(400).json({ error: error instanceof Error ? error.message : 'Pilot could not read that website. Check the URL and try again.' });
          return;
        }
      }
      if (!businessName || !businessType || !location || !businessHours || !servicesOffered) {
        res.status(400).json({ error: 'Please complete each business detail to continue.' });
        return;
      }

      const existing = (await db.select().from(businessProfile).where(eq(businessProfile.userId, session.user.id)).limit(1))[0];
      if (existing) {
        res.json({ ok: true, businessProfileId: existing.id });
        return;
      }

      const profileId = randomUUID();
      await db.transaction(async (tx) => {
        await tx.insert(businessProfile).values({
          id: profileId,
          userId: session.user.id,
          businessName,
          businessType,
          phoneNumber: null,
          businessEmail: session.user.email ?? null,
          address: location,
          city: location,
          region: 'Not provided',
          postalCode: 'Not provided',
          website: website || null,
          communicationNeeds: JSON.stringify(['Business setup']),
          customerChannels: JSON.stringify([]),
          monthlyInquiryVolume: 'Not provided',
        });
        const trialStartsAt = new Date();
        const trialEndsAt = new Date(trialStartsAt); trialEndsAt.setDate(trialEndsAt.getDate() + 7);
        await tx.insert(businessSubscription).values({ id: randomUUID(), businessProfileId: profileId, planKey: 'trial', status: 'trial', trialStartsAt, trialEndsAt });
        await tx.insert(businessKnowledge).values({
          id: randomUUID(),
          businessProfileId: profileId,
          serviceArea,
          businessHours,
          servicesOffered,
          pricingInformation,
          frequentlyAskedQuestions,
          policies,
          receptionistInstructions: `${receptionistInstructions || `Business setup completed for ${businessName}.`}${supplementalKnowledge ? `\n\nAdditional uploaded source${supplementalFileName ? ` (${supplementalFileName})` : ''}: ${supplementalKnowledge}` : ''}`.slice(0, 12000),
          discloseAutomation: false,
        });
      });
      if (crawledWebsite) await replaceWebsiteKnowledgeSources(profileId, crawledWebsite.records);
      res.status(201).json({ ok: true, businessProfileId: profileId });
      return;
    }

    const businessName = stringValue(req.body.businessName, 255);
    const businessType = stringValue(req.body.businessType, 100);
    const phoneNumber = normalizePhone(req.body.phoneNumber);
    const businessEmail = stringValue(req.body.businessEmail, 255);
    const address = stringValue(req.body.address, 255);
    const city = stringValue(req.body.city, 120);
    const region = stringValue(req.body.region, 120);
    const postalCode = stringValue(req.body.postalCode, 24);
    const website = stringValue(req.body.website, 255);
    const monthlyInquiryVolume = stringValue(req.body.monthlyInquiryVolume, 20);
    const communicationNeeds = stringList(req.body.communicationNeeds);
    const customerChannels = stringList(req.body.customerChannels);
    const serviceArea = stringValue(req.body.serviceArea);
    const businessHours = stringValue(req.body.businessHours);
    const servicesOffered = stringValue(req.body.servicesOffered);
    const pricingInformation = stringValue(req.body.pricingInformation);
    const frequentlyAskedQuestions = stringValue(req.body.frequentlyAskedQuestions);
    const policies = stringValue(req.body.policies);
    const receptionistInstructions = stringValue(req.body.receptionistInstructions);
    const discloseAutomation = req.body.discloseAutomation === true || req.body.discloseAutomation === 'true' || req.body.discloseAutomation === 'on';

    if (!businessName || !businessType || !phoneNumber || !businessEmail || !address || !city || !region || !postalCode || !monthlyInquiryVolume || communicationNeeds.length === 0 || customerChannels.length === 0 || !serviceArea || !businessHours || !servicesOffered || !pricingInformation || !frequentlyAskedQuestions || !policies || !receptionistInstructions) {
      res.status(400).json({ error: 'Please complete your business details and receptionist knowledge before continuing.' });
      return;
    }
    if (!/^\+[1-9]\d{7,14}$/.test(phoneNumber)) {
      res.status(400).json({ error: 'Enter a valid international business number, including its country code.' });
      return;
    }
    if (!/^\S+@\S+\.\S+$/.test(businessEmail)) {
      res.status(400).json({ error: 'Enter a valid business email address.' });
      return;
    }
    if (website) {
      try { const parsed = new URL(website); if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Invalid protocol'); } catch { res.status(400).json({ error: 'Enter a valid website address starting with http:// or https://.' }); return; }
    }

    const profileValues = {
      businessName,
      businessType,
      phoneNumber,
      businessEmail,
      address,
      city,
      region,
      postalCode,
      website: website || null,
      communicationNeeds: JSON.stringify(communicationNeeds),
      customerChannels: JSON.stringify(customerChannels),
      monthlyInquiryVolume,
    };
    const profiles = await db.select().from(businessProfile).where(eq(businessProfile.userId, session.user.id)).limit(1);
    const phoneMatches = await db.select().from(businessProfile).where(eq(businessProfile.phoneNumber, phoneNumber)).limit(1);
    const phoneOwner = phoneMatches[0];
    if (phoneOwner && phoneOwner.userId !== session.user.id) {
      res.status(409).json({ error: 'That business phone number is already assigned to another business profile.' });
      return;
    }

    const existingProfile = profiles[0];
    const profileId = existingProfile?.id ?? randomUUID();
    if (existingProfile) {
      await db.update(businessProfile).set(profileValues).where(eq(businessProfile.id, existingProfile.id));
    } else {
      await db.insert(businessProfile).values({ id: profileId, userId: session.user.id, ...profileValues });
      const trialStartsAt = new Date();
      const trialEndsAt = new Date(trialStartsAt); trialEndsAt.setDate(trialEndsAt.getDate() + 7);
      await db.insert(businessSubscription).values({ id: randomUUID(), businessProfileId: profileId, planKey: 'trial', status: 'trial', trialStartsAt, trialEndsAt });
    }

    const knowledgeValues = { serviceArea, businessHours, servicesOffered, pricingInformation, frequentlyAskedQuestions, policies, receptionistInstructions, discloseAutomation };
    const knowledgeRows = await db.select({ id: businessKnowledge.id }).from(businessKnowledge).where(eq(businessKnowledge.businessProfileId, profileId)).limit(1);
    if (knowledgeRows[0]) {
      await db.update(businessKnowledge).set(knowledgeValues).where(eq(businessKnowledge.id, knowledgeRows[0].id));
    } else {
      await db.insert(businessKnowledge).values({ id: randomUUID(), businessProfileId: profileId, ...knowledgeValues });
    }

    res.status(201).json({ ok: true, businessProfileId: profileId });
  } catch (error) {
    res.status(500).json({ error: 'Unable to save your business profile.', message: String(error) });
  }
}
