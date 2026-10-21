import type { Request, Response } from 'express';
import { and, eq } from 'drizzle-orm';
import { db } from '@/server/db/client.js';
import { customer, customerNote } from '@/server/db/schema.js';
import { logCustomerActivity } from '../../../activity.js';
import { getTenant, textValue } from '../../../tenant.js';

/**
 * Edits the text of one private note on one customer's profile.
 *
 * The previous wording is written to the customer's activity history
 * ("Private note edited") before the note is changed, so nothing is lost.
 */
export default async function handler(req: Request, res: Response) {
  try {
    const tenant = await getTenant(req, res);
    if (!tenant) return;
    const customerId = typeof req.params.customerId === 'string' ? req.params.customerId : '';
    const noteId = typeof req.params.noteId === 'string' ? req.params.noteId : '';
    const body = textValue(req.body?.body, 5000);
    if (!body) return void res.status(400).json({ error: 'A note is required.' });

    const found = await db.select({ id: customer.id }).from(customer).where(and(eq(customer.id, customerId), eq(customer.businessProfileId, tenant.id))).limit(1);
    if (!found[0]) return void res.status(404).json({ error: 'Customer profile not found.' });

    const notes = await db.select({ id: customerNote.id, body: customerNote.body }).from(customerNote).where(and(eq(customerNote.id, noteId), eq(customerNote.customerId, customerId))).limit(1);
    if (!notes[0]) return void res.status(404).json({ error: 'Note not found.' });

    if (notes[0].body !== body) {
      await logCustomerActivity(customerId, 'note_edited', 'Private note edited', `Before: ${notes[0].body}`);
      await db.update(customerNote).set({ body }).where(and(eq(customerNote.id, noteId), eq(customerNote.customerId, customerId)));
    }
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: 'Unable to update the note.' });
  }
}
