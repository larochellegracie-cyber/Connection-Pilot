import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';

const { calls, selectResults, updateSet, logActivity } = vi.hoisted(() => {
  const calls: string[] = [];
  return {
    calls,
    selectResults: [] as unknown[][],
    updateSet: vi.fn((_values: unknown) => ({ where: async () => { calls.push('update'); } })),
    logActivity: vi.fn(async (..._args: unknown[]) => { calls.push('log'); }),
  };
});

vi.mock('@/server/db/client.js', () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => selectResults.shift() ?? [] }) }) }),
    update: () => ({ set: updateSet }),
  },
}));
vi.mock('../../../tenant.js', () => ({
  getTenant: vi.fn(async () => ({ id: 'biz-1', businessName: 'Test Co', businessType: 'service' })),
  textValue: (value: unknown, maxLength = 255) => (typeof value === 'string' ? value.trim().slice(0, maxLength) : ''),
}));
vi.mock('../../../activity.js', () => ({ logCustomerActivity: logActivity }));

import handler from './PATCH';

function respond() {
  return { statusCode: 200, body: undefined as unknown, status(code: number) { this.statusCode = code; return this; }, json(payload: unknown) { this.body = payload; return this; } };
}
const requestWith = (body: unknown) => ({ params: { customerId: 'cust-1', noteId: 'note-9' }, body }) as unknown as Request;

describe('PATCH /api/customers/:customerId/notes/:noteId', () => {
  beforeEach(() => {
    calls.length = 0;
    selectResults.length = 0;
    updateSet.mockClear();
    logActivity.mockClear();
  });

  it('keeps the previous wording in the history, then updates only that note', async () => {
    selectResults.push([{ id: 'cust-1' }], [{ id: 'note-9', body: 'Prefers morning visits' }]);
    const res = respond();
    await handler(requestWith({ body: 'Prefers early morning visits' }), res as unknown as Response);

    expect(res.statusCode).toBe(200);
    expect(logActivity).toHaveBeenCalledWith('cust-1', 'note_edited', 'Private note edited', 'Before: Prefers morning visits');
    expect(updateSet).toHaveBeenCalledWith({ body: 'Prefers early morning visits' });
    expect(calls).toEqual(['log', 'update']);
  });

  it('does nothing when the wording has not changed', async () => {
    selectResults.push([{ id: 'cust-1' }], [{ id: 'note-9', body: 'Same text' }]);
    const res = respond();
    await handler(requestWith({ body: 'Same text' }), res as unknown as Response);

    expect(res.statusCode).toBe(200);
    expect(calls).toEqual([]);
  });

  it('rejects an empty note', async () => {
    const res = respond();
    await handler(requestWith({ body: '   ' }), res as unknown as Response);
    expect(res.statusCode).toBe(400);
    expect(calls).toEqual([]);
  });

  it('refuses a note that does not belong to this customer and changes nothing', async () => {
    selectResults.push([{ id: 'cust-1' }], []);
    const res = respond();
    await handler(requestWith({ body: 'New wording' }), res as unknown as Response);
    expect(res.statusCode).toBe(404);
    expect(calls).toEqual([]);
  });

  it('refuses a customer that is not in this business and changes nothing', async () => {
    selectResults.push([]);
    const res = respond();
    await handler(requestWith({ body: 'New wording' }), res as unknown as Response);
    expect(res.statusCode).toBe(404);
    expect(calls).toEqual([]);
  });
});
