import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ queue: [] as unknown[][], updates: [] as unknown[], inserts: [] as unknown[] }));
const mocks = vi.hoisted(() => ({
  sendInvoiceEmail: vi.fn(),
  copyHandler: vi.fn(),
  draftHandler: vi.fn(),
}));
vi.mock('@/server/db/client.js', async () => ({ db: (await import('@/test/db-mock')).buildDb(state) }));
vi.mock('@/server/api/calendar/shared.js', () => ({ getCalendarSettings: vi.fn(async () => ({ timezone: 'America/Toronto' })) }));
vi.mock('@/server/finance/send-invoice.js', () => ({ sendInvoiceEmail: mocks.sendInvoiceEmail, invoiceNumber: (id: string) => `INV-${id.slice(0, 8).toUpperCase()}` }));
vi.mock('@/server/api/schedules/copy-previous/POST.js', () => ({ default: mocks.copyHandler }));
vi.mock('@/server/api/schedules/pilot-draft/POST.js', () => ({ default: mocks.draftHandler }));

import { createActionTools } from './action-tools';

const request = { headers: { cookie: 'session=abc' } };
const tools = () => createActionTools({ tenantId: 'biz-1', businessName: 'Somerset Pool', request, now: () => new Date('2026-10-21T15:00:00Z') });
const run = async (name: 'sendInvoice' | 'draftSchedule', input: Record<string, unknown>) => {
  const toolSet = tools() as unknown as Record<string, { inputSchema: { parse: (value: unknown) => unknown }; execute?: (input: unknown, options: unknown) => Promise<Record<string, unknown>> }>;
  const parsed = toolSet[name].inputSchema.parse(input); // the chat parses input with the tool's schema first, which also applies defaults
  return (await toolSet[name].execute!(parsed, { toolCallId: 't1', messages: [] })) as Record<string, unknown>;
};

const cooper = { id: 'cust-1', name: 'Cooper Bulmer', email: 'cooper@example.com' };
const invoiceRows = [
  { id: '11111111-aaaa-4aaa-8aaa-111111111111', status: 'draft', total: '159.30', createdAt: new Date('2026-10-18'), jobService: 'pool cleaning' },
  { id: '22222222-bbbb-4bbb-8bbb-222222222222', status: 'sent', total: '300.00', createdAt: new Date('2026-10-10'), jobService: 'pool opening' },
];
const lines = [{ invoiceId: invoiceRows[0].id, description: 'Weekly pool cleaning' }, { invoiceId: invoiceRows[1].id, description: 'Spring opening' }];
const queueInvoices = (rows = invoiceRows, customerRow: unknown[] = [cooper]) => state.queue.push(customerRow, rows, lines);

