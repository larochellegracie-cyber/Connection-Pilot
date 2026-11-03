import { describe, expect, it } from 'vitest';
import { buildPlan, type PlanContext } from './plan';
import { suggestSheet } from './classify';
import type { ImportRequest, ParsedSheet, SheetDecision } from './types';

const TENANT = 'tenant-1';
const context = (overrides: Partial<PlanContext> = {}): PlanContext => ({ customers: [], employees: [], factKeys: new Set(), jobKeys: new Set(), quoteIds: new Set(), invoiceIds: new Set(), ...overrides });

function sheet(name: string, headers: string[], rows: string[][], fileName = `${name}.xlsx`): ParsedSheet { return { id: `${fileName}::${name}`, fileName, sheetName: name, headers, rows, truncated: false }; }
function decide(parsed: ParsedSheet): SheetDecision {
  const suggestion = suggestSheet(parsed);
  if (suggestion.kind === 'unknown' || suggestion.kind === 'schedule') return { id: parsed.id, kind: 'ignore', mapping: {} };
  return { id: parsed.id, kind: suggestion.kind, mapping: suggestion.mappings[suggestion.kind] ?? {} };
}
const request = (sheets: ParsedSheet[], recordChoices: ImportRequest['recordChoices'] = {}): ImportRequest => ({ sheets, decisions: sheets.map(decide), recordChoices });

const customers = sheet('Customers', ['Name', 'Phone', 'Email', 'Address'], [
  ['Jo Rivera', '(555) 010-0001', 'jo@example.com', '1 Main St'],
  ['Sam Lee', '555-010-0002', 'sam@example.com', ''],
  ['No Phone', '', 'nophone@example.com', ''],
  ['', '555-010-0004', '', ''],
]);

describe('import plan: numbers come from the files', () => {
  it('counts customers and flags rows that cannot be imported', () => {
    const { plan } = buildPlan(TENANT, request([customers]), context());
    const category = plan.categories.customers;
    expect(category.found).toBe(4);
    expect(category.willCreate).toBe(2);
    expect(category.needsAttention).toBe(2);
    expect(category.attention.map((item) => item.label)).toEqual(['No Phone', 'Row 5']);
    expect(category.attention[0].issues.join(' ')).toMatch(/phone number/);
    expect(plan.categories.invoices.found).toBe(0);
    expect(plan.willCreate).toBe(2);
  });

  it('reports nothing for categories that were not uploaded', () => {
    const { plan } = buildPlan(TENANT, request([customers]), context());
    for (const kind of ['employees', 'services', 'jobs', 'quotes', 'invoices'] as const) expect(plan.categories[kind]).toMatchObject({ found: 0, willCreate: 0, sample: [] });
  });

  it('cleans phone numbers and drops invalid emails with a warning', () => {
    const bad = sheet('Customers', ['Name', 'Phone', 'Email'], [['Jo', '555.010.0001', 'not-an-email']]);
    const { plan, items } = buildPlan(TENANT, request([bad]), context());
    expect(items[0].candidate.data).toMatchObject({ phone: '5550100001', email: '' });
    expect(plan.categories.customers.attention[0].issues[0]).toMatch(/does not look valid/);
    expect(plan.categories.customers.willCreate).toBe(1);
  });
});

