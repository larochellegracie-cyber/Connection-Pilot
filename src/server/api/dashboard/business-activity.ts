/**
 * Builds the dashboard's "Recent activity" feed from real business records.
 *
 * Only things an owner cares about appear: bookings, completed or cancelled
 * appointments, new customers, customer contact, jobs, quotes, invoices,
 * payments, and appointment changes Pilot made. Internal housekeeping (private
 * notes added, edited or removed, customer record edits, provider responses)
 * is never read here, so it can't leak into the feed.
 *
 * Each record shows once, in its latest meaningful state.
 */
export type ActivityKind =
  | 'appointment_booked' | 'appointment_completed' | 'appointment_cancelled' | 'appointment_rescheduled'
  | 'customer_added' | 'customer_contacted'
  | 'job_created' | 'job_completed'
  | 'quote_created' | 'quote_sent' | 'quote_accepted'
  | 'invoice_created' | 'invoice_sent' | 'invoice_paid' | 'payment_received';

export type BusinessActivity = {
  id: string;
  kind: ActivityKind;
  /** Same as kind; kept so older readers of the feed keep working. */
  type: ActivityKind;
  title: string;
  customerId: string | null;
  customerName: string;
  detail: string | null;
  occurredAt: Date;
  byPilot: boolean;
  action: { label: string; href: string } | null;
};

type WithCustomer = { customerId: string; customerName: string };
export type ActivityInput = {
  appointments: (WithCustomer & { id: string; title: string; status: string; scheduledAt: Date; createdAt: Date | null; updatedAt: Date | null })[];
  customers: { id: string; name: string; createdAt: Date | null }[];
  interactions: (WithCustomer & { id: string; interactionType: string; direction: string | null; summary: string | null; occurredAt: Date | null })[];
  conversations: (WithCustomer & { id: string; channel: string; direction: string | null; content: string; occurredAt: Date | null })[];
  jobs: (WithCustomer & { id: string; service: string; status: string; createdAt: Date | null; updatedAt: Date | null })[];
  quotes: (WithCustomer & { id: string; status: string; total: string | number; createdAt: Date | null; updatedAt: Date | null })[];
  invoices: (WithCustomer & { id: string; status: string; total: string | number; createdAt: Date | null; updatedAt: Date | null })[];
  payments: (WithCustomer & { id: string; invoiceId: string | null; amount: string | number; status: string; occurredAt: Date | null })[];
  /** Totals received per invoice (completed payments only), used to tell when an invoice is paid. */
  receivedByInvoice: Map<string, number>;
  /** Appointment changes Pilot made on the owner's behalf. */
  pilotActions: (WithCustomer & { id: string; kind: 'appointment_booked' | 'appointment_rescheduled' | 'appointment_cancelled'; detail: string | null; occurredAt: Date | null })[];
};

export type ActivityOptions = { foodBusiness: boolean; timezone: string; limit?: number; perKindLimit?: number };

