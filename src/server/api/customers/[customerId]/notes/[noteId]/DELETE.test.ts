import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';

const { calls, selectResults, deleteWhere, logActivity } = vi.hoisted(() => {
  const calls: string[] = [];
  return {
    calls,
    selectResults: [] as unknown[][],
    deleteWhere: vi.fn(async () => { calls.push('delete'); }),
    logActivity: vi.fn(async (..._args: unknown[]) => { calls.push('log'); }),
  };
});

vi.mock('@/server/db/client.js', () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => selectResults.shift() ?? [] }) }) }),
    delete: () => ({ where: deleteWhere }),
  },
}));
vi.mock('../../../tenant.js', () => ({ getTenant: vi.fn(async () => ({ id: 'biz-1', businessName: 'Test Co', businessType: 'service' })) }));
vi.mock('../../../activity.js', () => ({ logCustomerActivity: logActivity }));

import handler from './DELETE';

function respond() {
  const res = { statusCode: 200, body: undefined as unknown, status(code: number) { this.statusCode = code; return this; }, json(payload: unknown) { this.body = payload; return this; } };
  return res;
}
const request = { params: { customerId: 'cust-1', noteId: 'note-9' } } as unknown as Request;

describe('DELETE /api/customers/:customerId/notes/:noteId', () => {
  beforeEach(() => {
    calls.length = 0;
    selectResults.length = 0;
    deleteWhere.mockClear();
    logActivity.mockClear();
  });

  it('saves the note text to the customer history, then removes only that note', async () => {
    selectResults.push([{ id: 'cust-1' }], [{ id: 'note-9', body: 'Always go through back gate' }]);
    const res = respond();
    await handler(request, res as unknown as Response);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(logActivity).toHaveBeenCalledWith('cust-1', 'note_removed', 'Private note removed', 'Always go through back gate');
    expect(deleteWhere).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(['log', 'delete']);
  });

  it('refuses a note that does not belong to this customer and changes nothing', async () => {
    selectResults.push([{ id: 'cust-1' }], []);
    const res = respond();
    await handler(request, res as unknown as Response);

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'Note not found.' });
    expect(calls).toEqual([]);
  });

  it('refuses a customer that is not in this business and changes nothing', async () => {
    selectResults.push([]);
    const res = respond();
    await handler(request, res as unknown as Response);

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'Customer profile not found.' });
    expect(calls).toEqual([]);
  });
});
