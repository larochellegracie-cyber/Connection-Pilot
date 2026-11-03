import { eq, isNotNull, and } from 'drizzle-orm';
import { db } from '@/server/db/client.js';
import { customer, employee, estimate, invoice, job, pilotKnowledgeFact } from '@/server/db/schema.js';
import { knowledgeFactKey } from '@/server/pilot/document-intelligence.js';
import { buildCandidates, customerLookupKeys, importRequestId, type Candidate, type CustomerRef } from './build.js';
import { digitsOnly } from './normalize.js';
import { importKinds, type CategoryPlan, type ImportKind, type ImportRequest, type Plan, type PlanItem, type RecordChoice } from './types.js';

type Target = { existingId?: string; newKey?: string };

/** What the commit step needs beyond what the owner sees. */
export type InternalItem = {
  item: PlanItem;
  candidate: Candidate;
  existingId?: string;
  customer?: Target;
  requestId?: string;
  mergeInto?: string;
};

type ExistingCustomer = { id: string; name: string; phone: string; email: string | null; address: string | null; company: string | null };
type ExistingEmployee = { id: string; name: string; phone: string | null; email: string | null; role: string | null; status: string };

export type PlanContext = {
  customers: ExistingCustomer[];
  employees: ExistingEmployee[];
  factKeys: Set<string>;
  jobKeys: Set<string>;
  quoteIds: Set<string>;
  invoiceIds: Set<string>;
};

export async function loadContext(tenantId: string): Promise<PlanContext> {
  const [customers, employees, facts, jobs, estimates, invoices] = await Promise.all([
    db.select({ id: customer.id, name: customer.name, phone: customer.phoneNumber, email: customer.email, address: customer.address, company: customer.company }).from(customer).where(eq(customer.businessProfileId, tenantId)),
    db.select({ id: employee.id, name: employee.name, phone: employee.phoneNumber, email: employee.email, role: employee.role, status: employee.status }).from(employee).where(eq(employee.businessProfileId, tenantId)),
    db.select({ key: pilotKnowledgeFact.normalizedKey }).from(pilotKnowledgeFact).where(eq(pilotKnowledgeFact.businessProfileId, tenantId)),
    db.select({ customerId: job.customerId, service: job.service, scheduledAt: job.scheduledAt }).from(job).where(eq(job.businessProfileId, tenantId)),
    db.select({ id: estimate.clientRequestId }).from(estimate).where(and(eq(estimate.businessProfileId, tenantId), isNotNull(estimate.clientRequestId))),
    db.select({ id: invoice.clientRequestId }).from(invoice).where(and(eq(invoice.businessProfileId, tenantId), isNotNull(invoice.clientRequestId))),
  ]);
  return {
    customers, employees,
    factKeys: new Set(facts.map((row) => row.key)),
    jobKeys: new Set(jobs.map((row) => jobKey(row.customerId, row.service, row.scheduledAt?.toISOString() ?? ''))),
    quoteIds: new Set(estimates.map((row) => row.id as string)),
    invoiceIds: new Set(invoices.map((row) => row.id as string)),
  };
}

const jobKey = (customerId: string, service: string, when: string) => `${customerId}|${service.toLowerCase().trim()}|${when}`;

function newItem(candidate: Candidate): PlanItem {
  return { key: candidate.key, kind: candidate.kind, row: candidate.row, fileName: candidate.fileName, label: candidate.label, display: candidate.display, issues: [...candidate.issues], action: 'create' };
}

function validChoice(options: RecordChoice[], requested: RecordChoice | undefined, fallback: RecordChoice): RecordChoice {
  return requested && options.includes(requested) ? requested : fallback;
}

function describeCustomer(existing: { name: string; email: string | null; phone?: string | null }) {
  const extra = existing.email || existing.phone;
  return extra ? `${existing.name} (${extra})` : existing.name;
}

