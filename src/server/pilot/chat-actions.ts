import { tool } from 'ai';
import { z } from 'zod';
import { createConfirmation } from './confirmations.js';
import type { ConfirmationCard } from './confirmation-card.js';

export type ActionLink = { label: string; href: string };
export type PendingCard = { token: string; tool: string; card: ConfirmationCard };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTool = any;
type Options = { tenantId: string; /** Called with each confirmation card the owner must answer. */ onCard: (card: PendingCard) => void; /** False for chat windows that cannot show Confirm / Cancel buttons. */ canConfirm: boolean };

/**
 * Turns the action tools into the versions the AI model gets. The model cannot pass `confirmed` at all: it can only
 * PREPARE an action. Preparing returns a confirmation card for the owner, signed by the server. The action runs
 * only when the owner presses Confirm, which is a separate signed-in request to /api/chat/confirm.
 */
export function forModel<T extends Record<string, AnyTool>>(tools: T, { tenantId, onCard, canConfirm }: Options): T {
  const out: Record<string, unknown> = {};
  for (const [name, original] of Object.entries(tools)) {
    const schema = original.inputSchema as z.ZodObject<z.ZodRawShape>;
    if (!schema?.shape || !('confirmed' in schema.shape)) { out[name] = original; continue; }
    out[name] = tool({
      description: `${original.description ?? ''} You cannot confirm this yourself: it only prepares the action for the owner to confirm with a button.`,
      inputSchema: schema.omit({ confirmed: true }),
      execute: async (input: Record<string, unknown>, options: unknown) => {
        const result = await (original.execute as (input: unknown, options: unknown) => Promise<Record<string, any>>)({ ...input, confirmed: false }, options);
        if (!result?.needsConfirmation) return result;
        if (!canConfirm || !result.card) return { ok: false, message: 'This chat window cannot show confirmation buttons, so nothing was done. Tell the owner to use the Pilot chat button in the bottom-right corner of their workspace to confirm this.' };
        onCard({ token: createConfirmation(tenantId, { tool: name, input }), tool: name, card: result.card });
        return { ok: false, awaitingOwnerConfirmation: true, preparedAction: result.card.title, details: result.card.lines, message: 'A confirmation card with Confirm and Cancel buttons is now showing to the owner. Nothing has happened yet. Say in one short sentence what you prepared and that they can press Confirm to go ahead. You cannot confirm for them.' };
      },
    });
  }
  return out as T;
}

/** Real, short descriptions of what Pilot is doing, shown only while a tool is actually running. */
export function statusFor(toolName: string, input: Record<string, unknown> | undefined): string {
  const name = typeof input?.customerName === 'string' ? input.customerName : typeof input?.name === 'string' ? input.name : '';
  const first = name.trim().split(/\s+/)[0];
  switch (toolName) {
    case 'getBusinessContext': {
      const topic = String(input?.topic ?? '');
      if (/schedule/.test(topic)) return 'Checking your schedule…';
      if (/invoice|finance|payment|quote/.test(topic)) return 'Looking at your invoices…';
      if (/customer/.test(topic)) return first ? `Looking up ${first}…` : 'Looking up your customers…';
      if (topic === 'leads') return 'Checking your leads…';
      if (topic === 'jobs_orders') return 'Checking your jobs…';
      return 'Checking your business records…';
    }
    case 'getCustomerSummary': case 'searchCustomers': return first ? `Looking up ${first}…` : 'Looking up your customers…';
    case 'getFinanceSummary': case 'getSalesInsights': return 'Checking your finances…';
    case 'getLeadsAndJobs': return input?.record === 'leads' ? 'Checking your leads…' : 'Checking your jobs…';
    case 'getAppointments': case 'searchAppointments': case 'getDailyBriefing': return 'Checking your schedule…';
    case 'getRescheduleOptions': case 'getAvailableAppointmentTimes': return 'Checking availability…';
    case 'getInactiveCustomers': case 'getFollowUps': case 'getNewestCustomers': case 'getNewCustomerCount': return 'Looking through your customers…';
    case 'sendInvoice': return first ? `Looking up ${first}’s invoice…` : 'Looking up the invoice…';
    case 'sendQuote': return first ? `Looking up ${first}’s quote…` : 'Looking up the quote…';
    case 'draftSchedule': case 'publishSchedule': case 'sendSchedule': return 'Preparing the schedule…';
    case 'changeAppointment': return 'Checking availability…';
    case 'createQuote': case 'createInvoice': case 'createJob': case 'createCustomer': case 'createLead': case 'recordPayment': return 'Preparing that for you to confirm…';
    case 'getBusinessInsights': return 'Reviewing your business…';
    case 'searchBusinessKnowledge': case 'searchImportedWebsiteKnowledge': case 'searchPilotLearning': return 'Checking what I know about your business…';
    default: return 'Working on it…';
  }
}

/** Links to the records a read tool just looked at, so the owner can jump straight to them. */
export function linksFor(toolName: string, input: Record<string, unknown> | undefined, output: unknown): ActionLink[] {
  const result = (output && typeof output === 'object' ? output : {}) as Record<string, any>;
  const links: ActionLink[] = [];
  if (result.link?.href) links.push(result.link);
  if (Array.isArray(result.links)) links.push(...result.links.filter((item: ActionLink) => item?.href));
  const customerLink = (id: unknown, name: unknown) => { if (typeof id === 'string') links.push({ label: `Open ${typeof name === 'string' ? name : 'customer'}`, href: `/dashboard/customers/${id}` }); };
  if (toolName === 'getCustomerSummary' && Array.isArray(result.customers)) result.customers.slice(0, 3).forEach((row: any) => customerLink(row.id, row.name));
  if (toolName === 'searchCustomers' && Array.isArray(result.customers)) result.customers.slice(0, 3).forEach((row: any) => customerLink(row.id, row.name));
  if (toolName === 'getBusinessContext') {
    const topic = String(input?.topic ?? '');
    if (/schedule/.test(topic)) links.push({ label: 'Open scheduling', href: '/scheduling' });
    else if (/invoice|finance|payment|quote/.test(topic)) links.push({ label: 'Open invoices', href: '/finance' });
    else if (topic === 'leads') links.push({ label: 'Open leads', href: '/leads' });
    else if (topic === 'jobs_orders') links.push({ label: 'Open jobs', href: '/jobs' });
    else if (topic === 'customer_history') customerLink(result.customer?.id, result.customer?.name);
  }
  if (toolName === 'getFinanceSummary' || toolName === 'getSalesInsights') links.push({ label: 'Open invoices', href: '/finance' });
  if (toolName === 'getLeadsAndJobs') links.push(input?.record === 'leads' ? { label: 'Open leads', href: '/leads' } : { label: 'Open jobs', href: '/jobs' });
  if (toolName === 'getAppointments' || toolName === 'searchAppointments' || toolName === 'getDailyBriefing') links.push({ label: 'Open calendar', href: '/calendar' });
  const seen = new Set<string>();
  return links.filter((item) => (seen.has(item.href) ? false : (seen.add(item.href), true))).slice(0, 4);
}
