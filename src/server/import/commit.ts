import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '@/server/db/client.js';
import { customer, customerActivity, customerNote, employee, estimate, financeLineItem, invoice, job, payment, pilotKnowledgeFact } from '@/server/db/schema.js';
import { knowledgeFactKey } from '@/server/pilot/document-intelligence.js';
import { buildPlan, loadContext, type InternalItem } from './plan.js';
import { importKinds, type ImportKind, type ImportRequest, type ImportResult } from './types.js';

type Writer = Pick<typeof db, 'insert' | 'update'>;
const money = (value: unknown) => Number(value ?? 0).toFixed(2);
const empty = (): Record<ImportKind, number> => ({ customers: 0, employees: 0, services: 0, jobs: 0, quotes: 0, invoices: 0 });

function source(item: InternalItem) { return `Imported from ${item.candidate.fileName}, row ${item.candidate.row}`; }

async function importEmployees(tx: Writer, tenantId: string, rows: InternalItem[], result: ImportResult) {
  for (const row of rows) {
    const data = row.candidate.data as { name: string; phone: string; email: string; role: string; status: string };
    if (row.item.action === 'create') {
      await tx.insert(employee).values({ id: randomUUID(), businessProfileId: tenantId, name: data.name, email: data.email || null, phoneNumber: data.phone || null, role: data.role || null, status: data.status });
      result.imported.employees += 1;
    } else if (row.item.action === 'update' && row.existingId) {
      const changes = { name: data.name, ...(data.email && { email: data.email }), ...(data.phone && { phoneNumber: data.phone }), ...(data.role && { role: data.role }), status: data.status };
      await tx.update(employee).set(changes).where(eq(employee.id, row.existingId));
      result.updated.employees += 1;
    }
  }
}

async function importServices(tx: Writer, tenantId: string, rows: InternalItem[], result: ImportResult) {
  for (const row of rows) {
    if (row.item.action !== 'create') continue;
    const data = row.candidate.data as { name: string; price: number; unit: string; details: string; notes: string[] };
    const details = [data.details, ...data.notes].filter(Boolean).join('\n') || null;
    await tx.insert(pilotKnowledgeFact).values({ id: randomUUID(), businessProfileId: tenantId, kind: 'price', subject: data.name, predicate: 'price', value: money(data.price), unit: data.unit, details, normalizedKey: knowledgeFactKey({ kind: 'price', subject: data.name, predicate: 'price' }), sourceType: 'import', sourceReference: source(row), confidence: 'explicit', status: 'accepted' });
    result.imported.services += 1;
  }
}

async function importCustomers(tx: Writer, tenantId: string, rows: InternalItem[], ids: Map<string, string>, result: ImportResult) {
  for (const row of rows) {
    const data = row.candidate.data as { name: string; phone: string; email: string; address: string; company: string; notes: string[] };
    if (row.item.action === 'create') {
      const id = randomUUID();
      await tx.insert(customer).values({ id, businessProfileId: tenantId, name: data.name, phoneNumber: data.phone, email: data.email || null, address: data.address || null, company: data.company || null, status: 'new' });
      await tx.insert(customerActivity).values({ id: randomUUID(), customerId: id, activityType: 'customer_created', title: 'Customer profile created', detail: `${source(row)}.` });
      if (data.notes.length) await tx.insert(customerNote).values({ id: randomUUID(), customerId: id, body: data.notes.join('\n') });
      ids.set(row.candidate.key, id);
      result.imported.customers += 1;
    } else if (row.item.action === 'update' && row.existingId) {
      const changes = { name: data.name, ...(data.phone && { phoneNumber: data.phone }), ...(data.email && { email: data.email }), ...(data.address && { address: data.address }), ...(data.company && { company: data.company }) };
      await tx.update(customer).set(changes).where(eq(customer.id, row.existingId));
      await tx.insert(customerActivity).values({ id: randomUUID(), customerId: row.existingId, activityType: 'customer_updated', title: 'Customer details updated', detail: `${source(row)}.` });
      if (data.notes.length) await tx.insert(customerNote).values({ id: randomUUID(), customerId: row.existingId, body: data.notes.join('\n') });
      result.updated.customers += 1;
    }
  }
}

async function importJobs(tx: Writer, tenantId: string, rows: InternalItem[], customerId: (row: InternalItem) => string | undefined, result: ImportResult) {
  for (const row of rows) {
    if (row.item.action !== 'create') continue;
    const owner = customerId(row);
    if (!owner) { markMissingCustomer(row, result); continue; }
    const data = row.candidate.data as { service: string; address: string; employee: string; scheduledAt: string | null; duration: number | null; status: string; notes: string[] };
    await tx.insert(job).values({ id: randomUUID(), businessProfileId: tenantId, customerId: owner, service: data.service, address: data.address || null, assignedEmployee: data.employee || null, scheduledAt: data.scheduledAt ? new Date(data.scheduledAt) : null, durationMinutes: data.duration, status: data.status, notes: data.notes.join('\n') || null });
    result.imported.jobs += 1;
  }
}