/** Turns the owner's files and choices into exactly what would be created. Reads the database but never writes to it. */
export function buildPlan(tenantId: string, request: ImportRequest, context: PlanContext): { plan: Plan; items: InternalItem[] } {
  const candidates = buildCandidates(tenantId, request.sheets, request.decisions);
  const choices = request.recordChoices ?? {};
  const items: InternalItem[] = [];
  const registry = new Map<string, Target[]>();
  const register = (keys: string[], target: Target) => {
    for (const key of keys) {
      const list = registry.get(key) ?? [];
      if (!list.some((existing) => existing.existingId === target.existingId && existing.newKey === target.newKey)) list.push(target);
      registry.set(key, list);
    }
  };
  for (const existing of context.customers) register(customerLookupKeys({ name: existing.name, email: existing.email ?? '', phone: existing.phone }), { existingId: existing.id });

  const byKey = new Map<string, InternalItem>();
  const add = (candidate: Candidate, extra: Partial<InternalItem> = {}) => {
    const entry: InternalItem = { item: newItem(candidate), candidate, ...extra };
    if (candidate.blocking) { entry.item.action = 'skip'; entry.item.reason = 'Needs your attention before it can be imported.'; entry.item.problem = true; }
    items.push(entry); byKey.set(candidate.key, entry);
    return entry;
  };
  const ofKind = (kind: ImportKind) => candidates.filter((candidate) => candidate.kind === kind);

  // --- people and price lists first: other records point at them ---
  for (const kind of ['employees', 'customers'] as const) {
    const firstByDup = new Map<string, InternalItem>();
    const emailIndex = new Map<string, string>(); const phoneIndex = new Map<string, string>();
    const existingList: Array<ExistingCustomer | ExistingEmployee> = kind === 'customers' ? context.customers : context.employees;
    const byId = new Map(existingList.map((existing) => [existing.id, existing]));
    for (const existing of existingList) {
      if (existing.email) emailIndex.set(existing.email.toLowerCase(), existing.id);
      const digits = digitsOnly(existing.phone ?? '').slice(-10); if (digits.length >= 7) phoneIndex.set(digits, existing.id);
    }
    for (const candidate of ofKind(kind)) {
      const entry = add(candidate);
      if (candidate.blocking) continue;
      const data = candidate.data as { name: string; phone: string; email: string; address?: string };
      const matchId = (data.email && emailIndex.get(data.email.toLowerCase())) || (digitsOnly(data.phone).length >= 7 ? phoneIndex.get(digitsOnly(data.phone).slice(-10)) : undefined)
        || existingList.find((existing) => existing.name.toLowerCase() === data.name.toLowerCase() && (kind === 'employees' || (data.address && (existing as ExistingCustomer).address?.toLowerCase() === data.address.toLowerCase())))?.id;
      if (matchId) {
        const existing = byId.get(matchId)!;
        const options: RecordChoice[] = ['skip', 'update', 'create'];
        const choice = validChoice(options, choices[candidate.key], 'skip');
        entry.item.duplicate = { type: 'existing', description: `Possible existing ${kind === 'customers' ? 'customer' : 'employee'}: ${describeCustomer(existing)}`, options, choice };
        if (choice === 'skip') { entry.item.action = 'skip'; entry.item.reason = `Kept the existing ${kind === 'customers' ? 'customer' : 'employee'}.`; entry.existingId = existing.id; }
        if (choice === 'update') { entry.item.action = 'update'; entry.existingId = existing.id; }
        continue;
      }
      const first = firstByDup.get(candidate.dupKey);
      if (first) {
        const options: RecordChoice[] = ['skip', 'create', 'merge'];
        const choice = validChoice(options, choices[candidate.key], 'skip');
        entry.item.duplicate = { type: 'file', description: `Same ${data.email ? 'email address' : data.phone ? 'phone number' : 'name'} as “${first.item.label}” (row ${first.candidate.row}${first.candidate.fileName !== candidate.fileName ? ` of ${first.candidate.fileName}` : ''})`, options, choice };
        if (choice === 'skip') { entry.item.action = 'skip'; entry.item.reason = 'Skipped as a repeat.'; }
        if (choice === 'merge') { entry.item.action = 'skip'; entry.item.reason = 'Merged into the first copy.'; entry.mergeInto = first.candidate.key; }
        if (choice === 'create') entry.item.action = 'create';
      } else firstByDup.set(candidate.dupKey, entry);
    }
    // Merge: fill blanks in the first copy from the repeat. Nothing is deleted.
    for (const entry of items.filter((row) => row.mergeInto)) {
      const target = byKey.get(entry.mergeInto!);
      if (!target || target.item.action === 'skip') { entry.item.reason = 'Merged into a copy that is not being imported.'; continue; }
      const source = entry.candidate.data as Record<string, unknown>; const into = target.candidate.data as Record<string, unknown>;
      for (const [field, value] of Object.entries(source)) if (field !== 'notes' && typeof value === 'string' && value && !into[field]) into[field] = value;
      if (Array.isArray(source.notes) && Array.isArray(into.notes)) into.notes = [...into.notes, ...source.notes];
    }
    if (kind === 'customers') {
      for (const entry of items.filter((row) => row.candidate.kind === 'customers' && row.item.action !== 'skip' && !row.existingId)) {
        const data = entry.candidate.data as { name: string; phone: string; email: string };
        register(customerLookupKeys(data), { newKey: entry.candidate.key });
      }
      // Customers that matched an existing record (kept or updated) are already registered under the existing id.
    }
  }

  for (const candidate of ofKind('services')) {
    const entry = add(candidate);
    if (candidate.blocking) continue;
    const data = candidate.data as { name: string; price: number; unit: string };
    const factKey = knowledgeFactKey({ kind: 'price', subject: data.name, predicate: 'price' });
    const repeat = items.some((row) => row !== entry && row.candidate.kind === 'services' && row.candidate.dupKey === candidate.dupKey && !row.candidate.blocking);
    if (context.factKeys.has(factKey)) { entry.item.action = 'skip'; entry.item.reason = 'Already saved in Pilot’s business knowledge.'; }
    else if (repeat) { entry.item.action = 'skip'; entry.item.reason = 'Listed more than once; the first one is used.'; }
    else context.factKeys.add(factKey);
  }

  // --- records that belong to a customer ---
  const resolve = (ref: CustomerRef): { target?: Target; problem?: string } => {
    for (const key of customerLookupKeys(ref)) {
      const found = registry.get(key);
      if (found?.length === 1) return { target: found[0] };
      if (found && found.length > 1) return { problem: `More than one customer matches “${ref.name || ref.email || ref.phone}”. Add an email or phone number to this row so Pilot knows which one.` };
    }
    return { problem: `No customer named “${ref.name || ref.email || ref.phone}” was found in your customers or in this import.` };
  };

  for (const kind of ['jobs', 'quotes', 'invoices'] as const) {
    const seen = new Set<string>();
    for (const candidate of ofKind(kind)) {
      const entry = add(candidate);
      if (candidate.blocking) continue;
      const resolved = resolve(candidate.ref!);
      if (!resolved.target) { entry.item.action = 'skip'; entry.item.reason = resolved.problem; entry.item.problem = true; entry.item.issues.push(resolved.problem!); continue; }
      entry.customer = resolved.target;
      if (kind === 'jobs') {
        const data = candidate.data as { service: string; scheduledAt: string | null };
        const key = `${resolved.target.existingId ?? resolved.target.newKey}|${data.service.toLowerCase().trim()}|${data.scheduledAt ?? ''}`;
        if (resolved.target.existingId && context.jobKeys.has(jobKey(resolved.target.existingId, data.service, data.scheduledAt ?? ''))) { entry.item.action = 'skip'; entry.item.reason = 'This job is already in Jobs.'; }
        else if (seen.has(key)) { entry.item.action = 'skip'; entry.item.reason = 'Listed more than once; the first one is used.'; }
        seen.add(key);
      } else {
        const requestId = importRequestId(tenantId, kind, (candidate.data as { idParts: string[] }).idParts);
        entry.requestId = requestId;
        const known = kind === 'quotes' ? context.quoteIds : context.invoiceIds;
        if (known.has(requestId)) { entry.item.action = 'skip'; entry.item.reason = `This ${kind === 'quotes' ? 'quote' : 'invoice'} was already imported.`; }
        else if (seen.has(requestId)) { entry.item.action = 'skip'; entry.item.reason = 'Listed more than once; the first one is used.'; }
        seen.add(requestId);
      }
    }
  }

  return { plan: summarize(items), items };
}

