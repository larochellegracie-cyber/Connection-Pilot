import { createHash } from 'node:crypto';
import { clean, digitsOnly, normalizePhoneNumber, parseDate, parseMoney, splitName, validEmail } from './normalize.js';
import { fieldLabel } from './fields.js';
import type { ImportKind, ParsedSheet, SheetDecision } from './types.js';

export type CustomerRef = { name: string; email: string; phone: string };

export type Candidate = {
  key: string; kind: ImportKind; sheetId: string; fileName: string; row: number;
  label: string;
  /** Short readable columns for the preview table. */
  display: Record<string, string>;
  issues: string[];
  /** True when the record cannot be imported as it is. */
  blocking: boolean;
  /** Identifies the same real-world record, to spot repeats inside the files. */
  dupKey: string;
  data: Record<string, unknown>;
  ref?: CustomerRef;
};

export const statusLabels = { invoices: ['draft', 'sent', 'open', 'paid', 'overdue', 'void'], quotes: ['draft', 'sent', 'accepted', 'declined', 'expired'], jobs: ['booked', 'in_progress', 'completed', 'invoiced', 'paid', 'cancelled'] } as const;

export function invoiceStatusFrom(text: string): string | null {
  const value = text.toLowerCase().replace(/[^a-z]+/g, ' ').trim();
  if (!value) return 'open';
  if (/^(paid|paid in full|complete|completed|settled)$/.test(value)) return 'paid';
  if (/overdue|past due|late/.test(value)) return 'overdue';
  if (/^(unpaid|open|outstanding|due|pending|partial|partially paid|balance due)$/.test(value)) return 'open';
  if (value === 'sent') return 'sent';
  if (value === 'draft') return 'draft';
  if (/^(void|voided|cancelled|canceled|written off)$/.test(value)) return 'void';
  return null;
}
export function quoteStatusFrom(text: string): string | null {
  const value = text.toLowerCase().replace(/[^a-z]+/g, ' ').trim();
  if (!value || value === 'draft') return 'draft';
  if (/^(accepted|approved|won|signed|converted)$/.test(value)) return 'accepted';
  if (/^(declined|rejected|lost|refused)$/.test(value)) return 'declined';
  if (/^(expired|lapsed)$/.test(value)) return 'expired';
  if (/^(sent|open|pending|issued|delivered)$/.test(value)) return 'sent';
  return null;
}
export function jobStatusFrom(text: string): string | null {
  const value = text.toLowerCase().replace(/[^a-z]+/g, ' ').trim();
  if (!value) return 'booked';
  if (/^(completed|complete|done|finished|closed)$/.test(value)) return 'completed';
  if (/^(cancelled|canceled|void)$/.test(value)) return 'cancelled';
  if (/^(in progress|started|working|active|ongoing)$/.test(value)) return 'in_progress';
  if (value === 'invoiced') return 'invoiced';
  if (value === 'paid') return 'paid';
  if (/^(scheduled|booked|pending|open|new|upcoming|confirmed)$/.test(value)) return 'booked';
  return null;
}
export function employeeStatusFrom(text: string): 'active' | 'inactive' | null {
  const value = text.toLowerCase().replace(/[^a-z]+/g, ' ').trim();
  if (!value || /^(active|yes|y|true|current|employed)$/.test(value)) return 'active';
  if (/^(inactive|no|n|false|former|terminated|left|archived)$/.test(value)) return 'inactive';
  return null;
}

