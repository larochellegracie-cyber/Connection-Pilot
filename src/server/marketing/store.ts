import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '@/server/db/client.js';
import { businessKnowledge, businessKnowledgeSource, businessProfile, customerAppointment, customer, job, marketingGeneratedPost, marketingProfile, pilotKnowledgeFact } from '@/server/db/schema.js';
import { itemToRow, rowToItem, type ContentItem } from '@/lib/marketing-content.js';
import { cleanServiceList } from '@/lib/clean-services.js';

/** Everything here is scoped to one business. Content lives in the existing marketing_generated_post table. */
const LIST_LIMIT = 500;

export async function listContent(tenantId: string): Promise<ContentItem[]> {
  const rows = await db.select().from(marketingGeneratedPost).where(eq(marketingGeneratedPost.businessProfileId, tenantId)).orderBy(desc(marketingGeneratedPost.updatedAt)).limit(LIST_LIMIT);
  return rows.map(rowToItem);
}

export async function getContent(tenantId: string, id: string): Promise<ContentItem | null> {
  const [row] = await db.select().from(marketingGeneratedPost).where(and(eq(marketingGeneratedPost.id, id), eq(marketingGeneratedPost.businessProfileId, tenantId))).limit(1);
  return row ? rowToItem(row) : null;
}

export async function createContent(tenantId: string, item: Omit<ContentItem, 'id' | 'createdAt' | 'updatedAt'>): Promise<ContentItem> {
  const id = randomUUID();
  const now = new Date().toISOString();
  const full: ContentItem = { ...item, id, createdAt: now, updatedAt: now };
  await db.insert(marketingGeneratedPost).values({ id, businessProfileId: tenantId, marketingContentPlanId: null, ...itemToRow(full) });
  return full;
}

export async function saveContent(tenantId: string, item: ContentItem): Promise<void> {
  await db.update(marketingGeneratedPost).set(itemToRow(item)).where(and(eq(marketingGeneratedPost.id, item.id), eq(marketingGeneratedPost.businessProfileId, tenantId)));
}

export async function removeContent(tenantId: string, id: string): Promise<void> {
  await db.delete(marketingGeneratedPost).where(and(eq(marketingGeneratedPost.id, id), eq(marketingGeneratedPost.businessProfileId, tenantId)));
}

/** Job names and appointment titles with the day they were scheduled, for the last 90 days. */
export async function loadDemand(tenantId: string, now: Date): Promise<Array<{ name: string; date: Date | null }>> {
  const since = new Date(now.getTime() - 100 * 86_400_000);
  const [jobs, appointments] = await Promise.all([
    db.select({ name: job.service, scheduledAt: job.scheduledAt, createdAt: job.createdAt, status: job.status }).from(job).where(and(eq(job.businessProfileId, tenantId), gte(sql`COALESCE(${job.scheduledAt}, ${job.createdAt})`, since))).limit(5000),
    db.select({ name: customerAppointment.title, scheduledAt: customerAppointment.scheduledAt, status: customerAppointment.status }).from(customerAppointment).innerJoin(customer, eq(customerAppointment.customerId, customer.id)).where(and(eq(customer.businessProfileId, tenantId), gte(customerAppointment.scheduledAt, since))).limit(5000),
  ]);
  return [
    ...jobs.filter((row) => row.status !== 'cancelled').map((row) => ({ name: row.name, date: row.scheduledAt ?? row.createdAt })),
    ...appointments.filter((row) => row.status !== 'cancelled').map((row) => ({ name: row.name, date: row.scheduledAt })),
  ];
}

export type BrandVoice = { tone: string; description: string };

export async function getBrandVoice(tenantId: string): Promise<BrandVoice> {
  const [row] = await db.select({ tone: marketingProfile.brandTone, description: marketingProfile.brandDescription }).from(marketingProfile).where(eq(marketingProfile.businessProfileId, tenantId)).limit(1);
  return { tone: row?.tone ?? '', description: row?.description ?? '' };
}