function summarize(items: InternalItem[]): Plan {
  const categories = {} as Record<ImportKind, CategoryPlan>;
  for (const kind of importKinds) {
    const mine = items.filter((row) => row.candidate.kind === kind);
    const attention = mine.filter((row) => row.item.issues.length || row.item.duplicate || (row.item.action === 'skip' && row.item.reason));
    const notes: string[] = [];
    if (kind === 'invoices' && mine.some((row) => row.item.action === 'create' && row.candidate.data.status === 'paid')) notes.push('Invoices marked paid also record a payment for the invoice total, so your sales and balances stay correct.');
    if (kind === 'invoices' || kind === 'quotes') notes.push('Each imported record has one line with its total; the original line items are not in a spreadsheet summary.');
    categories[kind] = {
      kind, found: mine.length,
      willCreate: mine.filter((row) => row.item.action === 'create').length,
      willUpdate: mine.filter((row) => row.item.action === 'update').length,
      skipped: mine.filter((row) => row.item.action === 'skip').length,
      needsAttention: attention.length,
      notes: mine.length ? notes : [],
      sample: mine.filter((row) => row.item.action !== 'skip').slice(0, 8).map((row) => row.item),
      attention: attention.slice(0, 100).map((row) => row.item),
    };
  }
  const all = Object.values(categories);
  return { categories, found: all.reduce((sum, row) => sum + row.found, 0), willCreate: all.reduce((sum, row) => sum + row.willCreate, 0), willUpdate: all.reduce((sum, row) => sum + row.willUpdate, 0) };
}
