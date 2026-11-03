import type { Request, Response } from 'express';
import { getTenant } from '@/server/api/customers/tenant.js';
import { requirePlanFeature } from '@/server/plan-access.js';
import { createActionTools } from '@/server/pilot/action-tools.js';
import { redeemConfirmation, redemptionProblem } from '@/server/pilot/confirmations.js';

/**
 * POST /api/chat/confirm { token, decision: 'confirm' | 'cancel' }
 * The only way a Pilot action runs. The ticket was signed by this server for this business when Pilot prepared the
 * action, expires quickly and works once, so neither the AI model nor another business can trigger it.
 */
export default async function handler(req: Request, res: Response) {
  try {
    const tenant = await getTenant(req, res); if (!tenant) return;
    const access = await requirePlanFeature(tenant.id, 'pilot_assistant');
    if (!access.allowed) return void res.status(403).json({ ok: false, message: access.error, upgradeRequired: true });

    const redeemed = redeemConfirmation(req.body?.token, tenant.id);
    if (!redeemed.ok) return void res.status(redeemed.reason === 'wrong_business' ? 403 : redeemed.reason === 'already_used' ? 409 : 400).json({ ok: false, message: redemptionProblem[redeemed.reason] });
    if (req.body?.decision === 'cancel') return void res.json({ ok: true, cancelled: true, message: 'Cancelled. Nothing was changed.' });

    const tools = createActionTools({ tenantId: tenant.id, businessName: tenant.businessName, businessType: tenant.businessType, request: req }) as unknown as Record<string, { inputSchema: { parse: (value: unknown) => unknown; shape?: Record<string, unknown> }; execute?: (input: unknown, options: unknown) => Promise<Record<string, unknown>> }>;
    const action = tools[redeemed.action.tool];
    if (!action?.execute || !action.inputSchema.shape || !('confirmed' in action.inputSchema.shape)) return void res.status(400).json({ ok: false, message: 'That action is not available, so nothing was done.' });
    const input = action.inputSchema.parse({ ...redeemed.action.input, confirmed: true });
    const result = await action.execute(input, { toolCallId: 'owner-confirmation', messages: [] });
    res.status(result.ok ? 200 : 422).json({ ok: Boolean(result.ok), message: typeof result.message === 'string' ? result.message : result.ok ? 'Done.' : 'I couldn’t complete that action.', ...(result.link ? { link: result.link } : {}), ...(Array.isArray(result.availableTimes) ? { availableTimes: result.availableTimes } : {}) });
  } catch (error) {
    console.error('pilot.confirm.failed', { reason: error instanceof Error ? error.message.slice(0, 300) : 'unknown' });
    res.status(500).json({ ok: false, message: 'I couldn’t complete that action, and nothing was changed. Please try again.' });
  }
}
