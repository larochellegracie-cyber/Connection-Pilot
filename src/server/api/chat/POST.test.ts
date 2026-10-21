import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';

vi.mock('@/server/db/client.js', () => ({ db: {} }));
vi.mock('@/server/api/customers/tenant.js', () => ({ getTenant: vi.fn(async () => ({ id: 'biz-1', businessName: 'Test Co', businessType: 'service' })) }));
vi.mock('@/server/plan-access.js', () => ({ requirePlanFeature: vi.fn(async () => ({ allowed: true })) }));

import handler from './POST';

function respond() {
  return { statusCode: 200, body: undefined as unknown, status(code: number) { this.statusCode = code; return this; }, json(payload: unknown) { this.body = payload; return this; }, headersSent: false };
}
const askPilot = (messages: unknown) => ({ body: { messages } }) as unknown as Request;

describe('POST /api/chat setup checks', () => {
  beforeEach(() => { delete process.env.OPENAI_API_KEY; vi.spyOn(console, 'error').mockImplementation(() => {}); });

  it('says plainly that Pilot chat is not set up when there is no OpenAI key', async () => {
    const res = respond();
    await handler(askPilot([{ role: 'user', content: 'Which customers need follow-up?' }]), res as unknown as Response);

    expect(res.statusCode).toBe(503);
    const body = res.body as { error: string; setupRequired: boolean; requestId: string };
    expect(body.error).toMatch(/not set up yet/i);
    expect(body.error).toMatch(/OpenAI API key/);
    expect(body.setupRequired).toBe(true);
    expect(body.requestId).toBeTruthy();
  });

  it('still rejects a request with no messages before anything else', async () => {
    const res = respond();
    await handler({ body: {} } as unknown as Request, res as unknown as Response);
    expect(res.statusCode).toBe(400);
  });
});
