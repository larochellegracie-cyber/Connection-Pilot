import { randomUUID } from 'node:crypto';
import { db } from '@/server/db/client.js';
import { customerActivity, jobActivity } from '@/server/db/schema.js';

export const jobStatuses = ['booked', 'in_progress', 'completed', 'invoiced', 'paid', 'cancelled'] as const;
export function isJobStatus(value: string): value is (typeof jobStatuses)[number] { return jobStatuses.includes(value as (typeof jobStatuses)[number]); }

export async function logJobActivity(jobId: string, customerId: string, title: string, detail?: string | null) {
  const occurredAt = new Date();
  await Promise.all([
    db.insert(jobActivity).values({ id: randomUUID(), jobId, activityType: 'job', title, detail: detail || null, occurredAt }),
    db.insert(customerActivity).values({ id: randomUUID(), customerId, activityType: 'job', title, detail: detail || null, occurredAt }),
  ]);
}
