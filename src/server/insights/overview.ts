/**
 * The Insights dashboard: business performance over a chosen period, computed from real records.
 * Pure functions. Give them rows and a range, get numbers; nothing is estimated or invented, and a
 * section with no records is simply empty so the page can say "not enough data yet".
 */
export type RangeKey = 'this_week' | 'this_month' | 'last_month' | 'last_3_months' | 'last_12_months' | 'custom';
export const rangeKeys: RangeKey[] = ['this_week', 'this_month', 'last_month', 'last_3_months', 'last_12_months', 'custom'];
export const rangeLabels: Record<RangeKey, string> = { this_week: 'This week', this_month: 'This month', last_month: 'Last month', last_3_months: 'Last 3 months', last_12_months: 'Last 12 months', custom: 'Custom range' };

export type Granularity = 'day' | 'week' | 'month';
export type ResolvedRange = { key: RangeKey; label: string; from: string; to: string; days: number; previousFrom: string; previousTo: string; granularity: Granularity; start: Date; end: Date; previousStart: Date };

export type OverviewInput = {
  now: Date;
  timezone: string;
  range: ResolvedRange;
  payments: { amount: number | string; occurredAt: Date }[];                 // completed payments
  invoices: { id: string; total: number | string; status: string; dueAt: Date | null; createdAt: Date | null }[]; // created since the previous period began
  openInvoices: { id: string; total: number | string; status: string; dueAt: Date | null }[];                      // every unpaid invoice, whenever created
  receivedByInvoice: Map<string, number>;
  jobs: { status: string; date: Date | null; customerId: string }[];          // date = scheduled date, else created date
  quotes: { status: string; total: number | string; createdAt: Date | null }[];
  leads: { status: string; estimatedValue: number | string | null; createdAt: Date | null }[];
  customers: { id: string; createdAt: Date | null }[];                        // active (not archived)
  appointments: { status: string; scheduledAt: Date; customerId: string }[];
  shifts: { employeeId: string; employeeName: string; startsAt: Date; endsAt: Date }[]; // inside the range
};

const DAY_MS = 86_400_000;
const num = (value: unknown) => Number(value) || 0;
const round2 = (value: number) => Math.round(value * 100) / 100;
const money = (value: number) => new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(value);

export function localDate(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
export function addDays(date: string, days: number): string { const next = new Date(`${date}T12:00:00Z`); next.setUTCDate(next.getUTCDate() + days); return next.toISOString().slice(0, 10); }
const weekdayIndex = (date: string) => (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
const mondayOf = (date: string) => addDays(date, -weekdayIndex(date));
const monthStart = (date: string) => `${date.slice(0, 7)}-01`;
function monthsAgo(date: string, months: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const total = year * 12 + (month - 1) - months;
  const targetYear = Math.floor(total / 12); const targetMonth = (total % 12) + 1;
  const last = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
  return `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(Math.min(day, last)).padStart(2, '0')}`;
}
const daysBetween = (from: string, to: string) => Math.round((new Date(`${to}T12:00:00Z`).getTime() - new Date(`${from}T12:00:00Z`).getTime()) / DAY_MS);

function offsetMs(instant: Date, timezone: string): number {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: timezone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(instant).map((part) => [part.type, part.value]));
  return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second)) - Math.floor(instant.getTime() / 1000) * 1000;
}
/** The instant a local calendar day begins in the business time zone. */
export function zonedMidnight(date: string, timezone: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  const wall = Date.UTC(year, month - 1, day);
  let guess = wall - offsetMs(new Date(wall), timezone);
  guess = wall - offsetMs(new Date(guess), timezone);
  return new Date(guess);
}

const isDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T12:00:00Z`).getTime());

export function resolveRange(key: string | undefined, now: Date, timezone: string, customFrom?: string, customTo?: string): ResolvedRange {
  const today = localDate(now, timezone);
  let range: RangeKey = rangeKeys.includes(key as RangeKey) ? key as RangeKey : 'this_month';
  let from = today; let to = today;
  if (range === 'custom') {
    if (isDate(customFrom) && isDate(customTo) && customFrom <= customTo && daysBetween(customFrom, customTo) <= 800) { from = customFrom; to = customTo; }
    else range = 'this_month';
  }
  if (range === 'this_week') { from = mondayOf(today); to = today; }
  else if (range === 'this_month') { from = monthStart(today); to = today; }
  else if (range === 'last_month') { const lastDay = addDays(monthStart(today), -1); from = monthStart(lastDay); to = lastDay; }
  else if (range === 'last_3_months') { from = addDays(monthsAgo(today, 3), 1); to = today; }
  else if (range === 'last_12_months') { from = addDays(monthsAgo(today, 12), 1); to = today; }
  const days = daysBetween(from, to) + 1;
  const previousTo = addDays(from, -1); const previousFrom = addDays(previousTo, -(days - 1));
  return { key: range, label: rangeLabels[range], from, to, days, previousFrom, previousTo, granularity: days <= 31 ? 'day' : days <= 120 ? 'week' : 'month', start: zonedMidnight(from, timezone), end: zonedMidnight(addDays(to, 1), timezone), previousStart: zonedMidnight(previousFrom, timezone) };
}

export type Change = { current: number; previous: number; change: number | null; direction: 'up' | 'down' | 'flat' | 'new' };
function compare(current: number, previous: number): Change {
  if (previous === 0) return { current, previous, change: null, direction: current === 0 ? 'flat' : 'new' };
  const pct = ((current - previous) / previous) * 100;
  return { current, previous, change: Math.round(pct * 10) / 10, direction: Math.abs(pct) < 0.5 ? 'flat' : pct > 0 ? 'up' : 'down' };
}

export type Highlight = { id: string; tone: 'positive' | 'attention' | 'neutral'; title: string; detail: string; href: string; hrefLabel: string };
export type Overview = ReturnType<typeof buildOverview>;

const jobLabels: Record<string, string> = { booked: 'Booked', in_progress: 'In progress', completed: 'Completed', invoiced: 'Invoiced', paid: 'Paid', cancelled: 'Cancelled' };
const leadLabels: Record<string, string> = { new: 'New', contacted: 'Contacted', estimate_sent: 'Estimate sent', follow_up: 'Follow-up', won: 'Won', lost: 'Lost' };
const quoteLabels: Record<string, string> = { draft: 'Draft', sent: 'Sent', accepted: 'Accepted', declined: 'Declined', expired: 'Expired' };
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WEEKDAY_NAMES = ['Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays', 'Sundays'];

export function buildOverview(input: OverviewInput) {
  const { now, timezone, range } = input;
  const dayOf = (date: Date | null) => (date ? localDate(date, timezone) : null);
  const inCurrent = (date: Date | null) => { const day = dayOf(date); return day !== null && day >= range.from && day <= range.to; };
  const inPrevious = (date: Date | null) => { const day = dayOf(date); return day !== null && day >= range.previousFrom && day <= range.previousTo; };
  const countBoth = <T>(rows: T[], pick: (row: T) => Date | null, filter: (row: T) => boolean = () => true) => compare(rows.filter((row) => filter(row) && inCurrent(pick(row))).length, rows.filter((row) => filter(row) && inPrevious(pick(row))).length);

  // ---- buckets for the charts
  const bucketKey = (day: string) => range.granularity === 'day' ? day : range.granularity === 'week' ? mondayOf(day) : monthStart(day);
  const buckets: string[] = [];
  for (let cursor = bucketKey(range.from); cursor <= range.to; cursor = range.granularity === 'day' ? addDays(cursor, 1) : range.granularity === 'week' ? addDays(cursor, 7) : monthStart(addDays(cursor, 32))) buckets.push(cursor);
  const labelFor = (key: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', ...(range.granularity === 'month' ? { month: 'short', year: '2-digit' } : { month: 'short', day: 'numeric' }) }).format(new Date(`${key}T12:00:00Z`));
  const series = buckets.map((key) => ({ key, label: labelFor(key), received: 0, invoiced: 0, customers: 0 }));
  const slot = new Map(series.map((item) => [item.key, item]));

  // ---- money
  let received = 0; let receivedBefore = 0;
  for (const row of input.payments) {
    const day = dayOf(row.occurredAt); if (!day) continue;
    if (day >= range.from && day <= range.to) { received += num(row.amount); const target = slot.get(bucketKey(day)); if (target) target.received += num(row.amount); }
    else if (day >= range.previousFrom && day <= range.previousTo) receivedBefore += num(row.amount);
  }
  let invoiced = 0; let invoicedBefore = 0;
  const invoicesInRange = input.invoices.filter((row) => row.status !== 'void' && row.status !== 'draft');
  for (const row of invoicesInRange) {
    const day = dayOf(row.createdAt); if (!day) continue;
    if (day >= range.from && day <= range.to) { invoiced += num(row.total); const target = slot.get(bucketKey(day)); if (target) target.invoiced += num(row.total); }
    else if (day >= range.previousFrom && day <= range.previousTo) invoicedBefore += num(row.total);
  }
  for (const item of series) { item.received = round2(item.received); item.invoiced = round2(item.invoiced); }

  // Money still owed right now (not tied to the period), and how much of it is late.
  const owing = input.openInvoices.map((row) => ({ ...row, remaining: Math.max(0, num(row.total) - (input.receivedByInvoice.get(row.id) ?? 0)) })).filter((row) => row.remaining > 0);
  const isLate = (row: { status: string; dueAt: Date | null }) => row.status === 'overdue' || (row.dueAt !== null && row.dueAt.getTime() < now.getTime());
  const late = owing.filter(isLate);
  const sumOf = (rows: { remaining: number }[]) => round2(rows.reduce((total, row) => total + row.remaining, 0));
  const outstanding = { amount: sumOf(owing), count: owing.length };
  const overdue = { amount: sumOf(late), count: late.length };

  // Invoices created in the period, grouped by how they stand.
  const paidRows = invoicesInRange.filter((row) => dayOf(row.createdAt) !== null && inCurrent(row.createdAt));
  const invoiceMix = [
    { key: 'paid', label: 'Paid', rows: paidRows.filter((row) => row.status === 'paid') },
    { key: 'outstanding', label: 'Outstanding', rows: paidRows.filter((row) => row.status !== 'paid' && !isLate(row)) },
    { key: 'overdue', label: 'Overdue', rows: paidRows.filter((row) => row.status !== 'paid' && isLate(row)) },
  ].map((item) => ({ key: item.key, label: item.label, count: item.rows.length, amount: round2(item.rows.reduce((total, row) => total + num(row.total), 0)) })).filter((item) => item.count > 0);

  // ---- jobs
  const jobsCompare = countBoth(input.jobs, (row) => row.date);
  const jobCounts = new Map<string, number>();
  for (const row of input.jobs) if (inCurrent(row.date)) jobCounts.set(row.status, (jobCounts.get(row.status) ?? 0) + 1);
  const jobStatus = [...jobCounts.entries()].map(([status, count]) => ({ status, label: jobLabels[status] ?? status, count })).sort((a, b) => b.count - a.count);

  // ---- leads (the pipeline of leads that arrived in the period; open leads are a count of right now)
  const openStatuses = ['new', 'contacted', 'estimate_sent', 'follow_up'];
  const openLeads = input.leads.filter((row) => openStatuses.includes(row.status));
  const valued = openLeads.filter((row) => row.estimatedValue !== null && num(row.estimatedValue) > 0);
  const pipelineOrder = ['new', 'contacted', 'estimate_sent', 'follow_up', 'won', 'lost'];
  const leadsInRange = input.leads.filter((row) => inCurrent(row.createdAt));
  const leadPipeline = pipelineOrder.map((status) => { const rows = leadsInRange.filter((row) => row.status === status); return { status, label: leadLabels[status], count: rows.length, value: round2(rows.reduce((total, row) => total + num(row.estimatedValue), 0)) }; });
  const leadsNew = countBoth(input.leads, (row) => row.createdAt);

  // ---- quotes
  const quotesCompare = countBoth(input.quotes, (row) => row.createdAt);
  const quotesInRange = input.quotes.filter((row) => inCurrent(row.createdAt));
  const quoteStatus = ['draft', 'sent', 'accepted', 'declined', 'expired'].map((status) => { const rows = quotesInRange.filter((row) => row.status === status); return { status, label: quoteLabels[status], count: rows.length, value: round2(rows.reduce((total, row) => total + num(row.total), 0)) }; }).filter((item) => item.count > 0);
  const answered = quotesInRange.filter((row) => ['accepted', 'declined', 'expired'].includes(row.status)).length;
  const sentOut = quotesInRange.filter((row) => ['sent', 'accepted', 'declined', 'expired'].includes(row.status)).length;
  const accepted = quotesInRange.filter((row) => row.status === 'accepted').length;
  const quotes = { total: quotesInRange.length, totalValue: round2(quotesInRange.reduce((total, row) => total + num(row.total), 0)), byStatus: quoteStatus, sentOut, accepted, answered, acceptanceRate: sentOut > 0 ? Math.round((accepted / sentOut) * 100) : null };

  // ---- customers
  for (const row of input.customers) { const day = dayOf(row.createdAt); if (day && day >= range.from && day <= range.to) { const target = slot.get(bucketKey(day)); if (target) target.customers += 1; } }
  const customersNew = countBoth(input.customers, (row) => row.createdAt);
  const activeIds = new Set([...input.jobs.filter((row) => inCurrent(row.date)).map((row) => row.customerId), ...input.appointments.filter((row) => inCurrent(row.scheduledAt) && row.status !== 'cancelled').map((row) => row.customerId)]);
  const returning = input.customers.filter((row) => activeIds.has(row.id) && (dayOf(row.createdAt) ?? '9999') < range.from).length;

  // ---- appointments and workload
  const apptsInRange = input.appointments.filter((row) => inCurrent(row.scheduledAt));
  const heldNow = apptsInRange.filter((row) => row.status !== 'cancelled').length;
  const heldBefore = input.appointments.filter((row) => inPrevious(row.scheduledAt) && row.status !== 'cancelled').length;
  const appointmentsCompare = compare(heldNow, heldBefore);
  const upcoming = (status: string) => !['cancelled', 'completed'].includes(status);
  const dayCounts = WEEKDAYS.map((day) => ({ day, appointments: 0 }));
  for (const row of apptsInRange) if (row.status !== 'cancelled') dayCounts[weekdayIndex(localDate(row.scheduledAt, timezone))].appointments += 1;
  const hoursByEmployee = new Map<string, { name: string; hours: number }>();
  for (const shift of input.shifts) {
    const entry = hoursByEmployee.get(shift.employeeId) ?? { name: shift.employeeName, hours: 0 };
    entry.hours += Math.max(0, (shift.endsAt.getTime() - shift.startsAt.getTime()) / 3_600_000);
    hoursByEmployee.set(shift.employeeId, entry);
  }
  const byEmployee = [...hoursByEmployee.values()].map((row) => ({ name: row.name, hours: Math.round(row.hours * 10) / 10 })).sort((a, b) => b.hours - a.hours);
  const workload = {
    appointments: { completed: apptsInRange.filter((row) => row.status === 'completed').length, cancelled: apptsInRange.filter((row) => row.status === 'cancelled').length, inRange: apptsInRange.length, comingUp: input.appointments.filter((row) => row.scheduledAt.getTime() >= now.getTime() && upcoming(row.status)).length },
    jobs: { completed: input.jobs.filter((row) => inCurrent(row.date) && ['completed', 'invoiced', 'paid'].includes(row.status)).length, comingUp: input.jobs.filter((row) => row.date && row.date.getTime() >= now.getTime() && row.status === 'booked').length },
    staff: { scheduledHours: Math.round(byEmployee.reduce((total, row) => total + row.hours, 0) * 10) / 10, shifts: input.shifts.length, byEmployee },
    busiestDays: dayCounts,
  };

  // ---- Pilot's findings, each from the numbers above
  const highlights: Highlight[] = [];
  const revenueChange = compare(received, receivedBefore);
  if (revenueChange.change !== null && Math.abs(revenueChange.change) >= 1) highlights.push({ id: 'revenue', tone: revenueChange.change > 0 ? 'positive' : 'attention', title: `Payments received are ${revenueChange.change > 0 ? 'up' : 'down'} ${Math.round(Math.abs(revenueChange.change))}% compared with the previous period`, detail: `${money(received)} received this period against ${money(receivedBefore)} before.`, href: '/finance', hrefLabel: 'View payments' });
  if (outstanding.count > 0) highlights.push({ id: 'outstanding', tone: 'neutral', title: `You have ${money(outstanding.amount)} in outstanding invoices`, detail: `Across ${outstanding.count} unpaid invoice${outstanding.count === 1 ? '' : 's'}.`, href: '/finance', hrefLabel: 'View invoices' });
  if (overdue.count > 0) highlights.push({ id: 'overdue', tone: 'attention', title: `${overdue.count} invoice${overdue.count === 1 ? ' is' : 's are'} overdue`, detail: `${money(overdue.amount)} is past its due date.`, href: '/finance', hrefLabel: 'View invoices' });
  if (openLeads.length > 0) highlights.push({ id: 'leads', tone: 'neutral', title: `You have ${openLeads.length} open lead${openLeads.length === 1 ? '' : 's'}${valued.length ? ` worth approximately ${money(valued.reduce((total, row) => total + num(row.estimatedValue), 0))}` : ''}`, detail: valued.length && valued.length < openLeads.length ? `${valued.length} of them ${valued.length === 1 ? 'has' : 'have'} an estimated value; the rest do not.` : valued.length ? 'Based on the estimated values saved on each lead.' : 'None of them has an estimated value saved yet.', href: '/leads', hrefLabel: 'View leads' });
  if (quotes.acceptanceRate !== null && quotes.sentOut >= 2) highlights.push({ id: 'quotes', tone: quotes.acceptanceRate >= 50 ? 'positive' : 'neutral', title: `Your quote acceptance rate is ${quotes.acceptanceRate}%`, detail: `${quotes.accepted} of ${quotes.sentOut} quotes sent in this period were accepted.`, href: '/finance', hrefLabel: 'View quotes' });
  const totalBooked = dayCounts.reduce((total, row) => total + row.appointments, 0);
  if (totalBooked >= 5) { const busiest = dayCounts.reduce((best, row, index) => (row.appointments > dayCounts[best].appointments ? index : best), 0); highlights.push({ id: 'busiest', tone: 'neutral', title: `${WEEKDAY_NAMES[busiest]} have the most appointments`, detail: `${dayCounts[busiest].appointments} of ${totalBooked} appointments in this period.`, href: '/scheduling', hrefLabel: 'View schedule' }); }
  if (customersNew.change !== null && customersNew.current >= 3 && customersNew.change >= 20) highlights.push({ id: 'customers', tone: 'positive', title: `${customersNew.current} new customers, up ${Math.round(customersNew.change)}% on the previous period`, detail: `${customersNew.previous} joined in the period before.`, href: '/customers', hrefLabel: 'View customers' });

  const hasAnyData = input.payments.length + input.invoices.length + input.openInvoices.length + input.jobs.length + input.quotes.length + input.leads.length + input.customers.length + input.appointments.length + input.shifts.length > 0;
  return {
    hasAnyData,
    range: { key: range.key, label: range.label, from: range.from, to: range.to, days: range.days, previousFrom: range.previousFrom, previousTo: range.previousTo, granularity: range.granularity },
    kpis: {
      received: compare(round2(received), round2(receivedBefore)),
      invoiced: compare(round2(invoiced), round2(invoicedBefore)),
      outstanding, overdue,
      jobs: jobsCompare,
      customers: { total: input.customers.length, new: customersNew },
      leads: { open: openLeads.length, new: leadsNew },
      quotes: { ...quotesCompare, totalValue: quotes.totalValue },
      appointments: appointmentsCompare,
    },
    revenueSeries: series.map(({ key, label, received: r, invoiced: i }) => ({ key, label, received: r, invoiced: i })),
    customerGrowth: { series: series.map(({ key, label, customers }) => ({ key, label, added: customers })), total: input.customers.length, new: customersNew.current, returning },
    jobStatus, leadPipeline, invoiceMix, quotes, workload,
    highlights,
  };
}
