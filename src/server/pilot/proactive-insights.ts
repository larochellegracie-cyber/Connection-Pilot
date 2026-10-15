export type InsightPriority = 'needs_attention' | 'keep_an_eye_on' | 'opportunity';
export type InsightAction = { label: string; href: string };
export type PilotInsight = {
  id: string;
  priority: InsightPriority;
  category: string;
  title: string;
  whatHappened: string;
  whyItMatters: string;
  recommendation: string;
  evidence: string[];
  action?: InsightAction;
  score: number;
};

type UpcomingRecord = { id: string; title: string; scheduledAt: Date; customerName: string };
type FollowUp = { id: string; customerName: string; summary: string | null; occurredAt: Date };
type InvoiceRecord = { id: string; customerName: string; total: number; dueAt: Date | null; status: string };
type QuoteRecord = { id: string; customerName: string; total: number; createdAt: Date; status: string };
type KnowledgeFact = { id: string; kind: string; subject: string; predicate: string; value: string; unit: string | null; details: string | null };
type AppointmentRecord = UpcomingRecord & { durationMinutes: number };

export type ProactiveInsightInput = {
  businessType: string;
  now: Date;
  upcoming: UpcomingRecord[];
  appointments: AppointmentRecord[];
  followUps: FollowUp[];
  invoices: InvoiceRecord[];
  quotes: QuoteRecord[];
  facts: KnowledgeFact[];
  allowOverlaps: boolean;
};

