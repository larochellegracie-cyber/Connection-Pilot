import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { getSecret } from '#airo/secrets';

/**
 * Server-enforced confirmation. When Pilot prepares an action, the server signs a short-lived,
 * single-use ticket that describes exactly that action for exactly that business. Only the owner's
 * Confirm button (a separate, signed-in request) can redeem it. The AI model never sees the ticket's
 * secret and cannot confirm for the owner, however it phrases things.
 */
export type PendingAction = { tool: string; input: Record<string, unknown> };
type Payload = PendingAction & { id: string; tenantId: string; exp: number };

const LIFETIME_MS = 15 * 60 * 1000;
/** Tickets already used. Kept only until they would have expired anyway. */
const redeemed = new Map<string, number>();

function secret(): string {
  const value = getSecret('BETTER_AUTH_SECRET');
  if (typeof value !== 'string' || !value) throw new Error('Pilot confirmations are not available because the server secret is not set.');
  return value;
}
const sign = (body: string) => createHmac('sha256', secret()).update(`pilot-confirmation:${body}`).digest('base64url');

export function createConfirmation(tenantId: string, action: PendingAction, now = Date.now()): string {
  const payload: Payload = { id: randomUUID(), tenantId, tool: action.tool, input: action.input, exp: now + LIFETIME_MS };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${sign(body)}`;
}

export type Redeemed = { ok: true; action: PendingAction } | { ok: false; reason: 'invalid' | 'expired' | 'wrong_business' | 'already_used' };

/** Checks the ticket and marks it used, so one click can never run an action twice. */
export function redeemConfirmation(token: unknown, tenantId: string, now = Date.now()): Redeemed {
  if (typeof token !== 'string' || token.length > 20000) return { ok: false, reason: 'invalid' };
  const [body, signature] = token.split('.');
  if (!body || !signature) return { ok: false, reason: 'invalid' };
  const expected = Buffer.from(sign(body)); const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, reason: 'invalid' };
  let payload: Payload;
  try { payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Payload; } catch { return { ok: false, reason: 'invalid' }; }
  if (payload.tenantId !== tenantId) return { ok: false, reason: 'wrong_business' };
  if (payload.exp < now) return { ok: false, reason: 'expired' };
  for (const [id, exp] of redeemed) if (exp < now) redeemed.delete(id);
  if (redeemed.has(payload.id)) return { ok: false, reason: 'already_used' };
  redeemed.set(payload.id, payload.exp);
  return { ok: true, action: { tool: payload.tool, input: payload.input } };
}

export const redemptionProblem: Record<Exclude<Redeemed, { ok: true }>['reason'], string> = {
  invalid: 'That confirmation is not valid, so nothing was done. Ask Pilot again.',
  expired: 'That confirmation expired, so nothing was done. Ask Pilot again and confirm right away.',
  wrong_business: 'That confirmation does not belong to this business, so nothing was done.',
  already_used: 'That action was already confirmed once, so it was not run again.',
};

export function resetRedeemedForTests() { redeemed.clear(); }
