import type { Request } from 'express';
import { and, desc, eq, inArray, like, ne, sql } from 'drizzle-orm';
import { tool } from 'ai';
import { z } from 'zod';
import { db } from '@/server/db/client.js';
import { customer, financeLineItem, invoice, job } from '@/server/db/schema.js';
import { getCalendarSettings } from '@/server/api/calendar/shared.js';
import { invoiceNumber, sendInvoiceEmail } from '@/server/finance/send-invoice.js';
import copyPreviousWeek from '@/server/api/schedules/copy-previous/POST.js';
import pilotDraft from '@/server/api/schedules/pilot-draft/POST.js';
import { callRoute, errorText, succeeded } from './route-call.js';
import { resolveScheduleWeek } from './schedule-week.js';

type Context = { tenantId: string; businessName: string; request: Pick<Request, 'headers'>; now?: () => Date };

const money = (value: string | number) => new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(Number(value) || 0);
const STOP_WORDS = new Set(['the', 'for', 'his', 'her', 'their', 'and', 'with', 'invoice', 'job', 'service', 'work', 'that', 'this', 'from']);
const words = (text: string) => text.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 2 && !STOP_WORDS.has(word));

/**
 * Pilot actions that change business data or send something to a customer. Every one of them
 * asks for confirmation first, runs the same code the screens use, and only reports success when
 * that code succeeded. A failure is reported as a failure, with its reason.
 */
