import type { Request, Response } from 'express';
import { getTenant } from '@/server/api/customers/tenant.js';
import { applyAction } from '@/lib/marketing-content.js';
import { getContent, removeContent, saveContent } from '@/server/marketing/store.js';
import { text } from '../../shared.js';

/** POST /api/marketing/plan/decision { ids, decision: 'approve' | 'remove' }: the owner's answer to a proposed plan. Only proposed items are affected. */
export default async function handler(req: Request, res: Response) {
  try {
    const tenant = await getTenant(req, res); if (!tenant) return;
    const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).map((id: unknown) => text(id, 36)).filter(Boolean).slice(0, 30);
    const decision = req.body?.decision;
    if (!ids.length || (decision !== 'approve' && decision !== 'remove')) return void res.status(400).json({ error: 'Choose what to approve or remove.' });
    const changed: string[] = []; const skipped: string[] = [];
    for (const id of ids) {
      const item = await getContent(tenant.id, id);
      if (!item || item.status !== 'proposed') { skipped.push(id); continue; }
      if (decision === 'remove') { await removeContent(tenant.id, id); changed.push(id); continue; }
      const result = applyAction(item, { type: 'approve' }, new Date().toISOString());
      if ('error' in result) { skipped.push(id); continue; }
      await saveContent(tenant.id, result.item); changed.push(id);
    }
    res.json({ ok: true, changed, skipped });
  } catch { res.status(500).json({ error: 'Unable to update the plan.' }); }
}