/** Saves the brand voice on the marketing profile, creating a minimal profile (not yet confirmed) if there is none. */
export async function saveBrandVoice(tenantId: string, voice: BrandVoice): Promise<void> {
  const [existing] = await db.select({ id: marketingProfile.id }).from(marketingProfile).where(eq(marketingProfile.businessProfileId, tenantId)).limit(1);
  if (existing) { await db.update(marketingProfile).set({ brandTone: voice.tone.slice(0, 255) || null, brandDescription: voice.description || null }).where(eq(marketingProfile.id, existing.id)); return; }
  const [business] = await db.select({ name: businessProfile.businessName }).from(businessProfile).where(eq(businessProfile.id, tenantId)).limit(1);
  await db.insert(marketingProfile).values({ id: randomUUID(), businessProfileId: tenantId, businessName: business?.name ?? null, analysisStatus: 'pending', approvalStatus: 'review_required', brandTone: voice.tone.slice(0, 255) || null, brandDescription: voice.description || null });
}

/** Cached research and ideas live in the business knowledge table with a status that keeps them out of Pilot's chat knowledge. */
const CACHE_SOURCE = 'marketing_cache';
export async function readCache<T>(tenantId: string, key: string, maxAgeMs: number, now = new Date()): Promise<{ value: T; savedAt: string } | null> {
  const [row] = await db.select({ value: pilotKnowledgeFact.value, updatedAt: pilotKnowledgeFact.updatedAt }).from(pilotKnowledgeFact)
    .where(and(eq(pilotKnowledgeFact.businessProfileId, tenantId), eq(pilotKnowledgeFact.sourceType, CACHE_SOURCE), eq(pilotKnowledgeFact.normalizedKey, `marketing:${key}`))).limit(1);
  if (!row?.updatedAt || now.getTime() - new Date(row.updatedAt).getTime() > maxAgeMs) return null;
  try { return { value: JSON.parse(row.value) as T, savedAt: new Date(row.updatedAt).toISOString() }; } catch { return null; }
}
export async function writeCache(tenantId: string, key: string, value: unknown): Promise<void> {
  const normalizedKey = `marketing:${key}`;
  const [existing] = await db.select({ id: pilotKnowledgeFact.id }).from(pilotKnowledgeFact).where(and(eq(pilotKnowledgeFact.businessProfileId, tenantId), eq(pilotKnowledgeFact.normalizedKey, normalizedKey))).limit(1);
  const json = JSON.stringify(value);
  if (existing) { await db.update(pilotKnowledgeFact).set({ value: json, status: 'cached' }).where(eq(pilotKnowledgeFact.id, existing.id)); return; }
  await db.insert(pilotKnowledgeFact).values({ id: randomUUID(), businessProfileId: tenantId, kind: 'observation', subject: 'Marketing', predicate: key, value: json, unit: null, details: 'Saved so marketing research is not repeated unnecessarily.', normalizedKey, sourceType: CACHE_SOURCE, sourceReference: 'Pilot Marketing', confidence: 'explicit', status: 'cached' });
}

export type { BrandKit } from './standard-video/templates.js';

/** The business's name, colours and logo link, as saved on its marketing profile. */
export async function loadBrandKit(tenantId: string): Promise<import('./standard-video/templates.js').BrandKit> {
  const { parseBrandColors } = await import('./standard-video/templates.js');
  const [[profile], [business]] = await Promise.all([
    db.select({ name: marketingProfile.businessName, colors: marketingProfile.brandColors, logoUrl: marketingProfile.logoUrl }).from(marketingProfile).where(eq(marketingProfile.businessProfileId, tenantId)).limit(1),
    db.select({ name: businessProfile.businessName }).from(businessProfile).where(eq(businessProfile.id, tenantId)).limit(1),
  ]);
  const logoUrl = profile?.logoUrl?.trim() ?? '';
  return { name: (business?.name || profile?.name || '').trim(), ...parseBrandColors(profile?.colors), logoUrl: /^https:\/\//.test(logoUrl) ? logoUrl : null };
}

export type BusinessBrief = {
  businessName: string; businessType: string; location: string; website: string; description: string;
  services: string[]; pricing: string; targetCustomers: string; sellingPoints: string[]; promotions: string; hours: string;
  brandVoice: BrandVoice; learned: string[]; websiteNotes: string[]; setupAnswers: string[];
  /** True when there is real information about what the business offers, beyond its type. */
  hasBusinessInformation: boolean;
  confirmedProfile: boolean;
};

const parseList = (raw: string | null | undefined): string[] => { try { const value = JSON.parse(raw ?? '[]'); return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim()) : []; } catch { return []; } };
const placeholder = /^(not provided( yet)?|n\/a|none|-)?$/i;
const useful = (value: string | null | undefined) => (value && !placeholder.test(value.trim()) ? value.trim() : '');