/** A stable id for an imported quote or invoice, so importing the same file twice never creates it twice. */
export function importRequestId(tenantId: string, kind: string, parts: string[]): string {
  const hex = createHash('sha1').update([tenantId, kind, ...parts].join('|')).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export function customerLookupKeys(ref: CustomerRef): string[] {
  const keys: string[] = [];
  if (ref.email) keys.push(`e:${ref.email.toLowerCase()}`);
  const digits = digitsOnly(ref.phone);
  if (digits.length >= 7) keys.push(`p:${digits.slice(-10)}`);
  if (ref.name) keys.push(`n:${ref.name.toLowerCase().replace(/\s+/g, ' ')}`);
  return keys;
}

function reader(sheet: ParsedSheet, mapping: Record<string, string>, row: string[]) {
  const columns = new Map<string, number[]>();
  const notes: string[] = [];
  for (const [index, field] of Object.entries(mapping)) {
    const position = Number(index);
    if (!Number.isInteger(position) || position < 0 || position >= sheet.headers.length) continue;
    if (field === 'ignore') continue;
    const value = clean(row[position], 2000);
    if (field === 'notes') { if (value) notes.push(`${sheet.headers[position]}: ${value}`); continue; }
    columns.set(field, [...(columns.get(field) ?? []), position]);
  }
  return {
    get: (field: string) => (columns.get(field) ?? []).map((position) => clean(row[position], 2000)).find(Boolean) ?? '',
    has: (field: string) => columns.has(field),
    notes,
  };
}

function ref(read: ReturnType<typeof reader>): CustomerRef {
  return { name: clean(read.get('customerName'), 255), email: validEmail(read.get('customerEmail')) ?? '', phone: normalizePhoneNumber(read.get('customerPhone')) };
}

function moneyField(read: ReturnType<typeof reader>, field: string, issues: string[], label: string): number | null {
  const text = read.get(field);
  if (!text) return null;
  const value = parseMoney(text);
  if (value === null) { issues.push(`${label} “${text}” is not an amount.`); return null; }
  return value;
}

export function buildCandidates(tenantId: string, sheets: ParsedSheet[], decisions: SheetDecision[]): Candidate[] {
  const candidates: Candidate[] = [];
  const byId = new Map(sheets.map((sheet) => [sheet.id, sheet]));
  for (const decision of decisions) {
    const sheet = byId.get(decision.id);
    if (!sheet || decision.kind === 'ignore') continue;
    const kind = decision.kind;
    sheet.rows.forEach((row, rowIndex) => {
      const read = reader(sheet, decision.mapping, row);
      const base = { key: `${sheet.id}#${rowIndex}`, kind, sheetId: sheet.id, fileName: sheet.fileName, row: rowIndex + 2 };
      const issues: string[] = [];
      if (kind === 'customers' || kind === 'employees') {
        const name = clean(read.get('name') || splitName(read.get('firstName'), read.get('lastName')), 255);
        const rawEmail = read.get('email'); const email = validEmail(rawEmail);
        if (rawEmail && !email) issues.push(`Email “${rawEmail}” does not look valid, so it was left out.`);
        const rawPhone = read.get('phone'); const phone = normalizePhoneNumber(rawPhone);
        if (rawPhone && !phone) issues.push(`Phone “${rawPhone}” does not look valid, so it was left out.`);
        let blocking = false;
        if (!name) { issues.push('There is no name on this row.'); blocking = true; }
        if (kind === 'customers') {
          if (!phone) { issues.push('Connection Pilot needs a phone number for each customer, and this row has none.'); blocking = true; }
          const address = clean(read.get('address'), 1000); const company = clean(read.get('company'), 255);
          const data = { name, phone, email: email ?? '', address, company, notes: read.notes };
          const dupKey = email ? `e:${email}` : phone ? `p:${digitsOnly(phone).slice(-10)}` : `n:${name.toLowerCase()}`;
          candidates.push({ ...base, label: name || `Row ${base.row}`, display: { Name: name, Phone: phone, Email: email ?? '', Address: address }, issues, blocking, dupKey, data });
        } else {
          const role = clean(read.get('role'), 120); const statusText = read.get('status'); const status = employeeStatusFrom(statusText);
          if (statusText && !status) issues.push(`Status “${statusText}” was not understood, so this employee will be added as active.`);
          const data = { name, phone, email: email ?? '', role, status: status ?? 'active' };
          const dupKey = email ? `e:${email}` : phone ? `p:${digitsOnly(phone).slice(-10)}` : `n:${name.toLowerCase()}`;
          candidates.push({ ...base, label: name || `Row ${base.row}`, display: { Name: name, Role: role, Email: email ?? '', Phone: phone }, issues, blocking, dupKey, data });
        }
        return;
      }
      if (kind === 'services') {
        const name = clean(read.get('name'), 255);
        const priceText = read.get('price'); const price = priceText ? parseMoney(priceText) : null;
        let blocking = false;
        if (!name) { issues.push('There is no service or product name on this row.'); blocking = true; }
        if (price === null || price < 0) { issues.push(priceText ? `Price “${priceText}” is not an amount.` : 'There is no price on this row.'); blocking = true; }
        const unit = clean(read.get('unit'), 120).toLowerCase() || 'each';
        candidates.push({ ...base, label: name || `Row ${base.row}`, display: { Name: name, Price: price === null ? priceText : price.toFixed(2), Per: unit }, issues, blocking, dupKey: `n:${name.toLowerCase()}`, data: { name, price: price ?? 0, unit, details: clean(read.get('details'), 4000), notes: read.notes } });
        return;
      }
      const customer = ref(read);
      let blocking = false;
      if (!customer.name && !customer.email && !customer.phone) { issues.push('There is no customer on this row.'); blocking = true; }
      if (kind === 'jobs') {
        const service = clean(read.get('service'), 255);
        if (!service) { issues.push('There is no service or job description on this row.'); blocking = true; }
        const dateText = read.get('date'); const scheduledAt = dateText ? parseDate(dateText) : null;
        if (dateText && !scheduledAt) issues.push(`Date “${dateText}” was not understood, so this job will have no scheduled date.`);
        const statusText = read.get('status'); const status = jobStatusFrom(statusText);
        if (statusText && !status) issues.push(`Status “${statusText}” was not understood, so this job will be added as booked.`);
        const durationText = read.get('duration'); const duration = durationText ? Math.round(Number(durationText.replace(/[^0-9.]/g, ''))) : null;
        const employee = clean(read.get('employee'), 255); const address = clean(read.get('address'), 1000);
        candidates.push({ ...base, label: service || `Row ${base.row}`, display: { Customer: customer.name || customer.email || customer.phone, Service: service, Date: scheduledAt ? scheduledAt.toISOString().slice(0, 10) : dateText, Employee: employee, Status: status ?? 'booked' }, issues, blocking, dupKey: `${customerLookupKeys(customer)[0] ?? ''}|${service.toLowerCase()}|${scheduledAt?.toISOString() ?? ''}`, ref: customer, data: { service, address, employee, scheduledAt: scheduledAt?.toISOString() ?? null, duration: duration && duration > 0 && duration < 24 * 60 ? duration : null, status: status ?? 'booked', notes: read.notes } });
        return;
      }
      // quotes and invoices
      const number = clean(read.get('number'), 100);
      const dateText = read.get('date'); const date = dateText ? parseDate(dateText) : null;
      if (dateText && !date) issues.push(`Date “${dateText}” was not understood, so today’s date will be used.`);
      const laterField = kind === 'invoices' ? 'due' : 'expires';
      const laterText = read.get(laterField); const later = laterText ? parseDate(laterText) : null;
      if (laterText && !later) issues.push(`${fieldLabel(kind, laterField)} “${laterText}” was not understood, so it was left out.`);
      let total = moneyField(read, 'total', issues, 'Total'); const subtotalValue = moneyField(read, 'subtotal', issues, 'Subtotal'); let tax = moneyField(read, 'tax', issues, 'Tax');
      let subtotal = subtotalValue;
      if (total === null && subtotal !== null) total = subtotal + (tax ?? 0);
      if (total === null) { issues.push('There is no total amount on this row.'); blocking = true; }
      else {
        if (total < 0) { issues.push('Negative amounts cannot be imported.'); blocking = true; }
        if (subtotal === null) { subtotal = total - (tax ?? 0); }
        if (tax === null) tax = Math.max(0, total - subtotal);
        if (subtotal < 0 || tax < 0 || Math.abs(subtotal + tax - total) > 0.01) { issues.push('The subtotal, tax and total on this row do not add up, so the total is used with no separate tax.'); subtotal = total; tax = 0; }
      }
      const statusText = read.get('status');
      const status = kind === 'invoices' ? invoiceStatusFrom(statusText) : quoteStatusFrom(statusText);
      if (statusText && !status) issues.push(`Status “${statusText}” was not understood, so this will be added as a draft.`);
      const description = clean(read.get('description'), 800);
      const idParts = [number, customerLookupKeys(customer)[0] ?? '', date?.toISOString().slice(0, 10) ?? '', total === null ? '' : total.toFixed(2)];
      const word = kind === 'invoices' ? 'Invoice' : 'Quote';
      candidates.push({ ...base, label: number ? `${word} ${number}` : `${word} (row ${base.row})`, display: { Number: number, Customer: customer.name || customer.email || customer.phone, Date: date ? date.toISOString().slice(0, 10) : dateText, Total: total === null ? '' : total.toFixed(2), Status: status ?? 'draft' }, issues, blocking, dupKey: idParts.join('|'), ref: customer, data: { number, date: date?.toISOString() ?? null, later: later?.toISOString() ?? null, subtotal: subtotal ?? 0, tax: tax ?? 0, total: total ?? 0, status: status ?? 'draft', description, notes: read.notes, idParts } });
    });
  }
  return candidates;
}
