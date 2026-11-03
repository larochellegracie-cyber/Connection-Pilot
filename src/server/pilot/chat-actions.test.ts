import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ queue: [] as unknown[][], updates: [] as unknown[], inserts: [] as unknown[] }));
const mocks = vi.hoisted(() => ({ sendInvoiceEmail: vi.fn(), copyHandler: vi.fn(), draftHandler: vi.fn(), customerRoute: vi.fn(), jobRoute: vi.fn(), financeRoute: vi.fn(), quoteSend: vi.fn() }));
vi.mock('#airo/secrets', () => ({ getSecret: (name: string) => (name === 'BETTER_AUTH_SECRET' ? 'test-secret-value-1234567890' : undefined) }));
vi.mock('@/server/db/client.js', async () => ({ db: (await import('@/test/db-mock')).buildDb(state) }));
vi.mock('@/server/api/calendar/shared.js', () => ({ getCalendarSettings: vi.fn(async () => ({ timezone: 'America/Toronto' })), assertSchedulingAvailability: vi.fn(async () => undefined), findNextAvailableSlots: vi.fn(async () => []) }));
vi.mock('@/server/appointment-notifications.js', () => ({ createAppointmentChangeNotification: vi.fn() }));
vi.mock('@/server/api/customers/activity.js', () => ({ logCustomerActivity: vi.fn() }));
vi.mock('@/server/finance/send-invoice.js', () => ({ sendInvoiceEmail: mocks.sendInvoiceEmail, invoiceNumber: (id: string) => `INV-${id.slice(0, 8).toUpperCase()}` }));
vi.mock('@/server/api/schedules/copy-previous/POST.js', () => ({ default: mocks.copyHandler }));
vi.mock('@/server/api/schedules/pilot-draft/POST.js', () => ({ default: mocks.draftHandler }));
vi.mock('@/server/api/customers/POST.js', () => ({ default: mocks.customerRoute }));
vi.mock('@/server/api/jobs/POST.js', () => ({ default: mocks.jobRoute }));
vi.mock('@/server/api/finance/POST.js', () => ({ default: mocks.financeRoute }));
vi.mock('@/server/api/leads/POST.js', () => ({ default: vi.fn() }));
vi.mock('@/server/api/finance/estimates/[estimateId]/send/POST.js', () => ({ default: mocks.quoteSend }));
vi.mock('@/server/api/schedules/[scheduleId]/PATCH.js', () => ({ default: vi.fn() }));
vi.mock('@/server/api/schedules/[scheduleId]/email/POST.js', () => ({ default: vi.fn() }));

import { createActionTools } from './action-tools';
import { forModel, linksFor, statusFor, type PendingCard } from './chat-actions';
import { redeemConfirmation, resetRedeemedForTests } from './confirmations';

const request = { headers: { cookie: 'session=abc' } };
const cooper = { id: 'cust-1', name: 'Cooper Bulmer', email: 'cooper@example.com', phoneNumber: '5550100001' };
const invoiceRows = [{ id: '11111111-aaaa-4aaa-8aaa-111111111111', status: 'draft', total: '450.00', createdAt: new Date('2026-10-18'), jobService: 'pool cleaning' }];
const lines = [{ invoiceId: invoiceRows[0].id, description: 'Weekly pool cleaning' }];

function build(canConfirm = true) {
  const cards: PendingCard[] = [];
  const tools = forModel(createActionTools({ tenantId: 'biz-1', businessName: 'Somerset Pool', businessType: 'service', request, now: () => new Date('2026-10-21T15:00:00Z') }), { tenantId: 'biz-1', canConfirm, onCard: (card) => cards.push(card) }) as Record<string, any>;
  const run = async (name: string, input: Record<string, unknown>) => { const parsed = tools[name].inputSchema.parse(input); return tools[name].execute(parsed, { toolCallId: 't', messages: [] }) as Promise<Record<string, any>>; };
  return { tools, cards, run };
}