const money = (value: string | number) => new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(Number(value) || 0);
const when = (value: Date, timezone: string) => new Intl.DateTimeFormat('en-CA', { timeZone: timezone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(value);
const clip = (value: string | null | undefined, max = 90) => { const text = (value ?? '').replace(/\s+/g, ' ').trim(); return text.length > max ? `${text.slice(0, max - 1)}…` : text; };
const joinDetail = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join(' · ') || null;

const TITLES: Record<ActivityKind, string> = {
  appointment_booked: 'Appointment booked', appointment_completed: 'Appointment completed', appointment_cancelled: 'Appointment cancelled', appointment_rescheduled: 'Appointment rescheduled',
  customer_added: 'New customer added', customer_contacted: 'Customer contacted',
  job_created: 'Job created', job_completed: 'Job completed',
  quote_created: 'Quote created', quote_sent: 'Quote sent', quote_accepted: 'Quote accepted',
  invoice_created: 'Invoice created', invoice_sent: 'Invoice sent', invoice_paid: 'Invoice paid', payment_received: 'Payment received',
};

const stamp = (...values: (Date | null | undefined)[]) => values.find((value): value is Date => value instanceof Date) ?? new Date(0);

const PILOT_WINDOW_MS = 3 * 60_000;

export function buildBusinessActivity(input: ActivityInput, options: ActivityOptions): BusinessActivity[] {
  const { foodBusiness, timezone } = options;
  const limit = options.limit ?? 8;
  const perKindLimit = options.perKindLimit ?? 3;
  const events: BusinessActivity[] = [];
  const customerLink = (customerId: string) => ({ label: 'View customer', href: `/dashboard/customers/${customerId}` });
  const scheduleLink = foodBusiness ? { label: 'View order', href: '/jobs' } : { label: 'View appointment', href: '/calendar' };
  const push = (event: Omit<BusinessActivity, 'type' | 'title' | 'byPilot'> & { title?: string; byPilot?: boolean }) =>
    events.push({ ...event, type: event.kind, title: event.title ?? TITLES[event.kind], byPilot: event.byPilot ?? false });

  for (const item of input.appointments) {
    const kind: ActivityKind = item.status === 'completed' ? 'appointment_completed' : item.status === 'cancelled' ? 'appointment_cancelled' : 'appointment_booked';
    push({ id: `appointment-${item.id}`, kind, customerId: item.customerId, customerName: item.customerName, detail: joinDetail(clip(item.title, 60), when(item.scheduledAt, timezone)), occurredAt: kind === 'appointment_booked' ? stamp(item.createdAt, item.updatedAt) : stamp(item.updatedAt, item.createdAt), action: scheduleLink });
  }

  for (const item of input.customers) push({ id: `customer-${item.id}`, kind: 'customer_added', customerId: item.id, customerName: item.name, detail: null, occurredAt: stamp(item.createdAt), action: customerLink(item.id) });

  for (const item of input.interactions) {
    const channel = item.interactionType === 'call' || item.interactionType === 'phone' ? 'Phone call' : item.interactionType;
    push({ id: `interaction-${item.id}`, kind: 'customer_contacted', customerId: item.customerId, customerName: item.customerName, detail: joinDetail(channel ? channel.charAt(0).toUpperCase() + channel.slice(1) : null, clip(item.summary, 70)), occurredAt: stamp(item.occurredAt), action: customerLink(item.customerId) });
  }
  for (const item of input.conversations) {
    const channel = item.channel === 'sms' ? 'Text message' : item.channel === 'email' ? 'Email' : 'Message';
    push({ id: `conversation-${item.id}`, kind: 'customer_contacted', customerId: item.customerId, customerName: item.customerName, detail: joinDetail(channel, clip(item.content, 70)), occurredAt: stamp(item.occurredAt), action: customerLink(item.customerId) });
  }

  for (const item of input.jobs) {
    const completed = item.status === 'completed';
    push({ id: `job-${item.id}`, kind: completed ? 'job_completed' : 'job_created', title: foodBusiness ? (completed ? 'Order completed' : 'Order created') : undefined, customerId: item.customerId, customerName: item.customerName, detail: clip(item.service, 80) || null, occurredAt: completed ? stamp(item.updatedAt, item.createdAt) : stamp(item.createdAt, item.updatedAt), action: { label: foodBusiness ? 'View order' : 'View job', href: '/jobs' } });
  }

  for (const item of input.quotes) {
    const kind: ActivityKind = item.status === 'accepted' ? 'quote_accepted' : item.status === 'sent' ? 'quote_sent' : 'quote_created';
    push({ id: `quote-${item.id}`, kind, customerId: item.customerId, customerName: item.customerName, detail: money(item.total), occurredAt: kind === 'quote_created' ? stamp(item.createdAt, item.updatedAt) : stamp(item.updatedAt, item.createdAt), action: { label: 'View quote', href: '/finance' } });
  }

  for (const item of input.invoices) {
    const paid = Number(item.total) > 0 && (input.receivedByInvoice.get(item.id) ?? 0) >= Number(item.total);
    const kind: ActivityKind = paid ? 'invoice_paid' : item.status === 'sent' ? 'invoice_sent' : 'invoice_created';
    if (kind === 'invoice_paid') continue; // the payment that settled it is shown below, once
    push({ id: `invoice-${item.id}`, kind, customerId: item.customerId, customerName: item.customerName, detail: money(item.total), occurredAt: kind === 'invoice_created' ? stamp(item.createdAt, item.updatedAt) : stamp(item.updatedAt, item.createdAt), action: { label: 'View invoice', href: '/finance' } });
  }

  const invoiceTotals = new Map(input.invoices.map((item) => [item.id, Number(item.total)]));
  for (const item of input.payments) {
    if (item.status !== 'completed') continue;
    const total = item.invoiceId ? invoiceTotals.get(item.invoiceId) : undefined;
    const settled = item.invoiceId && total !== undefined && total > 0 && (input.receivedByInvoice.get(item.invoiceId) ?? 0) >= total;
    push({ id: `payment-${item.id}`, kind: settled ? 'invoice_paid' : 'payment_received', customerId: item.customerId, customerName: item.customerName, detail: money(item.amount), occurredAt: stamp(item.occurredAt), action: { label: item.invoiceId ? 'View invoice' : 'View payments', href: '/finance' } });
  }

  // Pilot's own actions replace the matching ordinary event, so nothing is listed twice.
  for (const action of input.pilotActions) {
    const twin = events.findIndex((event) => !event.byPilot && event.customerId === action.customerId && event.kind === action.kind && Math.abs(event.occurredAt.getTime() - stamp(action.occurredAt).getTime()) <= PILOT_WINDOW_MS);
    if (twin !== -1) events.splice(twin, 1);
    push({ id: `pilot-${action.id}`, kind: action.kind, customerId: action.customerId, customerName: action.customerName, detail: clip(action.detail, 90) || null, occurredAt: stamp(action.occurredAt), byPilot: true, action: scheduleLink });
  }

  // Newest first, but no single kind of event may crowd out the rest.
  const sorted = events.sort((left, right) => right.occurredAt.getTime() - left.occurredAt.getTime());
  const taken = new Map<ActivityKind, number>();
  const feed: BusinessActivity[] = [];
  for (const event of sorted) {
    const count = taken.get(event.kind) ?? 0;
    if (count >= perKindLimit) continue;
    taken.set(event.kind, count + 1);
    feed.push(event);
    if (feed.length >= limit) break;
  }
  return feed;
}