describe('import plan: duplicates', () => {
  it('matches existing customers and keeps the existing one unless told otherwise', () => {
    const existing = context({ customers: [{ id: 'c-1', name: 'Jordan R', phone: '5550100001', email: 'old@example.com', address: null, company: null }] });
    const { plan, items } = buildPlan(TENANT, request([customers]), existing);
    const jo = items.find((row) => row.item.label === 'Jo Rivera')!;
    expect(jo.item.duplicate).toMatchObject({ type: 'existing', choice: 'skip', options: ['skip', 'update', 'create'] });
    expect(jo.item.action).toBe('skip');
    expect(jo.existingId).toBe('c-1');
    expect(plan.categories.customers.willCreate).toBe(1); // only Sam
  });

  it('lets the owner update the existing customer or create a new one', () => {
    const existing = context({ customers: [{ id: 'c-1', name: 'Jordan R', phone: '5550100001', email: null, address: null, company: null }] });
    const key = `${customers.id}#0`;
    expect(buildPlan(TENANT, request([customers], { [key]: 'update' }), existing).items[0].item.action).toBe('update');
    expect(buildPlan(TENANT, request([customers], { [key]: 'create' }), existing).items[0].item.action).toBe('create');
    expect(buildPlan(TENANT, request([customers], { [key]: 'merge' }), existing).items[0].item.duplicate?.choice).toBe('skip'); // not a valid choice here
  });

  it('flags repeats inside the files and never merges them on its own', () => {
    const repeated = sheet('Customers', ['Name', 'Phone', 'Email'], [['Jo Rivera', '5550100001', 'jo@example.com'], ['J. Rivera', '5550100002', 'jo@example.com'], ['Jo R', '5550100003', 'JO@example.com']]);
    const { plan, items } = buildPlan(TENANT, request([repeated]), context());
    expect(items.map((row) => row.item.action)).toEqual(['create', 'skip', 'skip']);
    expect(items[1].item.duplicate).toMatchObject({ type: 'file', options: ['skip', 'create', 'merge'], choice: 'skip' });
    expect(plan.categories.customers.willCreate).toBe(1);
    expect(plan.categories.customers.needsAttention).toBe(2);
  });

  it('keep both creates both, and merge fills blanks in the first copy', () => {
    const repeated = sheet('Customers', ['Name', 'Phone', 'Email', 'Address'], [['Jo Rivera', '5550100001', 'jo@example.com', ''], ['Jo Rivera', '5550100001', 'jo@example.com', '1 Main St']]);
    const keepBoth = buildPlan(TENANT, request([repeated], { [`${repeated.id}#1`]: 'create' }), context());
    expect(keepBoth.plan.categories.customers.willCreate).toBe(2);
    const merged = buildPlan(TENANT, request([repeated], { [`${repeated.id}#1`]: 'merge' }), context());
    expect(merged.plan.categories.customers.willCreate).toBe(1);
    expect(merged.items[0].candidate.data.address).toBe('1 Main St');
    expect(merged.items[1].item.reason).toBe('Merged into the first copy.');
  });
});

