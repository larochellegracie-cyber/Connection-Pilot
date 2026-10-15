import { randomUUID } from 'node:crypto';
import { db } from '@/server/db/client.js';
import { customerActivity } from '@/server/db/schema.js';

export async function logCustomerActivity(customerId: string, activityType: string, title: string, detail?: string | null) {
  await db.insert(customerActivity).values({
    id: randomUUID(),
    customerId,
    activityType,
    title,
    detail: detail || null,
  });
}
