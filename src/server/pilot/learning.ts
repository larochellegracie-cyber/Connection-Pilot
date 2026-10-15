import { and, desc, eq, like, or } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '@/server/db/client.js';
import { job, pilotKnowledgeFact } from '@/server/db/schema.js';
import { learningSearchTerms } from '@/server/pilot/learning-search.js';

export const pilotFactKinds = ['offering', 'price', 'resource_requirement', 'supplier_relationship', 'business_rule', 'process', 'observation'] as const;
export type PilotFactKind = (typeof pilotFactKinds)[number];
export type PilotFactInput = {
  kind: PilotFactKind;
  subject: string;
  predicate: string;
  value: string;
  unit?: string;
  details?: string;
  evidence: string;
};

type StoredFact = typeof pilotKnowledgeFact.$inferSelect;

function text(value: string | undefined, limit: number) {
  return (value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function normalized(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function factKey(fact: Pick<PilotFactInput, 'kind' | 'subject' | 'predicate'>) {
  return `${fact.kind}:${normalized(fact.subject)}:${normalized(fact.predicate)}`.slice(0, 500);
}

function preparedFact(fact: PilotFactInput): PilotFactInput | null {
  const subject = text(fact.subject, 255);
  const predicate = text(fact.predicate, 100);
  const value = text(fact.value, 4000);
  const evidence = text(fact.evidence, 1000);
  if (!pilotFactKinds.includes(fact.kind) || !subject || !predicate || !value || !evidence) return null;
  return { ...fact, subject, predicate, value, evidence, unit: text(fact.unit, 120) || undefined, details: text(fact.details, 6000) || undefined };
}

function view(fact: StoredFact) {
  return {
    id: fact.id,
    kind: fact.kind,
    subject: fact.subject,
    predicate: fact.predicate,
    value: fact.value,
    unit: fact.unit,
    details: fact.details,
    sourceType: fact.sourceType,
    sourceReference: fact.sourceReference,
    confidence: fact.confidence,
    status: fact.status,
    learnedAt: fact.createdAt,
  };
}

export async function learnFromOwnerMessage(businessProfileId: string, message: string, facts: PilotFactInput[]) {
  const sourceReference = text(message, 3000);
  const results: { saved: ReturnType<typeof view>[]; duplicates: ReturnType<typeof view>[]; conflicts: ReturnType<typeof view>[]; rejected: number } = { saved: [], duplicates: [], conflicts: [], rejected: 0 };
  for (const candidate of facts.slice(0, 12)) {
    const fact = preparedFact(candidate);
    if (!fact) {
      results.rejected += 1;
      continue;
    }
    const normalizedKey = factKey(fact);
    const [existing] = await db.select().from(pilotKnowledgeFact)
      .where(and(eq(pilotKnowledgeFact.businessProfileId, businessProfileId), eq(pilotKnowledgeFact.normalizedKey, normalizedKey))).limit(1);
    if (existing) {
      if (normalized(existing.value) === normalized(fact.value) && normalized(existing.unit ?? '') === normalized(fact.unit ?? '')) results.duplicates.push(view(existing));
      else results.conflicts.push(view(existing));
      continue;
    }
    const important = fact.kind === 'price' || fact.kind === 'business_rule';
    const status = important && !/\b(we|our|i|my)\b/i.test(sourceReference) ? 'pending_review' : 'accepted';
    const id = randomUUID();
    await db.insert(pilotKnowledgeFact).values({
      id,
      businessProfileId,
      kind: fact.kind,
      subject: fact.subject,
      predicate: fact.predicate,
      value: fact.value,
      unit: fact.unit ?? null,
      details: fact.details ?? null,
      normalizedKey,
      sourceType: 'owner_message',
      sourceReference: sourceReference || fact.evidence,
      confidence: 'explicit',
      status,
    });
    const [saved] = await db.select().from(pilotKnowledgeFact).where(eq(pilotKnowledgeFact.id, id)).limit(1);
    if (saved) results.saved.push(view(saved));
  }
  return results;
}

export async function searchPilotLearning(businessProfileId: string, query: string) {
  const terms = learningSearchTerms(query);
  const condition = terms.length
    ? or(...terms.flatMap((term) => [
      like(pilotKnowledgeFact.kind, `%${term}%`),
      like(pilotKnowledgeFact.subject, `%${term}%`),
      like(pilotKnowledgeFact.predicate, `%${term}%`),
      like(pilotKnowledgeFact.value, `%${term}%`),
      like(pilotKnowledgeFact.details, `%${term}%`),
      like(pilotKnowledgeFact.normalizedKey, `%${term}%`),
    ]))
    : undefined;
  const facts = await db.select().from(pilotKnowledgeFact)
    .where(condition ? and(eq(pilotKnowledgeFact.businessProfileId, businessProfileId), eq(pilotKnowledgeFact.status, 'accepted'), condition) : and(eq(pilotKnowledgeFact.businessProfileId, businessProfileId), eq(pilotKnowledgeFact.status, 'accepted')))
    .orderBy(desc(pilotKnowledgeFact.updatedAt)).limit(30);
  return facts.map(view);
}


export async function recentlyLearnedPilotFacts(businessProfileId: string) {
  const facts = await db.select().from(pilotKnowledgeFact)
    .where(and(eq(pilotKnowledgeFact.businessProfileId, businessProfileId), eq(pilotKnowledgeFact.status, 'accepted')))
    .orderBy(desc(pilotKnowledgeFact.updatedAt)).limit(12);
  return facts.map(view);
}
export async function pilotLearningSummary(businessProfileId: string) {
  const facts = await db.select().from(pilotKnowledgeFact)
    .where(eq(pilotKnowledgeFact.businessProfileId, businessProfileId)).orderBy(desc(pilotKnowledgeFact.updatedAt)).limit(100);
  const accepted = facts.filter((fact) => fact.status === 'accepted');
  return {
    learnedFacts: accepted.length,
    pendingReview: facts.filter((fact) => fact.status === 'pending_review').length,
    conflicts: facts.filter((fact) => fact.status === 'conflict').length,
    byKind: Object.fromEntries(pilotFactKinds.map((kind) => [kind, accepted.filter((fact) => fact.kind === kind).length])),
    message: 'Saved learning is business knowledge, not verified inventory, purchasing, pricing changes, or business actions.',
  };
}


export async function structuredActivityObservations(businessProfileId: string) {
  const records = await db.select({ service: job.service, status: job.status, scheduledAt: job.scheduledAt, createdAt: job.createdAt })
    .from(job).where(eq(job.businessProfileId, businessProfileId)).orderBy(desc(job.createdAt)).limit(200);
  const counts = new Map<string, number>();
  for (const record of records) {
    const label = text(record.service, 255);
    if (label) counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return {
    sourceType: 'existing_database_record',
    confidence: 'observed',
    recordsReviewed: records.length,
    observations: [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([subject, occurrences]) => ({
      kind: 'observation',
      subject,
      predicate: 'recorded_work_count',
      value: String(occurrences),
      message: 'Observed from existing records only; this is not a business rule or forecast.',
    })),
  };
}
