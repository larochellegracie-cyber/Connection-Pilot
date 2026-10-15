import type { Request, Response } from 'express';
import { desc, eq } from 'drizzle-orm';
import { db } from '@/server/db/client.js';
import { customer, customerConversation, customerInteraction } from '@/server/db/schema.js';
import { getTenant } from '../customers/tenant.js';

type MessageRecord = {
  id: string;
  customerId: string;
  customerName: string;
  channel: string;
  direction: string;
  content: string;
  occurredAt: Date;
};

export default async function handler(req: Request, res: Response) {
  try {
    const tenant = await getTenant(req, res);
    if (!tenant) return;
    const [conversations, interactions] = await Promise.all([
      db.select({ id: customerConversation.id, customerId: customer.id, customerName: customer.name, channel: customerConversation.channel, direction: customerConversation.direction, content: customerConversation.content, occurredAt: customerConversation.occurredAt })
        .from(customerConversation).innerJoin(customer, eq(customerConversation.customerId, customer.id))
        .where(eq(customer.businessProfileId, tenant.id)).orderBy(desc(customerConversation.occurredAt)).limit(100),
      db.select({ id: customerInteraction.id, customerId: customer.id, customerName: customer.name, channel: customerInteraction.interactionType, direction: customerInteraction.direction, content: customerInteraction.conversation, summary: customerInteraction.summary, occurredAt: customerInteraction.occurredAt })
        .from(customerInteraction).innerJoin(customer, eq(customerInteraction.customerId, customer.id))
        .where(eq(customer.businessProfileId, tenant.id)).orderBy(desc(customerInteraction.occurredAt)).limit(100),
    ]);
    const messages: MessageRecord[] = [...conversations, ...interactions]
      .map((message) => ({ ...message, content: message.content || ('summary' in message ? message.summary || '' : '') }))
      .filter((message) => Boolean(message.content.trim()))
      .sort((left, right) => right.occurredAt.getTime() - left.occurredAt.getTime())
      .slice(0, 100);
    res.json({ messages });
  } catch (error) {
    res.status(500).json({ error: 'Unable to load customer messages.', message: String(error) });
  }
}
