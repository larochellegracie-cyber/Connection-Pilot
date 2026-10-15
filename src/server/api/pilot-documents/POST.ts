import type { Request, Response } from 'express';
import { getTenant } from '@/server/api/customers/tenant.js';
import { requirePlanFeature } from '@/server/plan-access.js';
import { createDocumentReview } from '@/server/pilot/document-intelligence.js';

export default async function handler(req: Request, res: Response) {
  try {
    const tenant = await getTenant(req, res); if (!tenant) return;
    const access = await requirePlanFeature(tenant.id, 'pilot_assistant');
    if (!access.allowed) return void res.status(403).json({ error: access.error, upgradeRequired: true });
    const fileName = typeof req.body?.fileName === 'string' ? req.body.fileName : '';
    const fileType = typeof req.body?.fileType === 'string' ? req.body.fileType : 'text/plain';
    const base64 = typeof req.body?.base64 === 'string' ? req.body.base64 : undefined;
    console.info('Pilot document intake started', {
      fileName,
      fileType,
      encodedBytes: base64?.length ?? 0,
      requestBytes: req.headers['content-length'] ?? 'unknown',
    });
    const review = await createDocumentReview(tenant.id, {
      fileName,
      fileType,
      sourceReference: typeof req.body?.sourceReference === 'string' ? req.body.sourceReference : undefined,
      content: typeof req.body?.content === 'string' ? req.body.content : undefined,
      base64,
    });
    res.status(201).json(review);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Pilot could not review that document.';
    const underlyingError = error instanceof Error && 'cause' in error && error.cause instanceof Error ? error.cause.message : undefined;
    console.error('Pilot document intake failed', {
      fileName: typeof req.body?.fileName === 'string' ? req.body.fileName : 'unknown',
      fileType: typeof req.body?.fileType === 'string' ? req.body.fileType : 'unknown',
      requestBytes: req.headers['content-length'] ?? 'unknown',
      error: message,
      underlyingError,
    });
    res.status(400).json({ error: message });
  }
}
