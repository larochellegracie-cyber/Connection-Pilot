import { and, eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '@/server/db/client.js';
import { pilotKnowledgeDocument, pilotKnowledgeDocumentFact, pilotKnowledgeFact } from '@/server/db/schema.js';
import { type PilotFactInput, type PilotFactKind } from '@/server/pilot/learning.js';
import { extractReadableFileContent, isSupportedFileType, storeOriginalDocument } from '@/server/pilot/file-extraction.js';
import { extractSpreadsheetReviewFacts } from '@/server/pilot/spreadsheet-review-facts.js';

const supportedDocumentTypes = new Set(['text/plain', 'text/csv', 'text/markdown', 'application/json', 'text/tab-separated-values']);
const maxDocumentCharacters = 60000;

type ExtractedFact = PilotFactInput & { groupName: string; confidence: 'explicit' | 'clearly_extracted' | 'ambiguous' };
type ExistingFact = typeof pilotKnowledgeFact.$inferSelect;

function clean(value: string, limit: number) {
  return value.replace(/\s+/g, ' ').trim().slice(0, limit);
}

function normalized(value: string) {
  return clean(value.toLowerCase().replace(/[^a-z0-9]+/g, ' '), 500);
}

function singular(value: string) {
  return normalized(value).replace(/\b([a-z]{4,})s\b/g, '$1');
}

function key(fact: Pick<ExtractedFact, 'kind' | 'subject' | 'predicate'>) {
  return `${fact.kind}:${singular(fact.subject)}:${normalized(fact.predicate)}`.slice(0, 500);
}

function fact(groupName: string, kind: PilotFactKind, subject: string, predicate: string, value: string, evidence: string, unit?: string, details?: string, confidence: ExtractedFact['confidence'] = 'clearly_extracted'): ExtractedFact | null {
  const prepared = { groupName, kind, subject: clean(subject, 255), predicate: clean(predicate, 100), value: clean(value, 4000), evidence: clean(evidence, 1000), unit: unit ? clean(unit, 120) : undefined, details: details ? clean(details, 6000) : undefined, confidence };
  return prepared.subject && prepared.predicate && prepared.value && prepared.evidence ? prepared : null;
}

function uniqueFacts(facts: Array<ExtractedFact | null>, uniqueByDocumentKey = false) {
  const seen = new Set<string>();
  return facts.filter((item): item is ExtractedFact => Boolean(item)).filter((item) => {
    const fingerprint = uniqueByDocumentKey ? key(item) : `${key(item)}:${normalized(item.value)}:${normalized(item.unit ?? '')}`;
    if (seen.has(fingerprint)) return false;
    seen.add(fingerprint);
    return true;
  }).slice(0, 100);
}


export function extractDocumentFacts(content: string, strictSpreadsheetRows = false) {
  const lines = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 1000);
  const findings: Array<ExtractedFact | null> = [];
  const warnings: string[] = [];
  let recipeSubject = '';
  let supplierSubject = '';
  let inventoryHeading = false;

  for (const line of lines) {
    const isSpreadsheetRow = /^Row\s+\d+\s*:/i.test(line);
    const valueLine = line.replace(/^(?:Page|Row)\s+\d+\s*:\s*/i, '');
    const normalizedLine = normalized(valueLine);
    if (/\b(inventory|stock on hand|current stock)\b/.test(normalizedLine)) inventoryHeading = true;
    const heading = valueLine.match(/^([A-Za-z][A-Za-z '&-]{2,80})(?:\s*recipe)?$/);
    if (heading && /\b(supply|supplier|wholesale|distributor)\b/i.test(heading[1])) supplierSubject = heading[1];
    else if (heading && !/^ingredients?$/i.test(heading[1]) && !/^products?$/i.test(heading[1]) && !/^services?$/i.test(heading[1])) recipeSubject = heading[1].replace(/\s+recipe$/i, '');

    if (strictSpreadsheetRows && isSpreadsheetRow) {
      for (const item of extractSpreadsheetReviewFacts(line)) {
        findings.push(fact(item.groupName, item.kind, item.subject, item.predicate, item.value, item.evidence, item.unit, item.details, item.confidence));
      }
    }

    const structuredPrice = valueLine.match(/(?:product|service|item|name)\s*:\s*([^|]+?)\s*\|\s*(?:price|amount|rate)\s*:\s*\$?\s*([0-9]+(?:[.,][0-9]{1,2})?)\s*(?:\/|per\s+)?\s*([a-zA-Z]+)?/i);
    if (structuredPrice) findings.push(fact('Products and pricing', 'price', structuredPrice[1], 'price', structuredPrice[2].replace(',', '.'), line, structuredPrice[3]?.toLowerCase() || 'each'));
    const spreadsheetRecipe = valueLine.match(/(?:recipe|product|item)\s*:\s*([^|]+?)\s*\|\s*(?:material|ingredient)\s*:\s*([^|]+?)(?:\s*\|\s*(?:quantity|amount)\s*:\s*([^|]+))?$/i);
    if (spreadsheetRecipe) findings.push(fact('Recipes and requirements', 'resource_requirement', spreadsheetRecipe[1], 'requires_material', spreadsheetRecipe[3]?.trim() || 'documented', line, undefined, spreadsheetRecipe[2].trim(), 'clearly_extracted'));
    const spreadsheetSupplier = valueLine.match(/(?:supplier|vendor)\s*:\s*([^|]+?)\s*\|\s*(?:delivery|lead time)\s*:\s*([^|]+)/i);
    if (spreadsheetSupplier) {
      supplierSubject = spreadsheetSupplier[1].trim();
      findings.push(fact('Supplier details', 'supplier_relationship', supplierSubject, 'lead time', spreadsheetSupplier[2], line));
    }
    const spreadsheetMinimum = valueLine.match(/(?:supplier|vendor)\s*:\s*([^|]+?)(?:\s*\|\s*[^|]+)*?\s*\|\s*(?:minimum(?:\s+order)?|minimum order quantity)\s*:\s*([^|]+)/i);
    if (spreadsheetMinimum) {
      supplierSubject = spreadsheetMinimum[1].trim();
      findings.push(fact('Supplier details', 'supplier_relationship', supplierSubject, 'minimum order', spreadsheetMinimum[2], line));
    }
    const spreadsheetRule = valueLine.match(/(?:policy|rule)\s*:\s*(.+)$/i);
    if (spreadsheetRule) findings.push(fact('Business rules and policies', 'business_rule', 'Business policy', 'policy', spreadsheetRule[1], line, undefined, undefined, 'explicit'));
    const price = valueLine.match(/^(.+?)\s*(?:—|–|-|:)\s*\$\s*([0-9]+(?:[.,][0-9]{1,2})?)\s*(?:\/|per\s+)?\s*([a-zA-Z]+)?\s*$/i);
    const tablePrice = valueLine.match(/^([A-Za-z][A-Za-z '&-]{1,100}?)\s{2,}\$\s*([0-9]+(?:[.,][0-9]{1,2})?)\s*(?:\/|per\s+)?\s*([a-zA-Z]+)?\s*$/i);
    const detectedPrice = price ?? tablePrice;
    if (detectedPrice && !structuredPrice) findings.push(fact('Products and pricing', 'price', detectedPrice[1], 'price', detectedPrice[2].replace(',', '.'), line, detectedPrice[3]?.toLowerCase() || 'each'));
    const inventoryRow = valueLine.match(/(?:item|product|material|ingredient|name)\s*:\s*([^|]+?)\s*\|\s*(?:inventory|stock|on hand|quantity)\s*:\s*([^|]+)/i);
    if (inventoryRow && !spreadsheetRecipe) findings.push(fact('Inventory observations', 'observation', inventoryRow[1], 'documented_inventory', inventoryRow[2], line, undefined, 'Observed in an uploaded document; this is not current inventory.', 'explicit'));

    const yieldMatch = line.match(/^(?:makes|yield)\s*:?\s*([0-9]+(?:\.[0-9]+)?)\s*([a-zA-Z ]+)?$/i);
    if (yieldMatch && recipeSubject) findings.push(fact('Recipes and requirements', 'offering', recipeSubject, 'yield', yieldMatch[1], line, yieldMatch[2]?.trim() || undefined));

    const requirement = line.match(/^([0-9]+(?:\/[0-9]+|\.\d+)?)\s*(cups?|tbsp|tablespoons?|tsp|teaspoons?|bags?|dozens?|kg|g|lbs?|oz|items?|units?)?\s+([A-Za-z][A-Za-z '&-]{1,100})$/i);
    if (requirement && recipeSubject && !price) {
      findings.push(fact('Recipes and requirements', 'resource_requirement', recipeSubject, 'requires_material', requirement[1], line, requirement[2]?.toLowerCase(), requirement[3], 'clearly_extracted'));
    }

    const supplierDelivery = line.match(/^(.+?)\s+(?:delivery|lead time)\s*:\s*(.+)$/i);
    if (supplierDelivery && supplierSubject) findings.push(fact('Supplier details', 'supplier_relationship', supplierSubject, `${supplierDelivery[1]} lead time`, supplierDelivery[2], line, undefined, undefined, 'clearly_extracted'));
    const supplierMinimum = line.match(/^minimum\s+order\s*:\s*(.+)$/i);
    if (supplierMinimum && supplierSubject) findings.push(fact('Supplier details', 'supplier_relationship', supplierSubject, 'minimum order', supplierMinimum[1], line));

    if (!spreadsheetRule && (!strictSpreadsheetRows || !isSpreadsheetRow) && /\b(cancellation|notice|required|must|policy|deposit|pickup)\b/i.test(line) && line.length >= 12 && line.length <= 500 && !/\b(delivery|lead time)\s*:/i.test(line)) {
      findings.push(fact('Business rules and policies', 'business_rule', 'Business policy', 'policy', line, line, undefined, undefined, 'explicit'));
    }
  }

  if (inventoryHeading) warnings.push('This document appears to include inventory or stock information. Inventory figures are not saved as current inventory; confirm their date and purpose before using them operationally.');
  const facts = uniqueFacts(findings, strictSpreadsheetRows);
  if (strictSpreadsheetRows && !facts.length) warnings.push('Pilot read the workbook, but none of its rows contained recognised product pricing, recipe requirements, supplier lead times, or explicit business policies to review.');
  return { facts, warnings };
}

export function matchDocumentFact(existing: Pick<ExistingFact, 'id' | 'value' | 'unit'> | undefined, candidate: Pick<ExtractedFact, 'value' | 'unit'>) {
  if (!existing) return { status: 'pending_review', matchingFactId: null } as const;
  const sameValue = normalized(existing.value) === normalized(candidate.value) && normalized(existing.unit ?? '') === normalized(candidate.unit ?? '');
  return sameValue ? { status: 'duplicate', matchingFactId: existing.id } as const : { status: 'conflict', matchingFactId: existing.id } as const;
}

export async function createDocumentReview(businessProfileId: string, input: { fileName: string; fileType: string; sourceReference?: string; content?: string; base64?: string }) {
  const fileName = clean(input.fileName, 255);
  if (!fileName) throw new Error('Choose a supported business file.');
  const useFile = Boolean(input.base64);
  if (useFile && !isSupportedFileType(fileName, input.fileType)) throw new Error('Pilot can read DOCX, PDF, XLSX/XLTX/XLS, CSV, TSV, TXT, Markdown, JSON, PNG, JPG, JPEG, and WEBP files.');
  const parsed = useFile ? await extractReadableFileContent({ fileName, fileType: input.fileType, base64: input.base64 ?? '' }) : null;
  const fileType = parsed?.fileType ?? clean(input.fileType || 'text/plain', 80).toLowerCase();
  const content = (parsed?.content ?? input.content ?? '').slice(0, maxDocumentCharacters).trim();
  if (!content) throw new Error("Pilot couldn't read this file yet. Try another supported file or tell Pilot the information directly.");
  if (!useFile && !supportedDocumentTypes.has(fileType)) throw new Error('Pilot can read DOCX, PDF, XLSX/XLTX/XLS, CSV, TSV, TXT, Markdown, JSON, PNG, JPG, JPEG, and WEBP files.');
  const extraction = extractDocumentFacts(content, fileType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.template');
  const documentId = randomUUID();
  const storagePath = parsed ? await storeOriginalDocument(businessProfileId, documentId, fileName, parsed.buffer) : null;
  const existing = await db.select().from(pilotKnowledgeFact).where(eq(pilotKnowledgeFact.businessProfileId, businessProfileId));
  const exact = new Map(existing.map((item) => [key({ kind: item.kind as PilotFactKind, subject: item.subject, predicate: item.predicate }), item]));
  await db.transaction(async (tx) => {
    await tx.insert(pilotKnowledgeDocument).values({ id: documentId, businessProfileId, fileName, fileType, sourceReference: clean(input.sourceReference ?? '', 2048) || null, storagePath, originalSizeBytes: parsed?.buffer.length ?? null, extractedText: content, status: 'review_required' });
    if (extraction.facts.length) await tx.insert(pilotKnowledgeDocumentFact).values(extraction.facts.map((item) => {
      const match = matchDocumentFact(exact.get(key(item)), item);
      return { id: randomUUID(), documentId, businessProfileId, groupName: item.groupName, kind: item.kind, subject: item.subject, predicate: item.predicate, value: item.value, unit: item.unit ?? null, details: item.details ?? null, evidence: item.evidence, normalizedKey: key(item), confidence: item.confidence, status: match.status, matchingFactId: match.matchingFactId };
    }));
  });
  return getDocumentReview(businessProfileId, documentId, extraction.warnings);
}

export async function getDocumentReview(businessProfileId: string, documentId: string, warnings: string[] = []) {
  const [document] = await db.select().from(pilotKnowledgeDocument).where(and(eq(pilotKnowledgeDocument.id, documentId), eq(pilotKnowledgeDocument.businessProfileId, businessProfileId))).limit(1);
  if (!document) throw new Error('Document review not found.');
  const facts = await db.select().from(pilotKnowledgeDocumentFact).where(and(eq(pilotKnowledgeDocumentFact.documentId, documentId), eq(pilotKnowledgeDocumentFact.businessProfileId, businessProfileId)));
  const matchIds = facts.map((item) => item.matchingFactId).filter((id): id is string => Boolean(id));
  const matching = matchIds.length ? await db.select().from(pilotKnowledgeFact).where(inArray(pilotKnowledgeFact.id, matchIds)) : [];
  const matchingMap = new Map(matching.map((item) => [item.id, item]));
  const grouped = Object.groupBy(facts, (item) => item.groupName);
  return {
    document: { id: document.id, fileName: document.fileName, fileType: document.fileType, sourceReference: document.sourceReference, status: document.status, createdAt: document.createdAt },
    summary: { found: facts.length, readyToSave: facts.filter((item) => item.status === 'pending_review').length, duplicates: facts.filter((item) => item.status === 'duplicate').length, conflicts: facts.filter((item) => item.status === 'conflict').length, warnings },
    groups: Object.entries(grouped).map(([name, items]) => ({ name, facts: (items ?? []).map((item) => ({ ...item, matchingFact: item.matchingFactId ? matchingMap.get(item.matchingFactId) ?? null : null })) })),
  };
}

type ReviewEdit = { id: string; subject?: string; predicate?: string; value?: string; unit?: string | null; details?: string | null };

export async function confirmDocumentReview(businessProfileId: string, documentId: string, acceptedIds: string[], rejectedIds: string[], edits: ReviewEdit[] = []) {
  const document = await getDocumentReview(businessProfileId, documentId);
  if (document.document.status !== 'review_required') throw new Error('This document review is already complete.');
  const facts = await db.select().from(pilotKnowledgeDocumentFact).where(and(eq(pilotKnowledgeDocumentFact.documentId, documentId), eq(pilotKnowledgeDocumentFact.businessProfileId, businessProfileId)));
  const editsById = new Map(edits.slice(0, 100).map((edit) => [edit.id, edit]));
  const accepted = facts.filter((item) => acceptedIds.includes(item.id) && item.status === 'pending_review');
  const rejected = facts.filter((item) => rejectedIds.includes(item.id) && item.status === 'pending_review');
  await db.transaction(async (tx) => {
    for (const item of accepted) {
      const edit = editsById.get(item.id);
      const subject = clean(edit?.subject ?? item.subject, 255);
      const predicate = clean(edit?.predicate ?? item.predicate, 100);
      const value = clean(edit?.value ?? item.value, 4000);
      const unit = clean(edit?.unit ?? item.unit ?? '', 120) || null;
      const details = clean(edit?.details ?? item.details ?? '', 6000) || null;
      if (!subject || !predicate || !value) throw new Error('Each confirmed fact needs a subject, field, and value.');
      const normalizedKey = key({ kind: item.kind as PilotFactKind, subject, predicate });
      const [existing] = await tx.select().from(pilotKnowledgeFact).where(and(eq(pilotKnowledgeFact.businessProfileId, businessProfileId), eq(pilotKnowledgeFact.normalizedKey, normalizedKey))).limit(1);
      if (existing) throw new Error(`A saved fact already uses ${subject} · ${predicate}. Review it before saving a conflicting change.`);
      await tx.update(pilotKnowledgeDocumentFact).set({ subject, predicate, value, unit, details, normalizedKey }).where(eq(pilotKnowledgeDocumentFact.id, item.id));
      await tx.insert(pilotKnowledgeFact).values({ id: randomUUID(), businessProfileId, kind: item.kind, subject, predicate, value, unit, details, normalizedKey, sourceType: 'document', sourceReference: `Document: ${document.document.fileName} (${documentId}). ${item.evidence}`, confidence: item.confidence, status: 'accepted' });
      await tx.update(pilotKnowledgeDocumentFact).set({ status: 'accepted', reviewedAt: new Date() }).where(eq(pilotKnowledgeDocumentFact.id, item.id));
    }
    if (rejected.length) await tx.update(pilotKnowledgeDocumentFact).set({ status: 'rejected', reviewedAt: new Date() }).where(inArray(pilotKnowledgeDocumentFact.id, rejected.map((item) => item.id)));
    await tx.update(pilotKnowledgeDocument).set({ status: accepted.length ? 'partially_saved' : 'reviewed', reviewedAt: new Date() }).where(eq(pilotKnowledgeDocument.id, documentId));
  });
  return { saved: accepted.length, rejected: rejected.length, remainingConflicts: facts.filter((item) => item.status === 'conflict').length, duplicatesSkipped: facts.filter((item) => item.status === 'duplicate').length };
}

export const documentIntelligenceSupport = { fileTypes: ['.docx', '.pdf', '.xlsx', '.xltx', '.xls', '.csv', '.tsv', '.txt', '.md', '.markdown', '.json', '.png', '.jpg', '.jpeg', '.webp'], note: 'PDFs are read when they contain extractable text; image-only PDFs remain unreadable. Spreadsheets retain sheet, header, and row context for review. Document intake never changes inventory, prices, suppliers, schedules, customers, employees, or financial records automatically.' };