describe('import plan: employees, services, jobs and money', () => {
  it('imports employees and spots an existing one', () => {
    const staff = sheet('Staff', ['Employee', 'Role', 'Email'], [['Avery Duggan', 'Lead tech', 'avery@example.com'], ['Sam Lee', 'Cleaner', '']]);
    const { plan, items } = buildPlan(TENANT, request([staff]), context({ employees: [{ id: 'e-1', name: 'Avery Duggan', phone: null, email: 'avery@example.com', role: null, status: 'active' }] }));
    expect(plan.categories.employees).toMatchObject({ found: 2, willCreate: 1 });
    expect(items[0].item.duplicate?.description).toMatch(/Possible existing employee/);
  });

  it('turns a price list into services and skips ones already saved', () => {
    const prices = sheet('Prices', ['Service', 'Price', 'Unit'], [['Pool opening', '$250', 'visit'], ['Weekly cleaning', '120.50', ''], ['Mystery', 'ask', '']]);
    const { plan } = buildPlan(TENANT, request([prices]), context());
    expect(plan.categories.services).toMatchObject({ found: 3, willCreate: 2, needsAttention: 1 });
  });

  it('attaches invoices to imported customers and to existing ones, and refuses unknown customers', () => {
    const invoices = sheet('Invoices', ['Invoice #', 'Customer', 'Date', 'Amount', 'Status'], [
      ['1001', 'Jo Rivera', '2024-03-05', '$1,250.00', 'Paid'],
      ['1002', 'Jordan Existing', '03/06/2024', '300', 'Unpaid'],
      ['1003', 'Nobody Known', '2024-03-07', '99', 'Overdue'],
    ]);
    const existing = context({ customers: [{ id: 'c-9', name: 'Jordan Existing', phone: '5559990000', email: null, address: null, company: null }] });
    const { plan, items } = buildPlan(TENANT, request([customers, invoices]), existing);
    expect(plan.categories.invoices).toMatchObject({ found: 3, willCreate: 2, skipped: 1, needsAttention: 1 });
    expect(items.find((row) => row.item.label === 'Invoice 1001')!.customer).toEqual({ newKey: `${customers.id}#0` });
    expect(items.find((row) => row.item.label === 'Invoice 1002')!.customer).toEqual({ existingId: 'c-9' });
    const missing = items.find((row) => row.item.label === 'Invoice 1003')!;
    expect(missing.item.problem).toBe(true);
    expect(missing.item.reason).toMatch(/No customer named/);
    expect(plan.categories.invoices.notes.join(' ')).toMatch(/also record a payment/);
  });

  it('keeps the file’s own total and tax, and flags totals that do not add up', () => {
    const invoices = sheet('Invoices', ['Invoice #', 'Customer', 'Subtotal', 'Tax', 'Total'], [['1', 'Jo Rivera', '100', '13', '113'], ['2', 'Jo Rivera', '100', '13', '200']]);
    const { items } = buildPlan(TENANT, request([customers, invoices]), context());
    const [good, bad] = items.filter((row) => row.candidate.kind === 'invoices');
    expect(good.candidate.data).toMatchObject({ subtotal: 100, tax: 13, total: 113 });
    expect(bad.candidate.data).toMatchObject({ subtotal: 200, tax: 0, total: 200 });
    expect(bad.item.issues[0]).toMatch(/do not add up/);
  });

  it('does not import an invoice or job twice when the same file is uploaded again', () => {
    const invoices = sheet('Invoices', ['Invoice #', 'Customer', 'Date', 'Amount'], [['1001', 'Jo Rivera', '2024-03-05', '50']]);
    const first = buildPlan(TENANT, request([customers, invoices]), context());
    const requestId = first.items.find((row) => row.candidate.kind === 'invoices')!.requestId!;
    const again = buildPlan(TENANT, request([customers, invoices]), context({ invoiceIds: new Set([requestId]) }));
    expect(again.plan.categories.invoices).toMatchObject({ willCreate: 0, skipped: 1 });
    expect(again.items.find((row) => row.candidate.kind === 'invoices')!.item.reason).toMatch(/already imported/);

    const jobs = sheet('Jobs', ['Customer', 'Service', 'Date', 'Status'], [['Jordan Existing', 'Pool opening', '2024-05-01', 'Completed']]);
    const existing = context({ customers: [{ id: 'c-9', name: 'Jordan Existing', phone: '5559990000', email: null, address: null, company: null }] });
    const planned = buildPlan(TENANT, request([jobs]), existing);
    expect(planned.plan.categories.jobs.willCreate).toBe(1);
    const scheduledAt = planned.items[0].candidate.data.scheduledAt as string;
    const repeat = buildPlan(TENANT, request([jobs]), { ...existing, jobKeys: new Set([`c-9|pool opening|${scheduledAt}`]) });
    expect(repeat.plan.categories.jobs).toMatchObject({ willCreate: 0, skipped: 1 });
  });

  it('is built only from the request and the tenant context it is given', () => {
    const a = buildPlan('tenant-a', request([customers]), context());
    const b = buildPlan('tenant-b', request([customers]), context({ customers: [{ id: 'c-1', name: 'Jo Rivera', phone: '5550100001', email: 'jo@example.com', address: null, company: null }] }));
    expect(a.plan.categories.customers.willCreate).toBe(2);
    expect(b.plan.categories.customers.willCreate).toBe(1);
  });
});
