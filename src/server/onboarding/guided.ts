import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db } from '@/server/db/client.js';
import { businessKnowledge, businessProfile, businessSubscription, pilotKnowledgeFact } from '@/server/db/schema.js';
import { businessTypes, customerChannels, existingData, helpWanted, labelFor, teamSizes, timeConsumers, voiceHelpId, type Option } from '@/lib/onboarding-options.js';

export type GuidedAnswers = { businessName: string; businessType: string; businessTypeDetail: string; channels: string[]; timeConsumers: string[]; helpWanted: string[]; teamSize: string; existingData: string };

const text = (value: unknown, limit: number) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : '');

function pickMany(value: unknown, options: Option[]): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > options.length) return null;
  const ids = [...new Set(value.filter((item): item is string => typeof item === 'string'))];
  return ids.every((id) => options.some((option) => option.id === id)) ? ids.map((id) => labelFor(options, id)) : null;
}

/** Checks the answers against the question lists and turns ids into readable labels. */
export function guidedAnswersFrom(body: unknown): GuidedAnswers | { error: string } {
  const input = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  const answers = input.answers && typeof input.answers === 'object' ? input.answers as Record<string, unknown> : {};
  const businessName = text(input.businessName, 255);
  if (!businessName) return { error: 'Tell Pilot what your business is called to continue.' };
  const typeId = text(answers.businessType, 40);
  if (!businessTypes.some((option) => option.id === typeId)) return { error: 'Choose the type of business you run.' };
  const otherType = text(answers.otherType, 100);
  if (typeId === 'other' && !otherType) return { error: 'Tell Pilot what kind of business you run.' };
  const channels = pickMany(answers.channels, customerChannels);
  const consumers = pickMany(answers.timeConsumers, timeConsumers);
  const help = pickMany(answers.helpWanted, helpWanted);
  if (!channels || !consumers || !help) return { error: 'One of the answers was not recognised. Go back a step and choose again.' };
  const teamId = text(answers.teamSize, 20); const dataId = text(answers.existingData, 20);
  if (teamId && !teamSizes.some((option) => option.id === teamId)) return { error: 'Choose your team size from the list.' };
  if (dataId && !existingData.some((option) => option.id === dataId)) return { error: 'Choose one of the options for your existing information.' };
  const voice = labelFor(helpWanted, voiceHelpId);
  return {
    businessName,
    businessType: typeId === 'other' ? otherType : labelFor(businessTypes, typeId),
    businessTypeDetail: typeId === 'other' ? 'Other (typed by the owner)' : '',
    channels,
    timeConsumers: consumers,
    // The owner can say they want missed calls answered, but the feature is not active, so it is recorded as an expectation.
    helpWanted: help.map((label) => (label === voice ? `${voice} (not active yet; the owner would like it when it is available)` : label)),
    teamSize: labelFor(teamSizes, teamId),
    existingData: labelFor(existingData, dataId),
  };
}

/** One fact per answer so Pilot can search them like anything else it knows about the business. */
export function onboardingFacts(answers: GuidedAnswers) {
  const rows: Array<{ predicate: string; value: string; details?: string }> = [
    { predicate: 'business type', value: answers.businessType, details: answers.businessTypeDetail || undefined },
    { predicate: 'team size', value: answers.teamSize },
    { predicate: 'how new customers find the business', value: answers.channels.join(', ') },
    { predicate: 'what takes the most time', value: answers.timeConsumers.join(', ') },
    { predicate: 'wants Pilot to help with', value: answers.helpWanted.join(', ') },
    { predicate: 'existing business information', value: answers.existingData },
  ];
  return rows.filter((row) => row.value);
}

export const onboardingSourceType = 'onboarding';

/** Creates the business the same way first-time setup does, and keeps the owner's answers as business context. */
export async function createGuidedBusiness(session: { userId: string; email: string | null }, answers: GuidedAnswers) {
  const existing = (await db.select({ id: businessProfile.id }).from(businessProfile).where(eq(businessProfile.userId, session.userId)).limit(1))[0];
  if (existing) return { id: existing.id, created: false };
  const profileId = randomUUID();
  await db.transaction(async (tx) => {
    await tx.insert(businessProfile).values({
      id: profileId, userId: session.userId, businessName: answers.businessName, businessType: answers.businessType, phoneNumber: null, businessEmail: session.email,
      address: 'Not provided', city: 'Not provided', region: 'Not provided', postalCode: 'Not provided', website: null,
      communicationNeeds: JSON.stringify(answers.helpWanted.length ? answers.helpWanted : ['Business setup']),
      customerChannels: JSON.stringify(answers.channels),
      monthlyInquiryVolume: 'Not provided',
    });
    const trialStartsAt = new Date(); const trialEndsAt = new Date(trialStartsAt); trialEndsAt.setDate(trialEndsAt.getDate() + 7);
    await tx.insert(businessSubscription).values({ id: randomUUID(), businessProfileId: profileId, planKey: 'trial', status: 'trial', trialStartsAt, trialEndsAt });
    await tx.insert(businessKnowledge).values({
      id: randomUUID(), businessProfileId: profileId, serviceArea: 'Not provided yet', businessHours: 'Not provided yet', servicesOffered: answers.businessType,
      pricingInformation: 'Not provided', frequentlyAskedQuestions: 'Not provided', policies: 'Not provided',
      receptionistInstructions: `Business setup completed for ${answers.businessName}.`, discloseAutomation: false,
    });
    const rows = onboardingFacts(answers);
    if (rows.length) await tx.insert(pilotKnowledgeFact).values(rows.map((row) => ({
      id: randomUUID(), businessProfileId: profileId, kind: 'observation', subject: 'Business setup', predicate: row.predicate, value: row.value, unit: null, details: row.details ?? null,
      normalizedKey: `onboarding:${row.predicate}`, sourceType: onboardingSourceType, sourceReference: 'The owner answered Pilot’s setup questions', confidence: 'explicit', status: 'accepted',
    })));
  });
  return { id: profileId, created: true };
}

/** What the owner told Pilot during setup, written for Pilot to read. Empty when they skipped the questions. */
export async function onboardingContext(businessProfileId: string): Promise<string> {
  const facts = await db.select({ predicate: pilotKnowledgeFact.predicate, value: pilotKnowledgeFact.value, details: pilotKnowledgeFact.details }).from(pilotKnowledgeFact)
    .where(and(eq(pilotKnowledgeFact.businessProfileId, businessProfileId), eq(pilotKnowledgeFact.sourceType, onboardingSourceType), eq(pilotKnowledgeFact.status, 'accepted')));
  if (!facts.length) return '';
  const lines = facts.map((fact) => `- ${fact.predicate}: ${fact.value}${fact.details ? ` (${fact.details})` : ''}`);
  return `\n\nWhat the owner told Pilot when they set up their business (their own answers; use it to tailor advice and priorities, and do not present it as verified records):\n${lines.join('\n')}`;
}
