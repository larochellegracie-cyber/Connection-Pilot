import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';

const state = vi.hoisted(() => ({ queue: [] as unknown[][], updates: [] as unknown[], inserts: [] as unknown[], failWrites: false }));
vi.mock('@/server/db/client.js', async () => ({ db: (await import('@/test/db-mock')).buildDb(state) }));
vi.mock('../../../customers/tenant.js', () => ({
  getTenant: vi.fn(async () => ({ id: 'biz-1', businessName: 'Somerset Pool', businessType: 'service' })),
  textValue: (value: unknown, max = 255) => (typeof value === 'string' ? value.trim().slice(0, max) : ''),
}));
vi.mock('../../../calendar/shared.js', () => ({ getCalendarSettings: vi.fn(async () => ({ timezone: 'America/Toronto' })) }));

import handler from './POST';

const schedule = { id: 'sched-1', status: 'published', weekStartsAt: new Date('2026-10-19T04:00:00Z') };
const shift = (employeeId: string, name: string, email: string | null) => ({ employeeId, employeeName: name, email, startsAt: new Date('2026-10-20T12:00:00Z'), endsAt: new Date('2026-10-20T21:00:00Z'), location: null, notes: null });
const respond = () => ({ statusCode: 200, body: undefined as unknown, status(code: number) { this.statusCode = code; return this; }, json(payload: unknown) { this.body = payload; return this; } });
const request = () => ({ params: { scheduleId: 'sched-1' } }) as unknown as Request;
const queueFor = (rows: unknown[]) => state.queue.push([schedule], [{ businessName: 'Somerset Pool', businessEmail: null, phoneNumber: null, logoUrl: null, brandColors: null }], rows);

describe('POST /api/schedules/:scheduleId/email', () => {
  beforeEach(() => {
    state.queue.length = 0; state.updates.length = 0; state.inserts.length = 0;
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => { delete process.env.RESEND_API_KEY; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('does NOT say schedules were sent when email is not set up, and records no delivery', async () => {
    delete process.env.RESEND_API_KEY;
    queueFor([shift('e1', 'Avery Stone', 'avery@example.com')]);
    const res = respond();
    await handler(request(), res as unknown as Response);

    expect(res.statusCode).toBe(503);
    const body = res.body as { error: string; setupRequired: boolean; failed: string[] };
    expect(body.error).toMatch(/isn’t set up yet.*nothing was sent/i);
    expect(body.setupRequired).toBe(true);
    expect(body.failed).toEqual(['Avery Stone']);
    expect(state.inserts).toEqual([]); // no "delivered" record for an email that never left
  });

  it('sends through Resend and only then reports and records the delivery', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'msg_7' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    queueFor([shift('e1', 'Avery Stone', 'avery@example.com'), shift('e2', 'No Email', null)]);
    const res = respond();
    await handler(request(), res as unknown as Response);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ sent: 1, delivered: ['Avery Stone'], failed: [], message: 'Sent schedules to 1 employee(s).' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(state.inserts).toHaveLength(1);
    expect(state.inserts[0]).toMatchObject({ recipientEmail: 'avery@example.com', gatewayMessageId: 'msg_7' });
  });

  it('reports a partial failure honestly', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'msg_1' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: 'mailbox full' }), { status: 422 })));
    queueFor([shift('e1', 'Avery Stone', 'avery@example.com'), shift('e2', 'Sam Patel', 'sam@example.com')]);
    const res = respond();
    await handler(request(), res as unknown as Response);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ sent: 1, delivered: ['Avery Stone'], failed: ['Sam Patel'] });
    expect((res.body as { message: string }).message).toMatch(/Sent to 1 employee\(s\)\. 1 delivery attempt\(s\) failed\./);
  });

  it('shows the provider’s reason when every send is rejected', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: 'domain not verified' }), { status: 403 })));
    queueFor([shift('e1', 'Avery Stone', 'avery@example.com')]);
    const res = respond();
    await handler(request(), res as unknown as Response);
    expect(res.statusCode).toBe(502);
    expect((res.body as { error: string }).error).toContain('domain not verified');
  });
});
