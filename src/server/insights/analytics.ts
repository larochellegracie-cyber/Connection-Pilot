/**
 * Business trends and patterns for the Insights page, computed from real records.
 * Pure functions: give them rows, get numbers. Nothing here is invented or estimated;
 * when there is not enough data, a section is simply empty.
 */
export type InsightsInput = {
  now: Date;
  timezone: string;
  payments: { amount: number | string; occurredAt: Date }[];            // completed payments only
  customers: { createdAt: Date | null; lastContactedAt: Date | null }[]; // active (not archived) customers
  appointments: { scheduledAt: Date; status: string }[];
  jobs: { service: string; createdAt: Date | null }[];
  openInvoices: { id: string; total: number | string; dueAt: Date | null }[];
  receivedByInvoice: Map<string, number>;
};

export type Comparison = { key: 'revenue' | 'newCustomers' | 'appointments' | 'cancellationRate'; label: string; format: 'money' | 'count' | 'percent'; current: number; previous: number; change: number | null; direction: 'up' | 'down' | 'flat' | 'new'; good: boolean | null };
export type Pattern = { id: string; tone: 'positive' | 'attention' | 'opportunity' | 'neutral'; title: string; detail: string; href?: string; hrefLabel?: string };
export type InsightsAnalytics = {
  periodDays: number;
  comparison: Comparison[];
  weekly: { weekStart: string; label: string; revenue: number; newCustomers: number; appointments: number }[];
  busiestDays: { day: string; appointments: number }[];
  topServices: { service: string; jobs: number }[];
  receivables: { total: number; overdue: number; buckets: { key: string; label: string; amount: number; count: number }[] };
  customerHealth: { active: number; cooling: number; quiet: number; total: number };
  patterns: Pattern[];
  hasData: boolean;
};

const DAY_MS = 86_400_000;
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WEEKDAY_NAMES = ['Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays', 'Sundays'];
const num = (value: unknown) => Number(value) || 0;
const money = (value: number) => new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(value);

