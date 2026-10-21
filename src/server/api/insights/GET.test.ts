import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';

const state = vi.hoisted(() => ({ queue: [] as unknown[][], updates: [] as unknown[], inserts: [] as unknown[] }));
const mocks = vi.hoisted(() => ({ planAllowed: true, briefing: vi.fn() }));
vi.mock('@/server/db/client.js', async () => ({ db: (await import('@/test/db-mock')).buildDb(state) }));
vi.mock('@/server/api/customers/tenant.js', () => ({ getTenant: vi.fn(async () => ({ id: 'biz-1', businessName: 'Somerset Pool', businessType: 'service' })) }));
vi.mock('@/server/api/calendar/shared.js', () => ({ getCalendarSettings: vi.fn(async () => ({ timezone: 'America/Toronto' })) }));
vi.mock('@/server/plan-access.js', () => ({ requirePlanFeature: vi.fn(async (_id: string, feature: string) => (mocks.planAllowed ? { allowed: true, feature } : { allowed: false, error: 'This feature requires an upgraded plan.' })) }));
vi.mock('@/server/pilot/proactive-briefing.js', () => ({ getProactiveBriefing: mocks.briefing }));

import handler from './GET';

const respond = () => ({ statusCode: 200, body: undefined as unknown, status(code: number) { this.statusCode = code; return this; }, json(payload: unknown) { this.body = payload; return this; } });
const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000);

beforeEach(() => {
  state.queue.length = 0; mocks.planAllowed = true;
  mocks.briefing.mockReset();
  mocks.briefing.mockResolvedValue({ updatedAt: new Date('2026-10-21T16:00:00Z'), insights: [{ id: 'i1', priority: 'opportunity', category: 'Revenue', title: 'Three quotes are waiting' }] });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('GET /api/insights', () => {
  it('is only for plans that include insights', async () => {
    mocks.planAllowed = false;
    const res = respond();
    await handler({} as Request, res as unknown as Response);
    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({ upgradeRequired: true });
    expect(mocks.briefing).not.toHaveBeenCalled();
  });

  it('returns trends built from the business’s own records, plus Pilot’s recommendations', async () => {
    state.queue.push(
      [{ amount: '600', receivedAt: daysAgo(5), createdAt: daysAgo(5) }, { amount: '300', receivedAt: null, createdAt: daysAgo(40) }], // payments
      [{ createdAt: daysAgo(3), lastContactedAt: daysAgo(2) }, { createdAt: daysAgo(90), lastContactedAt: daysAgo(80) }],              // customers
      [{ scheduledAt: daysAgo(4), status: 'completed' }, { scheduledAt: daysAgo(6), status: 'cancelled' }],                            // appointments
      [{ service: 'Pool cleaning', createdAt: daysAgo(3) }],                                                                           // jobs
      [{ id: 'inv-1', total: '500', dueAt: daysAgo(10) }],                                                                             // open invoices
      [{ invoiceId: 'inv-1', amount: '200' }],                                                                                         // payments toward them
    );
    const res = respond();
    await handler({} as Request, res as unknown as Response);

    expect(res.statusCode).toBe(200);
    const body = res.body as { analytics: ReturnType<typeof import('@/server/insights/analytics').buildInsights>; recommendations: { title: string }[] };
    expect(body.recommendations).toEqual([{ id: 'i1', priority: 'opportunity', category: 'Revenue', title: 'Three quotes are waiting' }]);
    expect(body.analytics.comparison[0]).toMatchObject({ key: 'revenue', current: 600, previous: 300, change: 100 });
    expect(body.analytics.topServices).toEqual([{ service: 'Pool cleaning', jobs: 1 }]);
    expect(body.analytics.receivables).toMatchObject({ total: 300, overdue: 300 }); // 500 less the 200 already paid
    expect(body.analytics.hasData).toBe(true);
  });

  it('works for a brand-new business with no records, without inventing anything', async () => {
    state.queue.push([], [], [], [], []);
    const res = respond();
    await handler({} as Request, res as unknown as Response);
    expect(res.statusCode).toBe(200);
    const body = res.body as { analytics: { hasData: boolean; patterns: unknown[] } };
    expect(body.analytics.hasData).toBe(false);
    expect(body.analytics.patterns).toEqual([]);
  });

  it('fails with a friendly message and no internals when something breaks', async () => {
    mocks.briefing.mockRejectedValue(new Error('SELECT secret_table failed'));
    state.queue.push([], [], [], [], []);
    const res = respond();
    await handler({} as Request, res as unknown as Response);
    expect(res.statusCode).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('secret_table');
  });
});
