import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';

const state = vi.hoisted(() => ({ queue: [] as unknown[][], updates: [] as unknown[], inserts: [] as unknown[] }));
const mocks = vi.hoisted(() => ({ tenantId: 'biz-1', planAllowed: true, sendInvoiceEmail: vi.fn(), customerRoute: vi.fn(), draftHandler: vi.fn(), copyHandler: vi.fn(), financeRoute: vi.fn() }));
vi.mock('#airo/secrets', () => ({ getSecret: (name: string) => (name === 'BETTER_AUTH_SECRET' ? 'test-secret-value-1234567890' : undefined) }));
vi.mock('@/server/db/client.js', async () => ({ db: (await import('@/test/db-mock')).buildDb(state) }));
vi.mock('@/server/api/customers/tenant.js', () => ({
  getTenant: vi.fn(async () => ({ id: mocks.tenantId, businessName: 'Somerset Pool', businessType: 'service' })),
  textValue: (value: unknown, max = 255) => (typeof value === 'string' ? value.trim().slice(0, max) : ''),
  normalizePhone: (value: string) => value.replace(/[^0-9+]/g, ''),
}));
vi.mock('@/server/plan-access.js', () => ({ requirePlanFeature: vi.fn(async () => (mocks.planAllowed ? { allowed: true } : { allowed: false, error: 'This feature requires an upgraded plan.' })) }));
vi.mock('@/server/api/calendar/shared.js', () => ({ getCalendarSettings: vi.fn(async () => ({ timezone: 'America/Toronto' })), assertSchedulingAvailability: vi.fn(), findNextAvailableSlots: vi.fn(async () => []) }));
vi.mock('@/server/appointment-notifications.js', () => ({ createAppointmentChangeNotification: vi.fn() }));
vi.mock('@/server/api/customers/activity.js', () => ({ logCustomerActivity: vi.fn() }));
vi.mock('@/server/finance/send-invoice.js', () => ({ sendInvoiceEmail: mocks.sendInvoiceEmail, invoiceNumber: (id: string) => `INV-${id.slice(0, 8).toUpperCase()}` }));
vi.mock('@/server/api/schedules/copy-previous/POST.js', () => ({ default: mocks.copyHandler }));
vi.mock('@/server/api/schedules/pilot-draft/POST.js', () => ({ default: mocks.draftHandler }));
vi.mock('@/server/api/customers/POST.js', () => ({ default: mocks.customerRoute }));
vi.mock('@/server/api/finance/POST.js', () => ({ default: mocks.financeRoute }));
vi.mock('@/server/api/jobs/POST.js', () => ({ default: vi.fn() }));
vi.mock('@/server/api/leads/POST.js', () => ({ default: vi.fn() }));
vi.mock('@/server/api/finance/estimates/[estimateId]/send/POST.js', () => ({ default: vi.fn() }));
vi.mock('@/server/api/schedules/[scheduleId]/PATCH.js', () => ({ default: vi.fn() }));
vi.mock('@/server/api/schedules/[scheduleId]/email/POST.js', () => ({ default: vi.fn() }));

import handler from './POST';
import { createActionTools } from '@/server/pilot/action-tools';
import { forModel, type PendingCard } from '@/server/pilot/chat-actions';
import { createConfirmation, resetRedeemedForTests } from '@/server/pilot/confirmations';

const respond = () => ({ statusCode: 200, body: undefined as unknown, status(code: number) { this.statusCode = code; return this; }, json(payload: unknown) { this.body = payload; return this; } });
const post = async (body: unknown) => { const res = respond(); await handler({ body, headers: { cookie: 'session=abc' } } as unknown as Request, res as unknown as Response); return res; };
const cooper = { id: 'cust-1', name: 'Cooper Bulmer', email: 'cooper@example.com' };
const invoiceRows = [{ id: '11111111-aaaa-4aaa-8aaa-111111111111', status: 'draft', total: '450.00', createdAt: new Date('2026-10-18'), jobService: 'pool cleaning' }];
const lines = [{ invoiceId: invoiceRows[0].id, description: 'Weekly pool cleaning' }];