/** What Pilot already knows about the business, gathered from the places it is already saved. */
export async function loadBusinessBrief(tenantId: string): Promise<BusinessBrief> {
  const [[business], [knowledge], [profile], facts, sources] = await Promise.all([
    db.select().from(businessProfile).where(eq(businessProfile.id, tenantId)).limit(1),
    db.select().from(businessKnowledge).where(eq(businessKnowledge.businessProfileId, tenantId)).limit(1),
    db.select().from(marketingProfile).where(eq(marketingProfile.businessProfileId, tenantId)).limit(1),
    db.select({ kind: pilotKnowledgeFact.kind, subject: pilotKnowledgeFact.subject, predicate: pilotKnowledgeFact.predicate, value: pilotKnowledgeFact.value, unit: pilotKnowledgeFact.unit, sourceType: pilotKnowledgeFact.sourceType }).from(pilotKnowledgeFact)
      .where(and(eq(pilotKnowledgeFact.businessProfileId, tenantId), eq(pilotKnowledgeFact.status, 'accepted'))).orderBy(desc(pilotKnowledgeFact.updatedAt)).limit(40),
    db.select({ sourceUrl: businessKnowledgeSource.sourceUrl, content: businessKnowledgeSource.content }).from(businessKnowledgeSource).where(eq(businessKnowledgeSource.businessProfileId, tenantId)).orderBy(desc(businessKnowledgeSource.importedAt)).limit(2),
  ]);
  // names only: a scrape can leave whole FAQ sentences in these fields, and they would end up in captions and video plans
  const services = cleanServiceList([...parseList(profile?.services), ...parseList(profile?.products), ...useful(knowledge?.servicesOffered).split(/[\n;]+/)]);
  const learned = facts.filter((fact) => fact.sourceType !== 'onboarding' && fact.sourceType !== 'marketing_cache' && ['price', 'offering', 'business_rule'].includes(fact.kind)).slice(0, 12).map((fact) => `${fact.subject} — ${fact.predicate}: ${fact.value}${fact.unit ? ` ${fact.unit}` : ''}`);
  const setupAnswers = facts.filter((fact) => fact.sourceType === 'onboarding').map((fact) => `${fact.predicate}: ${fact.value}`);
  const brief: BusinessBrief = {
    businessName: business?.businessName ?? '', businessType: business?.businessType ?? '',
    location: [useful(profile?.location), [business?.city, business?.region].filter((part) => useful(part)).join(', ')].find(Boolean) ?? '',
    website: business?.website ?? profile?.websiteUrl ?? '',
    description: useful(profile?.businessDescription), services, pricing: useful(profile?.pricing) || useful(knowledge?.pricingInformation),
    targetCustomers: useful(profile?.targetCustomers), sellingPoints: parseList(profile?.keySellingPoints).slice(0, 6), promotions: useful(profile?.promotions), hours: useful(profile?.businessHours) || useful(knowledge?.businessHours),
    brandVoice: { tone: profile?.brandTone ?? '', description: profile?.brandDescription ?? '' }, learned,
    websiteNotes: sources.map((source) => `${source.sourceUrl}: ${source.content.replace(/\s+/g, ' ').slice(0, 900)}`),
    setupAnswers, hasBusinessInformation: false, confirmedProfile: profile?.approvalStatus === 'confirmed',
  };
  brief.hasBusinessInformation = Boolean(brief.description || brief.services.length || brief.learned.length || brief.websiteNotes.length);
  return brief;
}

