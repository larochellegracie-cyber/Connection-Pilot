import type { Request, Response } from 'express';
import { getTenant } from '@/server/api/customers/tenant.js';
import { requirePlanFeature } from '@/server/plan-access.js';
import { confirmDocumentReview } from '@/server/pilot/document-intelligence.js';

export default async function handler(req: Request, res: Response) {
  try {
    const tenant = await getTenant(req, res); if (!tenant) return;
    const access = await requirePlanFeature(tenant.id, 'pilot_assistant');
    if (!access.allowed) return void res.status(403).json({ error: access.error, upgradeRequired: true });
    const acceptedIds = Array.isArray(req.body?.acceptedIds) ? req.body.acceptedIds.filter((id: unknown): id is string => typeof id === 'string').slice(0, 100) : [];
    const rejectedIds = Array.isArray(req.body?.rejectedIds) ? req.body.rejectedIds.filter((id: unknown): id is string => typeof id === 'string').slice(0, 100) : [];
    const edits = Array.isArray(req.body?.edits) ? req.body.edits.filter((edit: unknown): edit is { id: string; subject?: string; predicate?: string; value?: string; unit?: string | null; details?: string | null } => Boolean(edit) && typeof edit === 'object' && typeof (edit as { id?: unknown }).id === 'string').slice(0, 100) : [];
    const result = await confirmDocumentReview(tenant.id, req.params.documentId, acceptedIds, rejectedIds, edits);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Pilot could not save this document review.' });
  }
}
