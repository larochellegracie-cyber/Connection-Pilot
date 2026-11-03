import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ queue: [] as unknown[][], updates: [] as unknown[], inserts: [] as unknown[], failWrites: false }));
vi.mock('@/server/db/client.js', async () => ({ db: (await import('@/test/db-mock')).buildDb(state) }));

import { runImport } from './commit';
import { suggestSheet } from './classify';
import type { ParsedSheet } from './types';

const sheet = (name: string, headers: string[], rows: string[][]): ParsedSheet => ({ id: `${name}.csv::${name}`, fileName: `${name}.csv`, sheetName: name, headers, rows, truncated: false });
const decision = (parsed: ParsedSheet) => { const s = suggestSheet(parsed); return { id: parsed.id, kind: s.kind as 'customers', mapping: s.mappings[s.kind as 'customers'] ?? {} }; };
const emptyContext = () => { state.queue = [[], [], [], [], [], []]; };

const customers = sheet('Customers', ['Name', 'Phone', 'Email'], [['Jo Rivera', '5550100001', 'jo@example.com'], ['Sam Lee', '5550100002', 'sam@example.com']]);
const invoices = sheet('Invoices', ['Invoice #', 'Customer', 'Date', 'Amount', 'Status'], [['1001', 'Jo Rivera', '2024-03-05', '250', 'Paid'], ['1002', 'Nobody', '2024-03-06', '10', 'Open']]);

describe('running a confirmed import', () => {
  beforeEach(() => { state.inserts = []; state.updates = []; state.failWrites = false; emptyContext(); });

  it('writes what the plan said, reports honest counts, and lists what was left out', async () => {
    const result = await runImport('tenant-1', { sheets: [customers, invoices], decisions: [decision(customers), decision(invoices)] });
    expect(result.imported).toMatchObject({ customers: 2, invoices: 1, jobs: 0, quotes: 0, employees: 0, services: 0 });
    expect(result.issues).toEqual([expect.objectContaining({ kind: 'invoices', label: 'Invoice 1002', reason: expect.stringMatching(/No customer named/) })]);
    expect(result.failed).toEqual([]);
    const rows = state.inserts as Array<Record<string, unknown>>;
    expect(rows.filter((row) => row.businessProfileId === 'tenant-1' && row.phoneNumber).map((row) => row.name)).toEqual(['Jo Rivera', 'Sam Lee']);
    const invoice = rows.find((row) => row.clientRequestId) as Record<string, unknown>;
    expect(invoice).toMatchObject({ businessProfileId: 'tenant-1', status: 'paid', total: '250.00' });
    // a paid invoice records the matching payment
    expect(rows.find((row) => row.method === 'Imported')).toMatchObject({ amount: '250.00', status: 'completed', invoiceId: invoice.id });
    expect(rows.find((row) => row.description === 'Invoice 1001')).toMatchObject({ invoiceId: invoice.id, quantity: '1.00', total: '250.00' });
  });

  it('never claims success when the database refuses the writes', async () => {
    state.failWrites = true;
    const result = await runImport('tenant-1', { sheets: [customers], decisions: [decision(customers)] });
    expect(result.imported.customers).toBe(0);
    expect(result.failed).toEqual([{ kind: 'customers', message: 'write failed' }]);
  });

  it('imports nothing for a category when every row was skipped', async () => {
    emptyContext();
    state.queue[0] = [{ id: 'c-1', name: 'Jo Rivera', phone: '5550100001', email: 'jo@example.com', address: null, company: null }, { id: 'c-2', name: 'Sam Lee', phone: '5550100002', email: 'sam@example.com', address: null, company: null }];
    const result = await runImport('tenant-1', { sheets: [customers], decisions: [decision(customers)] });
    expect(result.imported.customers).toBe(0);
    expect(state.inserts).toEqual([]);
  });
});
