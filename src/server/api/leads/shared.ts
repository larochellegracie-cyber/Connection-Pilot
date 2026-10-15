import { randomUUID } from 'node:crypto';
import { db } from '@/server/db/client.js';
import { leadActivity } from '@/server/db/schema.js';

export const leadStatuses = ['new', 'contacted', 'estimate_sent', 'follow_up', 'won', 'lost'] as const;
export type LeadStatus = (typeof leadStatuses)[number];

export function isLeadStatus(value: string): value is LeadStatus {
  return leadStatuses.includes(value as LeadStatus);
}

export async function logLeadActivity(leadId: string, activityType: string, title: string, detail?: string | null) {
  await db.insert(leadActivity).values({
    id: randomUUID(),
    leadId,
    activityType,
    title,
    detail: detail || null,
  });
}

