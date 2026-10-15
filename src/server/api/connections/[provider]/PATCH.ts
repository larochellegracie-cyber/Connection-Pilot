import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { and, eq } from 'drizzle-orm';
import { db } from '@/server/db/client.js';
import { businessConnection } from '@/server/db/schema.js';
import { getTenant } from '../../customers/tenant.js';
import { requirePlanFeature } from '@/server/plan-access.js';

const providers = new Set(['toast', 'stripe', 'quickbooks', 'google-calendar', 'uber-eats', 'shopify', 'business-data-import']);

type ConnectionStatus = 'connected' | 'not_connected';

export default async function handler(req: Request, res: Response) {
  try {
    const tenant = await getTenant(req, res);
    if (!tenant) return;
    const access = await requirePlanFeature(tenant.id, 'connections');
    if (!access.allowed) return void res.status(403).json({ error: access.error, upgradeRequired: true });

    const provider = String(req.params.provider || '');
    const status = req.body?.status as ConnectionStatus | undefined;
    if (!providers.has(provider) || (status !== 'connected' && status !== 'not_connected')) {
      res.status(400).json({ error: 'Invalid connection request.' });
      return;
    }

    const existing = await db.select({ id: businessConnection.id })
      .from(businessConnection)
      .where(and(eq(businessConnection.businessProfileId, tenant.id), eq(businessConnection.provider, provider)))
      .limit(1);
    const connectedAt = status === 'connected' ? new Date() : null;

    if (existing[0]) {
      await db.update(businessConnection).set({ status, connectedAt }).where(eq(businessConnection.id, existing[0].id));
    } else {
      await db.insert(businessConnection).values({ id: randomUUID(), businessProfileId: tenant.id, provider, status, connectedAt });
    }

    res.json({ provider, status, connectedAt });
  } catch (error) {
    res.status(500).json({ error: 'Unable to update connection status.', message: String(error) });
  }
}