beforeEach(() => {
  state.queue.length = 0; state.updates.length = 0; state.inserts.length = 0;
  mocks.sendInvoiceEmail.mockReset(); mocks.copyHandler.mockReset(); mocks.draftHandler.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('Pilot action: sendInvoice', () => {
  it('asks for confirmation first and sends nothing', async () => {
    queueInvoices();
    const result = await run('sendInvoice', { customerName: 'Cooper', invoiceDescription: 'pool cleaning' });
    expect(result).toMatchObject({ ok: false, needsConfirmation: true, customerName: 'Cooper Bulmer', sendTo: 'cooper@example.com', invoiceNumber: 'INV-11111111', total: '$159.30' });
    expect(mocks.sendInvoiceEmail).not.toHaveBeenCalled();
  });

  it('sends the confirmed invoice with the shared invoice sender and reports only the real result', async () => {
    queueInvoices();
    mocks.sendInvoiceEmail.mockResolvedValue({ ok: true, messageId: 'msg_1', sentTo: 'cooper@example.com', invoiceNumber: 'INV-11111111' });
    const result = await run('sendInvoice', { customerName: 'Cooper', invoiceDescription: 'pool cleaning', confirmed: true });
    expect(mocks.sendInvoiceEmail).toHaveBeenCalledWith({ id: 'biz-1', businessName: 'Somerset Pool' }, invoiceRows[0].id);
    expect(result).toMatchObject({ ok: true, sent: true, message: 'Invoice INV-11111111 was emailed to cooper@example.com.' });
  });

  it('says plainly that nothing was sent when the email fails', async () => {
    queueInvoices();
    mocks.sendInvoiceEmail.mockResolvedValue({ ok: false, status: 503, error: 'Email isn’t set up yet, so nothing was sent.', setupRequired: true });
    const result = await run('sendInvoice', { customerName: 'Cooper', invoiceDescription: 'pool cleaning', confirmed: true });
    expect(result).toMatchObject({ ok: false, sent: false, setupRequired: true });
    expect(result.message).toMatch(/^The invoice was NOT sent\./);
  });

  it('picks the right invoice by what it was for, using the job or the line items', async () => {
    queueInvoices();
    const byJob = await run('sendInvoice', { customerName: 'Cooper', invoiceDescription: 'the pool cleaning' });
    expect(byJob).toMatchObject({ needsConfirmation: true, invoiceNumber: 'INV-11111111' });
    queueInvoices();
    const byLine = await run('sendInvoice', { customerName: 'Cooper', invoiceDescription: 'spring opening' });
    expect(byLine).toMatchObject({ needsConfirmation: true, invoiceNumber: 'INV-22222222', alreadySent: true });
  });

  it('asks which invoice when several match, and when none match', async () => {
    queueInvoices();
    const several = await run('sendInvoice', { customerName: 'Cooper' });
    expect(several).toMatchObject({ ok: false });
    expect((several.invoices as unknown[]).length).toBe(2);
    queueInvoices();
    const none = await run('sendInvoice', { customerName: 'Cooper', invoiceDescription: 'fence painting', confirmed: true });
    expect(none.ok).toBe(false);
    expect((none.invoices as unknown[]).length).toBe(2);
    expect(mocks.sendInvoiceEmail).not.toHaveBeenCalled();
  });

  it('will not send to a customer with no email, or when the customer is unclear', async () => {
    queueInvoices(invoiceRows, [{ ...cooper, email: null }]);
    expect((await run('sendInvoice', { customerName: 'Cooper', invoiceDescription: 'pool cleaning', confirmed: true })).message).toMatch(/no email address/);
    state.queue.push([]);
    expect((await run('sendInvoice', { customerName: 'Nobody' })).message).toMatch(/No active customer/);
    state.queue.push([cooper, { ...cooper, id: 'cust-2' }]);
    expect((await run('sendInvoice', { customerName: 'Coo' })).message).toMatch(/More than one customer/);
    expect(mocks.sendInvoiceEmail).not.toHaveBeenCalled();
  });
});

describe('Pilot action: draftSchedule', () => {
  const ok = (body: Record<string, unknown>, status = 201) => (_req: unknown, res: { status: (code: number) => { json: (payload: unknown) => void } }) => res.status(status).json(body);

  it('asks for confirmation first and changes nothing', async () => {
    const result = await run('draftSchedule', { week: 'next', copyPreviousWeek: true, changes: ['Avery off Friday'] });
    expect(result).toMatchObject({ ok: false, needsConfirmation: true, proposedDraft: { week: 'the week of October 26', copyPreviousWeek: true, changes: ['Avery off Friday'] } });
    expect(result.message).toMatch(/will not be published or sent/);
    expect(mocks.copyHandler).not.toHaveBeenCalled();
    expect(mocks.draftHandler).not.toHaveBeenCalled();
  });

  it('"like last week but Avery off Friday": copies the week, applies the change, and says it is only a draft', async () => {
    mocks.copyHandler.mockImplementation(ok({ scheduleId: 's1', copied: 9, status: 'draft' }));
    mocks.draftHandler.mockImplementation(ok({ scheduleId: 's1', created: 0, removed: 1, moved: 0, skipped: 0, status: 'draft' }));
    const result = await run('draftSchedule', { week: 'next', copyPreviousWeek: true, changes: ['Avery off Friday'], confirmed: true });

    expect(mocks.copyHandler).toHaveBeenCalledOnce();
    expect(mocks.copyHandler.mock.calls[0][0]).toMatchObject({ headers: request.headers, body: { weekStart: '2026-10-26T12:00:00.000Z' } });
    expect(mocks.draftHandler.mock.calls[0][0].body).toEqual({ weekStart: '2026-10-26T12:00:00.000Z', instruction: 'Avery off Friday' });
    expect(result).toMatchObject({ ok: true, draft: true, completed: ['Copied 9 shifts from the previous week', 'Avery off Friday (1 removed)'] });
    expect(result.message).toMatch(/has not been published or sent to employees/);
  });

  it('builds from scratch when asked to add shifts without copying', async () => {
    mocks.draftHandler.mockImplementation(ok({ scheduleId: 's2', created: 4, removed: 0, moved: 0, skipped: 0 }));
    const result = await run('draftSchedule', { week: 'this', changes: ['Add Avery Tuesday-Friday 8-5'], confirmed: true });
    expect(mocks.copyHandler).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: true, completed: ['Add Avery Tuesday-Friday 8-5 (4 added)'] });
  });

  it('does not claim success when the previous week cannot be copied, and applies no changes', async () => {
    mocks.copyHandler.mockImplementation(ok({ error: 'No schedule was found for the previous week.' }, 404));
    const result = await run('draftSchedule', { week: 'next', copyPreviousWeek: true, changes: ['Avery off Friday'], confirmed: true });
    expect(result).toMatchObject({ ok: false });
    expect(result.message).toMatch(/draft was NOT created.*No schedule was found for the previous week/);
    expect(mocks.draftHandler).not.toHaveBeenCalled();
  });

  it('is honest about a partial result when a later change fails', async () => {
    mocks.copyHandler.mockImplementation(ok({ copied: 9 }));
    mocks.draftHandler.mockImplementation(ok({ error: 'Avery has no scheduled shift on the requested day in this draft.' }, 400));
    const result = await run('draftSchedule', { week: 'next', copyPreviousWeek: true, changes: ['Avery off Friday'], confirmed: true });
    expect(result).toMatchObject({ ok: false, failedChange: 'Avery off Friday', completed: ['Copied 9 shifts from the previous week'] });
    expect(result.message).toMatch(/Part of the draft was saved, but "Avery off Friday" could not be applied: Avery has no scheduled shift/);
  });

  it('asks what to do when given nothing, or a week it cannot read', async () => {
    expect((await run('draftSchedule', { week: 'next' })).message).toMatch(/Say what the draft should contain/);
    expect((await run('draftSchedule', { week: 'whenever', changes: ['Avery off Friday'] })).message).toMatch(/Which week/);
  });
});