beforeEach(() => {
  state.queue.length = 0; state.inserts.length = 0; state.updates.length = 0; resetRedeemedForTests();
  for (const mock of Object.values(mocks)) mock.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('the AI model can only prepare actions, never confirm them', () => {
  it('has no way to say "confirmed" on any write tool', () => {
    const { tools } = build();
    for (const name of ['sendInvoice', 'sendQuote', 'draftSchedule', 'createCustomer', 'createJob', 'createQuote', 'createInvoice', 'recordPayment', 'changeAppointment', 'updateCustomer', 'publishSchedule', 'sendSchedule']) {
      expect(Object.keys(tools[name].inputSchema.shape), name).not.toContain('confirmed');
    }
  });

  it('shows a confirmation card for "send Cooper his invoice" and sends nothing', async () => {
    const { run, cards } = build();
    state.queue.push([cooper], invoiceRows, lines);
    const result = await run('sendInvoice', { customerName: 'Cooper', invoiceDescription: 'pool cleaning' });
    expect(result).toMatchObject({ ok: false, awaitingOwnerConfirmation: true, preparedAction: 'Email invoice to Cooper Bulmer' });
    expect(JSON.stringify(result)).not.toContain(cards[0].token); // the model never sees the ticket
    expect(cards).toHaveLength(1);
    expect(cards[0].card).toMatchObject({ title: 'Email invoice to Cooper Bulmer', confirmLabel: 'Send invoice', progressLabel: 'Sending the invoice…' });
    expect(cards[0].card.lines).toEqual(expect.arrayContaining(['Total: $450.00', 'Sent to: cooper@example.com']));
    expect(mocks.sendInvoiceEmail).not.toHaveBeenCalled();
  });

  it('ignores an attempt to smuggle confirmed=true through the model', async () => {
    const { tools, cards } = build();
    state.queue.push([cooper], invoiceRows, lines);
    const result = await tools.sendInvoice.execute({ customerName: 'Cooper', invoiceDescription: 'pool cleaning', confirmed: true }, { toolCallId: 't', messages: [] });
    expect(result).toMatchObject({ awaitingOwnerConfirmation: true });
    expect(mocks.sendInvoiceEmail).not.toHaveBeenCalled();
    expect(cards).toHaveLength(1);
  });

  it('the ticket in the card runs the real action only when redeemed, with the same details', async () => {
    const { run, cards } = build();
    state.queue.push([cooper], invoiceRows, lines);
    await run('sendInvoice', { customerName: 'Cooper', invoiceDescription: 'pool cleaning' });
    const redeemed = redeemConfirmation(cards[0].token, 'biz-1');
    expect(redeemed).toMatchObject({ ok: true, action: { tool: 'sendInvoice', input: { customerName: 'Cooper', invoiceDescription: 'pool cleaning' } } });
    expect(redeemConfirmation(cards[0].token, 'biz-2')).toMatchObject({ ok: false });
  });

  it('explains plainly when a window cannot show confirmation buttons', async () => {
    const { run, cards } = build(false);
    state.queue.push([cooper], invoiceRows, lines);
    const result = await run('sendInvoice', { customerName: 'Cooper', invoiceDescription: 'pool cleaning' });
    expect(result).toMatchObject({ ok: false });
    expect(result.message).toMatch(/cannot show confirmation buttons, so nothing was done/);
    expect(cards).toEqual([]);
  });

  it('passes through problems with no card: no email on file, unknown customer, nothing to send', async () => {
    const { run, cards } = build();
    state.queue.push([{ ...cooper, email: null }], invoiceRows, lines);
    expect((await run('sendInvoice', { customerName: 'Cooper', invoiceDescription: 'pool cleaning' })).message).toMatch(/no email address on file/);
    state.queue.push([]);
    expect((await run('sendInvoice', { customerName: 'Nobody' })).message).toMatch(/No active customer matches/);
    expect(cards).toEqual([]);
  });
});

describe('creating records', () => {
  it('prepares a new customer (card only) and refuses duplicates', async () => {
    const { run, cards } = build();
    state.queue.push([]); // no existing customer with that phone
    const prepared = await run('createCustomer', { name: 'Sarah Johnson', phoneNumber: '(555) 010-0022', email: 'sarah@example.com' });
    expect(prepared.awaitingOwnerConfirmation).toBe(true);
    expect(cards[0].card).toMatchObject({ title: 'Create customer Sarah Johnson', confirmLabel: 'Create customer' });
    expect(cards[0].card.lines).toContain('Phone: 5550100022');
    expect(mocks.customerRoute).not.toHaveBeenCalled();
    state.queue.push([{ id: 'c-9', name: 'Sarah J' }]);
    const duplicate = await run('createCustomer', { name: 'Sarah Johnson', phoneNumber: '5550100022' });
    expect(duplicate.message).toMatch(/already uses that phone number or email/);
    expect(duplicate.link).toEqual({ label: 'Open customer', href: '/dashboard/customers/c-9' });
  });

  it('needs a phone number and does not invent one', async () => {
    const { tools } = build();
    expect(() => tools.createCustomer.inputSchema.parse({ name: 'Sarah Johnson' })).toThrow();
  });

  it('prepares a job for an existing customer and asks when the work or customer is missing', async () => {
    const { run, cards } = build();
    state.queue.push([cooper]);
    const prepared = await run('createJob', { customerName: 'Cooper', service: 'Pool cleaning', scheduledAt: '2026-10-23T14:00:00-04:00' });
    expect(prepared.awaitingOwnerConfirmation).toBe(true);
    expect(cards[0].card.title).toBe('Create a job for Cooper Bulmer');
    expect(cards[0].card.lines).toContain('Pool cleaning');
    expect(mocks.jobRoute).not.toHaveBeenCalled();
    state.queue.push([cooper]);
    expect((await run('createJob', { customerName: 'Cooper' })).message).toMatch(/What is the job/);
    state.queue.push([]);
    expect((await run('createJob', { customerName: 'Nobody', service: 'x' })).message).toMatch(/No active customer matches/);
    state.queue.push([cooper, { ...cooper, id: 'c-2' }]);
    expect((await run('createJob', { customerName: 'Cooper', service: 'x' })).message).toMatch(/More than one customer/);
  });

  it('prepares a draft quote with the owner’s own prices and totals, and never sends it', async () => {
    const { run, cards } = build();
    state.queue.push([cooper]);
    await run('createQuote', { customerName: 'Cooper', lineItems: [{ description: 'Pool opening', unitPrice: 300, taxRate: 13 }] });
    expect(cards[0].card.title).toBe('Create a quote for Cooper Bulmer');
    expect(cards[0].card.lines).toEqual(['Pool opening: 1 × $300.00', 'Total: $339.00 (includes $39.00 tax)', 'Saved as a draft. Nothing is emailed.']);
    expect(mocks.financeRoute).not.toHaveBeenCalled();
  });

  it('will not prepare a quote without a price from the owner', async () => {
    const { tools } = build();
    expect(() => tools.createQuote.inputSchema.parse({ customerName: 'Cooper', lineItems: [{ description: 'Pool opening' }] })).toThrow();
  });

  it('describes a payment and refuses an amount larger than the invoice', async () => {
    const { run, cards } = build();
    state.queue.push([cooper], invoiceRows);
    await run('recordPayment', { customerName: 'Cooper', amount: 450, method: 'e-transfer' });
    expect(cards[0].card.lines).toEqual(['$450.00 by e-transfer', 'Against INV-11111111 ($450.00)', 'This pays the invoice in full']);
    state.queue.push([cooper], invoiceRows);
    expect((await run('recordPayment', { customerName: 'Cooper', amount: 900 })).message).toMatch(/more than the invoice total/);
    expect(mocks.financeRoute).not.toHaveBeenCalled();
  });
});

describe('scheduling and appointments', () => {
  it('prepares "Add Avery Tuesday-Friday 8-5" and "take Avery off Friday" as a draft that changes nothing yet', async () => {
    const { run, cards } = build();
    const prepared = await run('draftSchedule', { week: 'next', changes: ['Add Avery Tuesday-Friday 8-5', 'Avery off Friday'] });
    expect(prepared.awaitingOwnerConfirmation).toBe(true);
    expect(cards[0].card.title).toBe('Build a draft schedule for the week of October 26');
    expect(cards[0].card.lines).toEqual(expect.arrayContaining(['Apply: Add Avery Tuesday-Friday 8-5', 'Apply: Avery off Friday']));
    expect(cards[0].card.lines.join(' ')).toMatch(/Existing shifts are not overwritten/);
    expect(mocks.draftHandler).not.toHaveBeenCalled();
  });

  it('prepares "make next week like this week" as copying the previous week', async () => {
    const { run, cards } = build();
    await run('draftSchedule', { week: 'next', copyPreviousWeek: true });
    expect(cards[0].card.lines).toContain('Start from the previous week\'s shifts');
    expect(mocks.copyHandler).not.toHaveBeenCalled();
  });

  it('asks what the draft should contain instead of guessing', async () => {
    const { run, cards } = build();
    expect((await run('draftSchedule', { week: 'next' })).message).toMatch(/Say what the draft should contain/);
    expect(cards).toEqual([]);
  });

  it('prepares moving an appointment with the old and new time, after checking it is open', async () => {
    const { run, cards } = build();
    state.queue.push([{ id: 'cust-2', name: 'John Smith' }], [{ id: 'appt-1', customerId: 'cust-2', title: 'Pool opening', scheduledAt: new Date('2026-10-22T14:00:00Z'), durationMinutes: 60, status: 'scheduled' }]);
    const prepared = await run('changeAppointment', { action: 'reschedule', customerName: 'John', scheduledAt: '2026-10-22T14:00:00-04:00' });
    expect(prepared.awaitingOwnerConfirmation).toBe(true);
    expect(cards[0].card.title).toBe('Move John Smith\'s appointment');
    expect(cards[0].card.lines).toEqual(expect.arrayContaining(['Pool opening', 'This time is open: no conflicts found']));
    expect(cards[0].card.confirmLabel).toBe('Move appointment');
  });

  it('makes cancelling an appointment a serious, clearly labelled confirmation', async () => {
    const { run, cards } = build();
    state.queue.push([{ id: 'cust-2', name: 'John Smith' }], [{ id: 'appt-1', customerId: 'cust-2', title: 'Pool opening', scheduledAt: new Date('2026-10-22T14:00:00Z'), durationMinutes: 60, status: 'scheduled' }]);
    await run('changeAppointment', { action: 'cancel', customerName: 'John' });
    expect(cards[0].card).toMatchObject({ title: 'Cancel John Smith\'s appointment', tone: 'danger', confirmLabel: 'Cancel appointment' });
  });

  it('explains an invalid request instead of preparing it', async () => {
    const { run, cards } = build();
    state.queue.push([{ id: 'cust-2', name: 'John Smith' }], [{ id: 'appt-1', customerId: 'cust-2', title: 'Pool opening', scheduledAt: new Date('2026-10-22T14:00:00Z'), durationMinutes: 60, status: 'scheduled' }]);
    const result = await run('changeAppointment', { action: 'reschedule', customerName: 'John' });
    expect(result.message).toMatch(/valid new date and time is required/);
    expect(cards).toEqual([]);
  });
});

describe('status messages and links', () => {
  it('describes only what Pilot is really doing', () => {
    expect(statusFor('getBusinessContext', { topic: 'tomorrow_schedule' })).toBe('Checking your schedule…');
    expect(statusFor('getCustomerSummary', { name: 'Cooper Bulmer' })).toBe('Looking up Cooper…');
    expect(statusFor('sendInvoice', { customerName: 'Cooper Bulmer' })).toBe('Looking up Cooper’s invoice…');
    expect(statusFor('draftSchedule', {})).toBe('Preparing the schedule…');
    expect(statusFor('getFinanceSummary', {})).toBe('Checking your finances…');
  });

  it('links to the records a lookup found, using existing pages', () => {
    expect(linksFor('getCustomerSummary', {}, { customers: [{ id: 'c1', name: 'Cooper Bulmer' }] })).toEqual([{ label: 'Open Cooper Bulmer', href: '/dashboard/customers/c1' }]);
    expect(linksFor('getBusinessContext', { topic: 'tomorrow_schedule' }, {})).toEqual([{ label: 'Open scheduling', href: '/scheduling' }]);
    expect(linksFor('getBusinessContext', { topic: 'unpaid_invoices' }, {})).toEqual([{ label: 'Open invoices', href: '/finance' }]);
    expect(linksFor('getLeadsAndJobs', { record: 'leads' }, {})).toEqual([{ label: 'Open leads', href: '/leads' }]);
    expect(linksFor('getLeadsAndJobs', { record: 'jobs' }, {})).toEqual([{ label: 'Open jobs', href: '/jobs' }]);
    expect(linksFor('createQuote', {}, { link: { label: 'Open quotes', href: '/finance' } })).toEqual([{ label: 'Open quotes', href: '/finance' }]);
    expect(linksFor('searchBusinessKnowledge', {}, {})).toEqual([]);
  });
});