/** Prepare an invoice send the way the chat does, and return the ticket the owner's Confirm button would use. */
async function prepareInvoice() {
  const cards: PendingCard[] = [];
  const tools = forModel(createActionTools({ tenantId: 'biz-1', businessName: 'Somerset Pool', businessType: 'service', request: { headers: {} } }), { tenantId: 'biz-1', canConfirm: true, onCard: (card) => cards.push(card) }) as Record<string, any>;
  state.queue.push([cooper], invoiceRows, lines);
  await tools.sendInvoice.execute({ customerName: 'Cooper', invoiceDescription: 'pool cleaning' }, { toolCallId: 't', messages: [] });
  return cards[0].token;
}

beforeEach(() => {
  state.queue.length = 0; state.inserts.length = 0; resetRedeemedForTests();
  mocks.tenantId = 'biz-1'; mocks.planAllowed = true;
  for (const key of ['sendInvoiceEmail', 'customerRoute', 'draftHandler', 'copyHandler', 'financeRoute'] as const) mocks[key].mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('POST /api/chat/confirm', () => {
  it('sends the invoice only when the owner confirms, and reports the real result', async () => {
    const token = await prepareInvoice();
    expect(mocks.sendInvoiceEmail).not.toHaveBeenCalled();
    state.queue.push([cooper], invoiceRows, lines);
    mocks.sendInvoiceEmail.mockResolvedValue({ ok: true, messageId: 'm1', sentTo: 'cooper@example.com', invoiceNumber: 'INV-11111111' });
    const res = await post({ token, decision: 'confirm' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, message: 'Invoice INV-11111111 was emailed to cooper@example.com.', link: { label: 'Open invoices', href: '/finance' } });
    expect(mocks.sendInvoiceEmail).toHaveBeenCalledTimes(1);
    expect(mocks.sendInvoiceEmail).toHaveBeenCalledWith({ id: 'biz-1', businessName: 'Somerset Pool' }, invoiceRows[0].id);
  });

  it('does not run twice if the button is pressed again', async () => {
    const token = await prepareInvoice();
    state.queue.push([cooper], invoiceRows, lines);
    mocks.sendInvoiceEmail.mockResolvedValue({ ok: true, messageId: 'm1', sentTo: 'cooper@example.com', invoiceNumber: 'INV-11111111' });
    await post({ token, decision: 'confirm' });
    state.queue.push([cooper], invoiceRows, lines);
    const again = await post({ token, decision: 'confirm' });
    expect(again.statusCode).toBe(409);
    expect(again.body).toMatchObject({ ok: false, message: expect.stringMatching(/already confirmed once/) });
    expect(mocks.sendInvoiceEmail).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the owner cancels, and the ticket cannot be used afterwards', async () => {
    const token = await prepareInvoice();
    const cancelled = await post({ token, decision: 'cancel' });
    expect(cancelled.body).toMatchObject({ ok: true, cancelled: true, message: 'Cancelled. Nothing was changed.' });
    const late = await post({ token, decision: 'confirm' });
    expect(late.statusCode).toBe(409);
    expect(mocks.sendInvoiceEmail).not.toHaveBeenCalled();
  });

  it('says plainly that nothing was sent when email is not set up', async () => {
    const token = await prepareInvoice();
    state.queue.push([cooper], invoiceRows, lines);
    mocks.sendInvoiceEmail.mockResolvedValue({ ok: false, status: 503, error: 'Email sending isn’t configured yet, so nothing was sent.', setupRequired: true });
    const res = await post({ token, decision: 'confirm' });
    expect(res.statusCode).toBe(422);
    expect(res.body).toMatchObject({ ok: false });
    expect((res.body as { message: string }).message).toMatch(/^The invoice was NOT sent\. Email sending isn’t configured yet/);
  });

  it('refuses a ticket from another business, a forged ticket and a missing ticket', async () => {
    const token = await prepareInvoice();
    mocks.tenantId = 'biz-2';
    const other = await post({ token, decision: 'confirm' });
    expect(other.statusCode).toBe(403);
    mocks.tenantId = 'biz-1';
    expect((await post({ token: `${token.slice(0, -3)}abc`, decision: 'confirm' })).statusCode).toBe(400);
    expect((await post({ decision: 'confirm' })).statusCode).toBe(400);
    expect((await post({ token: 'x.y', decision: 'confirm' })).statusCode).toBe(400);
    expect(mocks.sendInvoiceEmail).not.toHaveBeenCalled();
  });

  it('rejects an expired ticket', async () => {
    const stale = createConfirmation('biz-1', { tool: 'sendInvoice', input: { customerName: 'Cooper' } }, Date.now() - 20 * 60 * 1000);
    const res = await post({ token: stale, decision: 'confirm' });
    expect(res.statusCode).toBe(400);
    expect((res.body as { message: string }).message).toMatch(/expired/);
  });

  it('never runs a tool that is not a confirmable action', async () => {
    const ticket = createConfirmation('biz-1', { tool: 'searchCustomers', input: { query: 'x' } });
    expect((await post({ token: ticket, decision: 'confirm' })).statusCode).toBe(400);
    const missing = createConfirmation('biz-1', { tool: 'deleteEverything', input: {} });
    expect((await post({ token: missing, decision: 'confirm' })).statusCode).toBe(400);
  });

  it('creates a customer through the same route the screen uses, only after confirmation', async () => {
    const ticket = createConfirmation('biz-1', { tool: 'createCustomer', input: { name: 'Sarah Johnson', phoneNumber: '5550100022', email: 'sarah@example.com' } });
    state.queue.push([]); // no duplicate
    mocks.customerRoute.mockImplementation(async (_req: unknown, res: { status: (code: number) => { json: (body: unknown) => void } }) => { res.status(201).json({ customer: { id: 'new-1' } }); });
    const res = await post({ token: ticket, decision: 'confirm' });
    expect(mocks.customerRoute).toHaveBeenCalledTimes(1);
    expect(res.body).toMatchObject({ ok: true, link: { label: 'Open customer', href: '/dashboard/customers/new-1' } });
  });

  it('reports a failed action as a failure with the real reason', async () => {
    const ticket = createConfirmation('biz-1', { tool: 'createCustomer', input: { name: 'Sarah Johnson', phoneNumber: '5550100022' } });
    state.queue.push([]);
    mocks.customerRoute.mockImplementation(async (_req: unknown, res: { status: (code: number) => { json: (body: unknown) => void } }) => { res.status(409).json({ error: 'A customer profile with this phone number or email already exists.' }); });
    const res = await post({ token: ticket, decision: 'confirm' });
    expect(res.statusCode).toBe(422);
    expect(res.body).toMatchObject({ ok: false, message: 'The customer was NOT created. A customer profile with this phone number or email already exists.' });
  });

  it('builds the schedule draft only after confirmation, applying each requested change', async () => {
    const ticket = createConfirmation('biz-1', { tool: 'draftSchedule', input: { week: 'next', copyPreviousWeek: true, changes: ['Add Avery Tuesday-Friday 8-5', 'Avery off Friday'] } });
    const ok = (body: Record<string, unknown>) => async (_req: unknown, res: { status: (code: number) => { json: (body: unknown) => void } }) => { res.status(200).json(body); };
    mocks.copyHandler.mockImplementation(ok({ copied: 6 }));
    mocks.draftHandler.mockImplementation(ok({ created: 4, skipped: 0 }));
    const res = await post({ token: ticket, decision: 'confirm' });
    expect(mocks.copyHandler).toHaveBeenCalledTimes(1);
    expect(mocks.draftHandler).toHaveBeenCalledTimes(2);
    expect(res.body).toMatchObject({ ok: true, link: { label: 'Open scheduling', href: '/scheduling' } });
    expect((res.body as { message: string }).message).toMatch(/Draft schedule saved.*not been published or sent/);
  });

  it('is limited to plans that include Pilot', async () => {
    mocks.planAllowed = false;
    const res = await post({ token: 'x', decision: 'confirm' });
    expect(res.statusCode).toBe(403);
  });
});
