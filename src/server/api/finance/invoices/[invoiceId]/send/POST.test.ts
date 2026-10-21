import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';

const state = vi.hoisted(() => ({ queue: [] as unknown[][], updates: [] as unknown[], inserts: [] as unknown[], failWrites: false }));
vi.mock('@/server/db/client.js', async () => ({ db: (await import('@/test/db-mock')).buildDb(state) }));
vi.mock('../../../../customers/tenant.js', () => ({
  getTenant: vi.fn(async () => ({ id: 'biz-1', businessName: 'Somerset Pool', businessType: 'service' })),
  textValue: (value: unknown, max = 255) => (typeof value === 'string' ? value.trim().slice(0, max) : ''),
}));

import handler, { invoiceNumber } from './POST';

const KEY = 're_secret_key_for_tests';
const invoiceRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'abcd1234-0000-0000-0000-000000000000', customerId: 'cust-1', customerName: 'Cooper Bulmer', customerEmail: 'cooper@example.com', jobId: 'job-1',
  subtotal: '141.00', taxTotal: '18.30', total: '159.30', notes: null, createdAt: new Date('2026-10-18T03:19:00Z'), dueAt: null, status: 'draft', ...overrides,
});
const lineItems = [{ description: 'Pool cleaning', quantity: '1.00', unitPrice: '141.00', subtotal: '141.00' }];
const branding = [{ businessName: 'Somerset Pool service', businessEmail: 'hello@somerset.example', phoneNumber: null, logoUrl: null, brandColors: null }];

function respond() { return { statusCode: 200, body: undefined as unknown, status(code: number) { this.statusCode = code; return this; }, json(payload: unknown) { this.body = payload; return this; } }; }
const send = () => ({ params: { invoiceId: 'abcd1234-0000-0000-0000-000000000000' } }) as unknown as Request;
const queueFor = (record: unknown, payments: unknown[] = []) => { state.queue.push(record ? [record] : [], lineItems, payments, branding); };

describe('POST /api/finance/invoices/:invoiceId/send', () => {
  beforeEach(() => {
    state.queue.length = 0; state.updates.length = 0; state.inserts.length = 0; state.failWrites = false;
    process.env.RESEND_API_KEY = KEY;
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => { delete process.env.RESEND_API_KEY; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('emails the invoice to the customer through Resend and marks a draft as sent', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'msg_42' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    queueFor(invoiceRow(), [{ amount: '59.30', status: 'completed' }, { amount: '500', status: 'pending' }]);
    const res = respond();
    await handler(send(), res as unknown as Response);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, messageId: 'msg_42', sentTo: 'cooper@example.com', invoiceNumber: 'INV-ABCD1234' });
    const sent = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body));
    expect(sent.to).toEqual(['cooper@example.com']);
    expect(sent.subject).toBe('Somerset Pool service invoice INV-ABCD1234');
    expect(sent.text).toContain('Pool cleaning');
    expect(sent.text).toContain('$100.00'); // 159.30 total minus the 59.30 completed payment; the pending one is ignored
    expect(state.updates).toEqual([{ status: 'sent' }]);
    expect(state.inserts[0]).toMatchObject({ customerId: 'cust-1', title: 'Invoice sent' });
  });

  it('never exposes the API key in the response or the logs', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: `bad key ${KEY}` }), { status: 401 })));
    const logged = vi.spyOn(console, 'error');
    queueFor(invoiceRow());
    const res = respond();
    await handler(send(), res as unknown as Response);
    expect(JSON.stringify(res.body)).not.toContain(KEY);
    expect(JSON.stringify(logged.mock.calls)).not.toContain(KEY);
  });

  it('leaves a sent invoice as it is when it is resent', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'msg_43' }), { status: 200 })));
    queueFor(invoiceRow({ status: 'sent' }));
    const res = respond();
    await handler(send(), res as unknown as Response);
    expect(res.statusCode).toBe(200);
    expect(state.updates).toEqual([]);
  });

  it('says clearly that nothing was sent when email is not set up, and changes nothing', async () => {
    delete process.env.RESEND_API_KEY;
    queueFor(invoiceRow());
    const res = respond();
    await handler(send(), res as unknown as Response);
    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({ setupRequired: true });
    expect((res.body as { error: string }).error).toMatch(/nothing was sent/i);
    expect(state.updates).toEqual([]);
    expect(state.inserts).toEqual([]);
  });

  it('reports the provider’s reason when Resend rejects the message, and changes nothing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: 'domain not verified' }), { status: 403 })));
    queueFor(invoiceRow());
    const res = respond();
    await handler(send(), res as unknown as Response);
    expect(res.statusCode).toBe(502);
    expect((res.body as { error: string }).error).toContain('domain not verified');
    expect(state.updates).toEqual([]);
  });

  it('still reports success when the email went out but recording it failed, so the owner does not resend', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'msg_44' }), { status: 200 })));
    queueFor(invoiceRow());
    state.failWrites = true;
    const res = respond();
    await handler(send(), res as unknown as Response);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, messageId: 'msg_44' });
  });

  it.each([
    ['a customer with no email address', { customerEmail: null }, 400, /valid email address/],
    ['a customer with an invalid email address', { customerEmail: 'not-an-email' }, 400, /valid email address/],
    ['a void invoice', { status: 'void' }, 400, /void invoice cannot be sent/],
  ])('refuses %s before contacting Resend', async (_label, overrides, status, message) => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    queueFor(invoiceRow(overrides));
    const res = respond();
    await handler(send(), res as unknown as Response);
    expect(res.statusCode).toBe(status);
    expect((res.body as { error: string }).error).toMatch(message);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 404 for an invoice that is not in this business', async () => {
    vi.stubGlobal('fetch', vi.fn());
    state.queue.push([]);
    const res = respond();
    await handler(send(), res as unknown as Response);
    expect(res.statusCode).toBe(404);
  });

  it('numbers invoices from their id', () => {
    expect(invoiceNumber('abcd1234-ffff')).toBe('INV-ABCD1234');
  });
});