async function importFinance(tx: Writer, tenantId: string, kind: 'quotes' | 'invoices', rows: InternalItem[], customerId: (row: InternalItem) => string | undefined, result: ImportResult) {
  for (const row of rows) {
    if (row.item.action !== 'create') continue;
    const owner = customerId(row);
    if (!owner) { markMissingCustomer(row, result); continue; }
    const data = row.candidate.data as { number: string; date: string | null; later: string | null; subtotal: number; tax: number; total: number; status: string; description: string; notes: string[] };
    const id = randomUUID();
    const createdAt = data.date ? new Date(data.date) : new Date();
    const label = data.description || (data.number ? `${kind === 'quotes' ? 'Quote' : 'Invoice'} ${data.number}` : `Imported ${kind === 'quotes' ? 'quote' : 'invoice'}`);
    const notes = [data.number ? `Original number: ${data.number}` : '', ...data.notes, source(row)].filter(Boolean).join('\n');
    const taxRate = data.subtotal > 0 ? Math.min(100, (data.tax / data.subtotal) * 100) : 0;
    const totals = { subtotal: money(data.subtotal), taxTotal: money(data.tax), total: money(data.total) };
    const line = { id: randomUUID(), description: label.slice(0, 1000), quantity: '1.00', unitPrice: money(data.subtotal), subtotal: money(data.subtotal), taxRate: taxRate.toFixed(4), taxAmount: money(data.tax), total: money(data.total), position: 0 };
    if (kind === 'quotes') {
      await tx.insert(estimate).values({ id, businessProfileId: tenantId, customerId: owner, status: data.status, ...totals, clientRequestId: row.requestId, notes, expiresAt: data.later ? new Date(data.later) : null, createdAt });
      await tx.insert(financeLineItem).values({ ...line, estimateId: id });
      result.imported.quotes += 1;
    } else {
      await tx.insert(invoice).values({ id, businessProfileId: tenantId, customerId: owner, status: data.status, ...totals, clientRequestId: row.requestId, notes, dueAt: data.later ? new Date(data.later) : null, createdAt });
      await tx.insert(financeLineItem).values({ ...line, invoiceId: id });
      // An invoice marked paid also records the matching payment, so sales and balances agree with the old system.
      if (data.status === 'paid' && data.total > 0) await tx.insert(payment).values({ id: randomUUID(), businessProfileId: tenantId, customerId: owner, invoiceId: id, amount: money(data.total), method: 'Imported', notes: `${source(row)} (invoice marked paid)`, status: 'completed', receivedAt: createdAt });
      result.imported.invoices += 1;
    }
  }
}

function markMissingCustomer(row: InternalItem, result: ImportResult) {
  result.issues.push({ kind: row.candidate.kind, label: row.item.label, row: row.candidate.row, fileName: row.candidate.fileName, reason: 'Its customer could not be imported, so this record was left out.' });
}

/** Writes the confirmed plan. Each category is its own all-or-nothing step, and anything left out is reported. */
export async function runImport(tenantId: string, request: ImportRequest): Promise<ImportResult> {
  const context = await loadContext(tenantId);
  const { items } = buildPlan(tenantId, request, context);
  const result: ImportResult = { imported: empty(), updated: empty(), issues: [], failed: [] };
  const ids = new Map<string, string>();
  const forKind = (kind: ImportKind) => items.filter((row) => row.candidate.kind === kind);
  const customerId = (row: InternalItem) => row.customer?.existingId ?? (row.customer?.newKey ? ids.get(row.customer.newKey) : undefined);

  const steps: Array<[ImportKind, (tx: Writer, rows: InternalItem[]) => Promise<void>]> = [
    ['employees', (tx, rows) => importEmployees(tx, tenantId, rows, result)],
    ['services', (tx, rows) => importServices(tx, tenantId, rows, result)],
    ['customers', (tx, rows) => importCustomers(tx, tenantId, rows, ids, result)],
    ['jobs', (tx, rows) => importJobs(tx, tenantId, rows, customerId, result)],
    ['quotes', (tx, rows) => importFinance(tx, tenantId, 'quotes', rows, customerId, result)],
    ['invoices', (tx, rows) => importFinance(tx, tenantId, 'invoices', rows, customerId, result)],
  ];
  for (const [kind, run] of steps) {
    const rows = forKind(kind);
    if (!rows.some((row) => row.item.action !== 'skip')) continue;
    const before = { imported: result.imported[kind], updated: result.updated[kind], issues: result.issues.length };
    try {
      await db.transaction(async (tx) => { await run(tx as unknown as Writer, rows); });
    } catch (error) {
      // The whole category rolled back, so none of it counts as imported.
      result.imported[kind] = before.imported; result.updated[kind] = before.updated; result.issues.length = before.issues;
      for (const row of rows.filter((entry) => entry.item.action === 'create')) ids.delete(row.candidate.key);
      result.failed.push({ kind, message: error instanceof Error ? error.message : 'The database could not save these records.' });
    }
  }
  for (const row of items) {
    if (row.item.problem) result.issues.push({ kind: row.candidate.kind, label: row.item.label, row: row.candidate.row, fileName: row.candidate.fileName, reason: row.item.reason || row.item.issues[0] || 'Needs your attention.' });
  }
  return result;
}

export { importKinds };
