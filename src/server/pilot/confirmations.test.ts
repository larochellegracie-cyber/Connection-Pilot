import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('#airo/secrets', () => ({ getSecret: (name: string) => (name === 'BETTER_AUTH_SECRET' ? 'test-secret-value-1234567890' : undefined) }));

import { createConfirmation, redeemConfirmation, resetRedeemedForTests } from './confirmations';

const action = { tool: 'sendInvoice', input: { customerName: 'Cooper', invoiceId: 'inv-1' } };
beforeEach(() => resetRedeemedForTests());

describe('server-enforced confirmation tickets', () => {
  it('redeems a valid ticket for the same business, once', () => {
    const token = createConfirmation('biz-1', action);
    expect(redeemConfirmation(token, 'biz-1')).toEqual({ ok: true, action });
    expect(redeemConfirmation(token, 'biz-1')).toEqual({ ok: false, reason: 'already_used' });
  });

  it('is refused for another business', () => {
    const token = createConfirmation('biz-1', action);
    expect(redeemConfirmation(token, 'biz-2')).toEqual({ ok: false, reason: 'wrong_business' });
    expect(redeemConfirmation(token, 'biz-1')).toMatchObject({ ok: true }); // the wrong attempt did not use it up
  });

  it('expires after a short time', () => {
    const token = createConfirmation('biz-1', action, 1_000);
    expect(redeemConfirmation(token, 'biz-1', 1_000 + 16 * 60 * 1000)).toEqual({ ok: false, reason: 'expired' });
  });

  it('rejects forged, altered or missing tickets', () => {
    const token = createConfirmation('biz-1', action);
    const [body, signature] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ id: 'x', tenantId: 'biz-1', tool: 'sendInvoice', input: { customerName: 'Someone Else' }, exp: Date.now() + 60_000 })).toString('base64url');
    expect(redeemConfirmation(`${forged}.${signature}`, 'biz-1')).toEqual({ ok: false, reason: 'invalid' });
    expect(redeemConfirmation(`${body}.${signature.slice(0, -2)}AA`, 'biz-1')).toEqual({ ok: false, reason: 'invalid' });
    expect(redeemConfirmation(`${body}.`, 'biz-1')).toEqual({ ok: false, reason: 'invalid' });
    expect(redeemConfirmation(undefined, 'biz-1')).toEqual({ ok: false, reason: 'invalid' });
    expect(redeemConfirmation('x'.repeat(30000), 'biz-1')).toEqual({ ok: false, reason: 'invalid' });
    expect(redeemConfirmation('not-a-token', 'biz-1')).toEqual({ ok: false, reason: 'invalid' });
  });
});