export function createActionTools({ tenantId, businessName, request, now = () => new Date() }: Context) {
  const findCustomer = (name: string) => db.select({ id: customer.id, name: customer.name, email: customer.email }).from(customer)
    .where(and(eq(customer.businessProfileId, tenantId), sql`${customer.archivedAt} IS NULL`, like(customer.name, `%${name.trim()}%`))).limit(3);

  return {
    sendInvoice: tool({
      description: 'Email an existing invoice to the customer. Use when the owner asks to send, email or resend an invoice. Identify one customer and one invoice (use invoiceDescription for words like "pool cleaning"). Always call first with confirmed=false so the owner can approve the exact invoice and email address; only call with confirmed=true after the owner clearly says yes. Never say an invoice was sent unless this tool returns ok: true.',
      inputSchema: z.object({
        customerName: z.string().min(1).max(120),
        invoiceDescription: z.string().max(200).optional().describe('What the invoice was for, e.g. "pool cleaning".'),
        invoiceId: z.string().uuid().optional(),
        confirmed: z.boolean().default(false),
      }),
      execute: async ({ customerName, invoiceDescription, invoiceId, confirmed }) => {
        const matches = await findCustomer(customerName);
        if (matches.length !== 1) return { ok: false, message: matches.length ? 'More than one customer matches that name. Ask the owner which one.' : 'No active customer matches that name.' };
        const person = matches[0];

        const rows = await db.select({ id: invoice.id, status: invoice.status, total: invoice.total, createdAt: invoice.createdAt, jobService: job.service })
          .from(invoice).leftJoin(job, eq(invoice.jobId, job.id))
          .where(and(eq(invoice.businessProfileId, tenantId), eq(invoice.customerId, person.id), ne(invoice.status, 'void'), ...(invoiceId ? [eq(invoice.id, invoiceId)] : [])))
          .orderBy(desc(invoice.createdAt)).limit(10);
        if (!rows.length) return { ok: false, message: `${person.name} has no invoice to send.` };

        const lines = await db.select({ invoiceId: financeLineItem.invoiceId, description: financeLineItem.description }).from(financeLineItem).where(inArray(financeLineItem.invoiceId, rows.map((row) => row.id)));
        const describe = (row: (typeof rows)[number]) => ({ invoiceId: row.id, invoiceNumber: invoiceNumber(row.id), total: money(row.total), status: row.status, for: row.jobService || lines.find((line) => line.invoiceId === row.id)?.description || 'No description' });
        const wanted = words(invoiceDescription ?? '');
        const candidates = wanted.length
          ? rows.filter((row) => { const haystack = `${row.jobService ?? ''} ${lines.filter((line) => line.invoiceId === row.id).map((line) => line.description).join(' ')}`.toLowerCase(); return wanted.every((word) => haystack.includes(word)); })
          : rows;
        if (!candidates.length) return { ok: false, message: `None of ${person.name}'s invoices match "${invoiceDescription}". Show the owner these and ask which one.`, invoices: rows.map(describe) };
        if (candidates.length > 1) return { ok: false, message: `${person.name} has more than one matching invoice. Ask the owner which one to send.`, invoices: candidates.map(describe) };

        const chosen = candidates[0];
        const email = person.email?.trim();
        if (!email) return { ok: false, message: `${person.name} has no email address on file, so the invoice cannot be sent. The owner can add one on the customer's profile.` };
        const summary = { customerName: person.name, sendTo: email, ...describe(chosen), alreadySent: chosen.status !== 'draft' };
        if (!confirmed) return { ok: false, needsConfirmation: true, ...summary, message: 'Nothing has been sent yet. Ask the owner to confirm sending this exact invoice to this email address.' };

        const result = await sendInvoiceEmail({ id: tenantId, businessName }, chosen.id);
        if (!result.ok) return { ok: false, sent: false, message: `The invoice was NOT sent. ${result.error}`, ...(result.setupRequired && { setupRequired: true }) };
        return { ok: true, sent: true, customerName: person.name, sentTo: result.sentTo, invoiceNumber: result.invoiceNumber, message: `Invoice ${result.invoiceNumber} was emailed to ${result.sentTo}.` };
      },
    }),

    draftSchedule: tool({
      description: 'Create an editable DRAFT schedule for a week: optionally copy the previous week, then apply changes written the way the owner would say them, e.g. "Avery off Friday", "Add Sam Tuesday-Friday 8-5", "move Avery\'s Monday shift to Tuesday". It never publishes the schedule and never emails employees. Always call first with confirmed=false so the owner can approve; only call with confirmed=true after they clearly say yes. After it succeeds, tell the owner the draft must be reviewed and published from the Scheduling page. Never claim shifts were changed unless this tool returns ok: true.',
      inputSchema: z.object({
        week: z.string().min(1).max(20).describe('"this", "next", or any date (YYYY-MM-DD) inside the target week.'),
        copyPreviousWeek: z.boolean().default(false),
        changes: z.array(z.string().min(1).max(300)).max(8).default([]),
        confirmed: z.boolean().default(false),
      }),
      execute: async ({ week, copyPreviousWeek: copy, changes, confirmed }) => {
        if (!copy && !changes.length) return { ok: false, message: 'Say what the draft should contain: copy the previous week, add shifts, or both.' };
        const { timezone } = await getCalendarSettings(tenantId);
        const target = resolveScheduleWeek(week, now(), timezone);
        if (!target) return { ok: false, message: 'Which week? Use "this", "next", or a date.' };
        const plan = { week: target.label, copyPreviousWeek: copy, changes };
        if (!confirmed) return { ok: false, needsConfirmation: true, proposedDraft: plan, message: `Nothing has been created yet. Ask the owner to confirm creating an editable draft schedule for ${target.label}. It will not be published or sent to employees.` };

        const done: string[] = [];
        if (copy) {
          const copied = await callRoute(copyPreviousWeek, request, { weekStart: target.weekStartIso });
          if (!succeeded(copied)) return { ok: false, completed: done, message: `The draft was NOT created. ${errorText(copied, 'The previous week could not be copied.')}` };
          done.push(`Copied ${String(copied.body.copied ?? '')} shifts from the previous week`.replace('  ', ' '));
        }
        for (const change of changes) {
          const applied = await callRoute(pilotDraft, request, { weekStart: target.weekStartIso, instruction: change });
          if (!succeeded(applied)) return { ok: false, completed: done, failedChange: change, message: `${done.length ? 'Part of the draft was saved, but' : 'The draft was NOT created, because'} "${change}" could not be applied: ${errorText(applied, 'Pilot could not apply that change.')}` };
          const summary = [applied.body.created ? `${applied.body.created} added` : '', applied.body.removed ? `${applied.body.removed} removed` : '', applied.body.moved ? `${applied.body.moved} moved` : '', applied.body.skipped ? `${applied.body.skipped} already there` : ''].filter(Boolean).join(', ');
          done.push(`${change}${summary ? ` (${summary})` : ''}`);
        }
        return { ok: true, draft: true, week: target.label, completed: done, message: `Draft schedule saved for ${target.label}. It is a draft: it has not been published or sent to employees. Review and publish it from the Scheduling page.` };
      },
    }),
  };
}