function clean(value: string) { return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
function money(value: number) { return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(value); }
function dateLabel(value: Date) { return new Intl.DateTimeFormat('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(value); }
function add(insights: PilotInsight[], insight: Omit<PilotInsight, 'score'>, score: number) { insights.push({ ...insight, score }); }
function matchesFact(title: string, fact: KnowledgeFact) {
  const record = clean(title); const subject = clean(fact.subject);
  return subject.length >= 4 && (record.includes(subject) || subject.includes(record));
}

export function buildProactiveInsights(input: ProactiveInsightInput) {
  const insights: PilotInsight[] = [];
  const upcoming = input.upcoming.filter((record) => record.scheduledAt >= input.now).sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());

  for (const followUp of input.followUps.slice(0, 3)) {
    add(insights, {
      id: `follow-up-${followUp.id}`, priority: 'needs_attention', category: 'Customer follow-up', title: `${followUp.customerName} needs a follow-up`,
      whatHappened: followUp.summary ? `A documented follow-up is open: ${followUp.summary}` : 'A documented customer follow-up is open.',
      whyItMatters: 'The customer record is marked for follow-up, so this conversation could be waiting on your response.',
      recommendation: 'Review the customer record and decide on the next response.', evidence: [`Customer follow-up recorded ${dateLabel(followUp.occurredAt)}.`], action: { label: 'Open customer', href: '/customers' },
    }, 100);
  }

  for (const invoice of input.invoices.filter((item) => item.status === 'overdue' || (item.dueAt !== null && item.dueAt < input.now)).slice(0, 3)) {
    add(insights, {
      id: `invoice-${invoice.id}`, priority: 'needs_attention', category: 'Unpaid invoice', title: `${invoice.customerName} has an invoice to review`,
      whatHappened: `An ${invoice.status === 'overdue' ? 'overdue' : 'past-due'} invoice for ${money(invoice.total)} is recorded${invoice.dueAt ? ` with a due date of ${dateLabel(invoice.dueAt)}` : ''}.`,
      whyItMatters: 'The invoice remains unpaid in the business records.', recommendation: 'Review the invoice and decide whether a follow-up is appropriate.',
      evidence: [`Invoice status: ${invoice.status}.`], action: { label: 'Open finance', href: '/finance' },
    }, 96);
  }

  for (const quote of input.quotes.filter((item) => item.status === 'sent' && input.now.getTime() - item.createdAt.getTime() >= 7 * 24 * 60 * 60 * 1000).slice(0, 3)) {
    add(insights, {
      id: `quote-${quote.id}`, priority: 'keep_an_eye_on', category: 'Quote follow-up', title: `${quote.customerName}'s quote has been waiting`,
      whatHappened: `A sent quote for ${money(quote.total)} has been open since ${dateLabel(quote.createdAt)}.`,
      whyItMatters: 'It has been open for at least seven days without an accepted or declined status.', recommendation: 'Review the quote and decide whether to follow up.',
      evidence: [`Quote status: ${quote.status}.`], action: { label: 'Open finance', href: '/finance' },
    }, 75);
  }

  if (!input.allowOverlaps) {
    const appointments = [...input.appointments].sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
    for (let index = 1; index < appointments.length; index += 1) {
      const previous = appointments[index - 1]; const current = appointments[index];
      if (previous.scheduledAt.getTime() + previous.durationMinutes * 60_000 > current.scheduledAt.getTime()) {
        add(insights, {
          id: `schedule-conflict-${previous.id}-${current.id}`, priority: 'needs_attention', category: 'Scheduling conflict', title: 'Two appointments overlap',
          whatHappened: `${previous.title} for ${previous.customerName} at ${dateLabel(previous.scheduledAt)} overlaps with ${current.title} for ${current.customerName} at ${dateLabel(current.scheduledAt)}.`,
          whyItMatters: 'Your booking settings do not allow overlapping appointments.', recommendation: 'Review the appointment times before the scheduled work begins.',
          evidence: [`${previous.title}: ${dateLabel(previous.scheduledAt)} for ${previous.durationMinutes} minutes.`, `${current.title}: ${dateLabel(current.scheduledAt)} for ${current.durationMinutes} minutes.`], action: { label: 'Open calendar', href: '/calendar' },
        }, 95);
      }
    }
  }

  const resourceFacts = input.facts.filter((fact) => fact.kind === 'resource_requirement');
  const supplierFacts = input.facts.filter((fact) => fact.kind === 'supplier_relationship' && /lead time/i.test(fact.predicate));
  for (const record of upcoming.slice(0, 6)) {
    const requirement = resourceFacts.find((fact) => matchesFact(record.title, fact));
    if (!requirement || !supplierFacts.length) continue;
    const supplier = supplierFacts[0];
    add(insights, {
      id: `supplier-timing-${record.id}-${supplier.id}`, priority: 'keep_an_eye_on', category: 'Supplier timing', title: `Prepare for ${record.title}`,
      whatHappened: `${record.title} is scheduled for ${dateLabel(record.scheduledAt)}. Confirmed business knowledge says it requires ${requirement.value}${requirement.unit ? ` ${requirement.unit}` : ''} of ${requirement.details || 'a documented material'}, and ${supplier.subject} has a documented ${supplier.value} lead time${supplier.details ? ` (${supplier.details})` : ''}.`,
      whyItMatters: 'The order and supplier facts are documented, but current stock is not available to Pilot.', recommendation: 'Review required materials and supplier timing before the scheduled work.',
      evidence: [`Upcoming record: ${record.title} for ${record.customerName} on ${dateLabel(record.scheduledAt)}.`, `Confirmed knowledge: ${requirement.subject} requires ${requirement.value}${requirement.unit ? ` ${requirement.unit}` : ''}.`, `Confirmed knowledge: ${supplier.subject} lead time is ${supplier.value}.`], action: { label: 'Open orders', href: '/jobs' },
    }, 70);
  }

  if (upcoming.length && !insights.some((insight) => insight.category === 'Supplier timing')) {
    const record = upcoming[0];
    add(insights, {
      id: `upcoming-${record.id}`, priority: 'opportunity', category: input.businessType.toLowerCase().includes('bak') ? 'Upcoming order' : 'Upcoming work', title: `${record.title} is coming up`,
      whatHappened: `${record.title} for ${record.customerName} is scheduled for ${dateLabel(record.scheduledAt)}.`,
      whyItMatters: 'It is one of the next documented items on the schedule.', recommendation: 'Review the record for any preparation or customer details.',
      evidence: [`Scheduled record: ${record.title} on ${dateLabel(record.scheduledAt)}.`], action: { label: 'Open schedule', href: input.businessType.toLowerCase().includes('bak') ? '/jobs' : '/calendar' },
    }, 40);
  }

  return insights.sort((a, b) => b.score - a.score).slice(0, 6);
}