/** Local calendar date (YYYY-MM-DD) in the business time zone. */
function localDate(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
function addDays(date: string, days: number): string {
  const next = new Date(`${date}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}
/** Monday = 0 … Sunday = 6, for a YYYY-MM-DD date. */
const weekdayIndex = (date: string) => (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7;
const mondayOf = (date: string) => addDays(date, -weekdayIndex(date));

function change(current: number, previous: number): { change: number | null; direction: Comparison['direction'] } {
  if (previous === 0) return current === 0 ? { change: null, direction: 'flat' } : { change: null, direction: 'new' };
  const pct = ((current - previous) / previous) * 100;
  return { change: Math.round(pct), direction: Math.abs(pct) < 1 ? 'flat' : pct > 0 ? 'up' : 'down' };
}

export function buildInsights(input: InsightsInput): InsightsAnalytics {
  const { now, timezone } = input;
  const inWindow = (date: Date | null, fromDaysAgo: number, toDaysAgo: number) => !!date && date.getTime() >= now.getTime() - fromDaysAgo * DAY_MS && date.getTime() < now.getTime() - toDaysAgo * DAY_MS;
  const sum = (rows: InsightsInput['payments'], from: number, to: number) => rows.filter((row) => inWindow(row.occurredAt, from, to)).reduce((total, row) => total + num(row.amount), 0);

  // ---- last 30 days against the 30 before them
  const heldNow = input.appointments.filter((item) => inWindow(item.scheduledAt, 30, 0));
  const heldBefore = input.appointments.filter((item) => inWindow(item.scheduledAt, 60, 30));
  const notCancelled = (items: typeof heldNow) => items.filter((item) => item.status !== 'cancelled').length;
  const rate = (items: typeof heldNow) => (items.length ? Math.round((items.filter((item) => item.status === 'cancelled').length / items.length) * 100) : 0);
  const comparison: Comparison[] = [
    { key: 'revenue', label: 'Revenue', format: 'money', current: sum(input.payments, 30, 0), previous: sum(input.payments, 60, 30) },
    { key: 'newCustomers', label: 'New customers', format: 'count', current: input.customers.filter((item) => inWindow(item.createdAt, 30, 0)).length, previous: input.customers.filter((item) => inWindow(item.createdAt, 60, 30)).length },
    { key: 'appointments', label: 'Appointments', format: 'count', current: notCancelled(heldNow), previous: notCancelled(heldBefore) },
    { key: 'cancellationRate', label: 'Cancellation rate', format: 'percent', current: rate(heldNow), previous: rate(heldBefore) },
  ].map((item) => {
    const { change: pct, direction } = change(item.current, item.previous);
    const lowerIsBetter = item.key === 'cancellationRate';
    const good = direction === 'flat' ? null : direction === 'new' ? !lowerIsBetter : lowerIsBetter ? direction === 'down' : direction === 'up';
    return { ...item, change: pct, direction, good } as Comparison;
  });

  // ---- eight weeks, oldest first, the current week last
  const thisMonday = mondayOf(localDate(now, timezone));
  const weekStarts = Array.from({ length: 8 }, (_, index) => addDays(thisMonday, (index - 7) * 7));
  const weekIndexFor = (date: Date | null) => {
    if (!date) return -1;
    return weekStarts.indexOf(mondayOf(localDate(date, timezone)));
  };
  const weekly = weekStarts.map((weekStart) => ({
    weekStart,
    label: new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(new Date(`${weekStart}T12:00:00Z`)),
    revenue: 0, newCustomers: 0, appointments: 0,
  }));
  for (const payment of input.payments) { const index = weekIndexFor(payment.occurredAt); if (index >= 0) weekly[index].revenue += num(payment.amount); }
  for (const customer of input.customers) { const index = weekIndexFor(customer.createdAt); if (index >= 0) weekly[index].newCustomers += 1; }
  for (const appointment of input.appointments) { if (appointment.status === 'cancelled') continue; const index = weekIndexFor(appointment.scheduledAt); if (index >= 0) weekly[index].appointments += 1; }

  // ---- busiest days over the last 90 days (appointments that were not cancelled)
  const dayCounts = WEEKDAYS.map((day) => ({ day, appointments: 0 }));
  for (const appointment of input.appointments) {
    if (appointment.status === 'cancelled' || !inWindow(appointment.scheduledAt, 90, 0)) continue;
    dayCounts[weekdayIndex(localDate(appointment.scheduledAt, timezone))].appointments += 1;
  }

  // ---- most booked services over the last 90 days
  const serviceCounts = new Map<string, { service: string; jobs: number }>();
  for (const job of input.jobs) {
    if (!inWindow(job.createdAt, 90, 0)) continue;
    const key = job.service.trim().toLowerCase();
    if (!key) continue;
    const existing = serviceCounts.get(key) ?? { service: job.service.trim(), jobs: 0 };
    existing.jobs += 1;
    serviceCounts.set(key, existing);
  }
  const topServices = [...serviceCounts.values()].sort((a, b) => b.jobs - a.jobs || a.service.localeCompare(b.service)).slice(0, 5);

  // ---- money still owed, by how late it is
  const bucketDefs = [
    { key: 'current', label: 'Not yet due' }, { key: 'late30', label: '1–30 days late' }, { key: 'late60', label: '31–60 days late' }, { key: 'late60plus', label: 'Over 60 days late' }, { key: 'noDueDate', label: 'No due date' },
  ];
  const buckets = bucketDefs.map((def) => ({ ...def, amount: 0, count: 0 }));
  for (const invoice of input.openInvoices) {
    const owing = Math.max(0, num(invoice.total) - (input.receivedByInvoice.get(invoice.id) ?? 0));
    if (owing <= 0) continue;
    const daysLate = invoice.dueAt ? Math.floor((now.getTime() - invoice.dueAt.getTime()) / DAY_MS) : null;
    const bucket = daysLate === null ? 4 : daysLate <= 0 ? 0 : daysLate <= 30 ? 1 : daysLate <= 60 ? 2 : 3;
    buckets[bucket].amount += owing; buckets[bucket].count += 1;
  }
  const receivables = { total: buckets.reduce((sum, item) => sum + item.amount, 0), overdue: buckets[1].amount + buckets[2].amount + buckets[3].amount, buckets };

  // ---- how recently customers were in touch
  const customerHealth = { active: 0, cooling: 0, quiet: 0, total: input.customers.length };
  for (const customer of input.customers) {
    const days = customer.lastContactedAt ? Math.floor((now.getTime() - customer.lastContactedAt.getTime()) / DAY_MS) : null;
    if (days !== null && days <= 7) customerHealth.active += 1;
    else if (days !== null && days <= 30) customerHealth.cooling += 1;
    else customerHealth.quiet += 1;
  }

  // ---- patterns, written out in plain words
  const patterns: Pattern[] = [];
  const revenue = comparison[0];
  if (revenue.previous > 0 && revenue.change !== null && Math.abs(revenue.change) >= 10) {
    patterns.push({ id: 'revenue-trend', tone: revenue.change > 0 ? 'positive' : 'attention', title: `Revenue is ${revenue.change > 0 ? 'up' : 'down'} ${Math.abs(revenue.change)}%`, detail: `${money(revenue.current)} in the last 30 days, compared with ${money(revenue.previous)} in the 30 days before.` });
  }
  const totalBooked = dayCounts.reduce((sum, item) => sum + item.appointments, 0);
  if (totalBooked >= 5) {
    const busiest = dayCounts.reduce((best, item, index) => (item.appointments > dayCounts[best].appointments ? index : best), 0);
    patterns.push({ id: 'busiest-day', tone: 'neutral', title: `${WEEKDAY_NAMES[busiest]} are your busiest day`, detail: `${dayCounts[busiest].appointments} of ${totalBooked} appointments in the last 90 days (${Math.round((dayCounts[busiest].appointments / totalBooked) * 100)}%).` });
    const quiet = dayCounts.slice(0, 5).reduce((low, item, index) => (item.appointments < dayCounts[low].appointments ? index : low), 0);
    if (quiet !== busiest && dayCounts[busiest].appointments >= 3 && dayCounts[quiet].appointments <= dayCounts[busiest].appointments * 0.25) {
      patterns.push({ id: 'quiet-day', tone: 'opportunity', title: `${WEEKDAY_NAMES[quiet]} are quiet`, detail: `Only ${dayCounts[quiet].appointments} appointment${dayCounts[quiet].appointments === 1 ? '' : 's'} on ${WEEKDAY_NAMES[quiet]} in 90 days, against ${dayCounts[busiest].appointments} on ${WEEKDAY_NAMES[busiest]}. A good day to offer openings or a promotion.`, href: '/calendar', hrefLabel: 'Open calendar' });
    }
  }
  const cancellation = comparison[3];
  if (heldNow.length >= 4 && cancellation.current >= 15) {
    patterns.push({ id: 'cancellations', tone: 'attention', title: `${cancellation.current}% of appointments were cancelled`, detail: `${heldNow.filter((item) => item.status === 'cancelled').length} of ${heldNow.length} appointments in the last 30 days.`, href: '/calendar', hrefLabel: 'Review appointments' });
  }
  if (receivables.overdue > 0) {
    const lateCount = buckets[1].count + buckets[2].count + buckets[3].count;
    patterns.push({ id: 'overdue', tone: 'attention', title: `${money(receivables.overdue)} is overdue`, detail: `Across ${lateCount} invoice${lateCount === 1 ? '' : 's'} past their due date.`, href: '/finance', hrefLabel: 'View invoices' });
  }
  if (customerHealth.quiet >= 3) {
    patterns.push({ id: 'quiet-customers', tone: 'opportunity', title: `${customerHealth.quiet} customers have gone quiet`, detail: 'No contact in over 30 days. A short check-in could bring work back.', href: '/customers', hrefLabel: 'View customers' });
  }
  if (topServices.length) {
    patterns.push({ id: 'top-service', tone: 'neutral', title: `Most booked: ${topServices[0].service}`, detail: `${topServices[0].jobs} job${topServices[0].jobs === 1 ? '' : 's'} in the last 90 days.` });
  }

  const hasData = input.payments.length + input.appointments.length + input.customers.length + input.jobs.length + input.openInvoices.length > 0;
  return { periodDays: 30, comparison, weekly, busiestDays: dayCounts, topServices, receivables, customerHealth, patterns, hasData };
}
