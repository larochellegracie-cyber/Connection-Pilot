import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';

const state = vi.hoisted(() => ({ queue: [] as unknown[][], updates: [] as unknown[], inserts: [] as unknown[] }));
const mocks = vi.hoisted(() => ({ planAllowed: true, tenant: true as boolean, briefing: vi.fn() }));
vi.mock('@/server/db/client.js', async () => ({ db: (await import('@/test/db-mock')).buildDb(state) }));
vi.mock('@/server/api/customers/tenant.js', () => ({
  getTenant: vi.fn(async (_req: unknown, res: { status: (code: number) => { json: (body: unknown) => void } }) => { if (mocks.tenant) return { id: 'biz-1', businessName: 'Somerset Pool', businessType: 'service' }; res.status(401).json({ error: 'Please sign in.' }); return null; }),
  textValue: (value: unknown, max = 255) => (typeof value === 'string' ? value.trim().slice(0, max) : ''),
}));
vi.mock('@/server/api/calendar/shared.js', () => ({ getCalendarSettings: vi.fn(async () => ({ timezone: 'America/Toronto' })) }));
vi.mock('@/server/plan-access.js', () => ({ requirePlanFeature: vi.fn(async () => (mocks.planAllowed ? { allowed: true } : { allowed: false, error: 'This feature requires an upgraded plan.' })) }));
vi.mock('@/server/pilot/proactive-briefing.js', () => ({ getProactiveBriefing: mocks.briefing }));

import handler from './GET';

const respond = () => ({ statusCode: 200, body: undefined as unknown, status(code: number) { this.statusCode = code; return this; }, json(payload: unknown) { this.body = payload; return this; } });
const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000);
const emptyQueue = () => { state.queue.length = 0; for (let index = 0; index < 9; index += 1) state.queue.push([]); };

beforeEach(() => {
  mocks.planAllowed = true; mocks.tenant = true; emptyQueue();
  mocks.briefing.mockReset();
  mocks.briefing.mockResolvedValue({ updatedAt: new Date('2026-10-21T16:00:00Z'), insights: [{ id: 'i1', priority: 'opportunity', category: 'Revenue', title: 'Three quotes are waiting' }] });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('GET /api/insights/overview', () => {
  it('is only for plans that include insights and for signed-in businesses', async () => {
    mocks.planAllowed = false;
    let res = respond();
    await handler({ query: {} } as unknown as Request, res as unknown as Response);
    expect(res.statusCode).toBe(403);
    mocks.planAllowed = true; mocks.tenant = false;
    res = respond();
    await handler({ query: {} } as unknown as Request, res as unknown as Response);
    expect(res.statusCode).toBe(401);
    expect(mocks.briefing).not.toHaveBeenCalled();
  });

  it('works for a business with no records: zeros and empty lists only', async () => {
    const res = respond();
    await handler({ query: {} } as unknown as Request, res as unknown as Response);
    const body = res.body as Record<string, any>;
    expect(res.statusCode).toBe(200);
    expect(body.hasAnyData).toBe(false);
    expect(body.range.key).toBe('this_month');
    expect(body.kpis.outstanding).toEqual({ amount: 0, count: 0 });
    expect(body.jobStatus).toEqual([]);
    expect(body.highlights).toEqual([]);
    expect(body.quotes.acceptanceRate).toBeNull();
    expect(body.recommendations).toEqual([expect.objectContaining({ title: 'Three quotes are waiting' })]);
  });

  it('turns the business’s own rows into numbers and honours the range in the query', async () => {
    state.queue.length = 0;
    state.queue.push(
      [{ amount: '600', receivedAt: daysAgo(2), createdAt: daysAgo(2) }],                                                  // payments
      [{ id: 'inv-1', total: '600', status: 'paid', dueAt: null, createdAt: daysAgo(3) }],                                  // invoices created in range
      [],                                                                                                                  // open invoices
      [{ status: 'completed', scheduledAt: daysAgo(2), createdAt: daysAgo(10), customerId: 'c1' }],                         // jobs
      [], [], [], [], [],
    );
    const res = respond();
    await handler({ query: { range: 'last_12_months' } } as unknown as Request, res as unknown as Response);
    const body = res.body as Record<string, any>;
    expect(body.range.key).toBe('last_12_months');
    expect(body.kpis.received.current).toBe(600);
    expect(body.invoiceMix).toEqual([{ key: 'paid', label: 'Paid', count: 1, amount: 600 }]);
    expect(body.jobStatus).toEqual([{ status: 'completed', label: 'Completed', count: 1 }]);
  });

  it('falls back safely for unknown or invalid ranges', async () => {
    const res = respond();
    await handler({ query: { range: 'custom', from: '2026-13-45', to: 'x' } } as unknown as Request, res as unknown as Response);
    expect((res.body as { range: { key: string } }).range.key).toBe('this_month');
  });

  it('reports a clean error if something fails', async () => {
    mocks.briefing.mockRejectedValue(new Error('boom'));
    const res = respond();
    await handler({ query: {} } as unknown as Request, res as unknown as Response);
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'Unable to load your insights right now.' });
  });
});
