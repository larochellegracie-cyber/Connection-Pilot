import type { Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '@/server/db/client.js';
import { businessConnection } from '@/server/db/schema.js';
import { getTenant } from '../customers/tenant.js';
import { requirePlanFeature } from '@/server/plan-access.js';

const providers = ['toast', 'stripe', 'quickbooks', 'google-calendar', 'uber-eats', 'shopify', 'business-data-import'] as const;

export default async function handler(req: Request, res: Response) {
  try {
    const tenant = await getTenant(req, res);
    if (!tenant) return;
    const access = await requirePlanFeature(tenant.id, 'connections');
    if (!access.allowed) return void res.status(403).json({ error: access.error, upgradeRequired: true });

    const records = await db.select({ provider: businessConnection.provider, status: businessConnection.status, connectedAt: businessConnection.connectedAt })
      .from(businessConnection)
      .where(eq(businessConnection.businessProfileId, tenant.id));
    const byProvider = new Map(records.map((record) => [record.provider, record]));

    res.json({
      connections: providers.map((provider) => {
        const record = byProvider.get(provider);
        return { provider, status: record?.status === 'connected' ? 'connected' : 'not_connected', connectedAt: record?.connectedAt ?? null };
      }),
    });
  } catch (error) {
    res.status(500).json({ error: 'Unable to load connection status.', message: String(error) });
  }
}
