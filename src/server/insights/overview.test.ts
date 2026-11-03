import { describe, expect, it } from 'vitest';
import { buildOverview, resolveRange, zonedMidnight, type OverviewInput } from './overview';

const TZ = 'America/Toronto';
const NOW = new Date('2026-10-21T16:00:00Z'); // Wednesday 21 Oct 2026, noon in Toronto
const at = (day: string, hour = 12) => new Date(`${day}T${String(hour + 4).padStart(2, '0')}:00:00Z`); // Toronto is UTC-4 until 1 Nov

const input = (overrides: Partial<OverviewInput> = {}, rangeKey = 'this_month'): OverviewInput => ({
  now: NOW, timezone: TZ, range: resolveRange(rangeKey, NOW, TZ),
  payments: [], invoices: [], openInvoices: [], receivedByInvoice: new Map(), jobs: [], quotes: [], leads: [], customers: [], appointments: [], shifts: [],
  ...overrides,
});

describe('date ranges', () => {
  const range = (key: string, from?: string, to?: string) => { const value = resolveRange(key, NOW, TZ, from, to); return [value.from, value.to, value.days, value.granularity, value.previousFrom, value.previousTo]; };
  it('works out each period in the business time zone', () => {
    expect(range('this_week')).toEqual(['2026-10-19', '2026-10-21', 3, 'day', '2026-10-16', '2026-10-18']);
    expect(range('this_month')).toEqual(['2026-10-01', '2026-10-21', 21, 'day', '2026-09-10', '2026-09-30']);
    expect(range('last_month')).toEqual(['2026-09-01', '2026-09-30', 30, 'day', '2026-08-02', '2026-08-31']);
    expect(range('last_3_months')).toEqual(['2026-07-22', '2026-10-21', 92, 'week', '2026-04-21', '2026-07-21']);
    expect(range('last_12_months')).toEqual(['2025-10-22', '2026-10-21', 365, 'month', '2024-10-22', '2025-10-21']);
  });
  it('accepts a custom range and falls back to this month for nonsense', () => {
    expect(range('custom', '2026-10-05', '2026-10-10').slice(0, 3)).toEqual(['2026-10-05', '2026-10-10', 6]);
    expect(range('custom', '2026-10-10', '2026-10-05')[0]).toBe('2026-10-01');
    expect(range('custom', 'nope', '2026-10-05')[0]).toBe('2026-10-01');
    expect(range('whatever')[0]).toBe('2026-10-01');
    expect(range('custom', '2000-01-01', '2026-10-05')[0]).toBe('2026-10-01'); // too long
  });
  it('finds local midnight across a daylight-saving change', () => {
    expect(zonedMidnight('2026-10-31', TZ).toISOString()).toBe('2026-10-31T04:00:00.000Z');
    expect(zonedMidnight('2026-11-01', TZ).toISOString()).toBe('2026-11-01T04:00:00.000Z');
    expect(zonedMidnight('2026-11-02', TZ).toISOString()).toBe('2026-11-02T05:00:00.000Z');
  });
});

describe('an empty business', () => {
  const overview = buildOverview(input());
  it('shows zeros and empty lists, never invented numbers', () => {
    expect(overview.hasAnyData).toBe(false);
    expect(overview.kpis.received).toMatchObject({ current: 0, previous: 0, change: null, direction: 'flat' });
    expect(overview.kpis.outstanding).toEqual({ amount: 0, count: 0 });
    expect(overview.jobStatus).toEqual([]);
    expect(overview.invoiceMix).toEqual([]);
    expect(overview.quotes).toMatchObject({ total: 0, acceptanceRate: null, byStatus: [] });
    expect(overview.leadPipeline.every((stage) => stage.count === 0)).toBe(true);
    expect(overview.workload.staff).toMatchObject({ scheduledHours: 0, byEmployee: [] });
    expect(overview.highlights).toEqual([]);
    expect(overview.revenueSeries).toHaveLength(21);
    expect(overview.revenueSeries.every((point) => point.received === 0 && point.invoiced === 0)).toBe(true);
  });
});

describe('money', () => {
  const data = input({
    payments: [{ amount: '100.00', occurredAt: at('2026-10-05') }, { amount: 50, occurredAt: at('2026-10-05') }, { amount: 400, occurredAt: at('2026-09-20') }, { amount: 999, occurredAt: at('2026-01-01') }],
    invoices: [
      { id: 'i1', total: 300, status: 'paid', dueAt: null, createdAt: at('2026-10-02') },
      { id: 'i2', total: 200, status: 'open', dueAt: at('2026-11-30'), createdAt: at('2026-10-03') },
      { id: 'i3', total: 120, status: 'overdue', dueAt: at('2026-10-01'), createdAt: at('2026-10-04') },
      { id: 'i4', total: 80, status: 'draft', dueAt: null, createdAt: at('2026-10-04') },
      { id: 'i5', total: 70, status: 'void', dueAt: null, createdAt: at('2026-10-04') },
      { id: 'i6', total: 250, status: 'sent', dueAt: null, createdAt: at('2026-09-15') },
    ],
    openInvoices: [{ id: 'i2', total: 200, status: 'open', dueAt: at('2026-11-30') }, { id: 'i3', total: 120, status: 'overdue', dueAt: at('2026-10-01') }, { id: 'i7', total: 90, status: 'sent', dueAt: at('2026-10-10') }, { id: 'i8', total: 60, status: 'open', dueAt: null }],
    receivedByInvoice: new Map([['i3', 20], ['i8', 60]]),
  });
  const overview = buildOverview(data);

  it('counts payments received in the period against the period before, and ignores older ones', () => {
    expect(overview.kpis.received).toMatchObject({ current: 150, previous: 400, direction: 'down', change: -62.5 });
    expect(overview.revenueSeries.find((point) => point.key === '2026-10-05')).toMatchObject({ received: 150 });
  });
  it('counts invoiced amounts without drafts or voids', () => {
    expect(overview.kpis.invoiced).toMatchObject({ current: 620, previous: 250 });
    expect(overview.revenueSeries.reduce((total, point) => total + point.invoiced, 0)).toBe(620);
  });
  it('works out what is still owed and what is overdue, after payments', () => {
    expect(overview.kpis.outstanding).toEqual({ amount: 390, count: 3 }); // 200 + 100 + 90; i8 is fully paid
    expect(overview.kpis.overdue).toEqual({ amount: 190, count: 2 });     // i3 (100 left) + i7 (90, past due)
  });
  it('splits invoices created in the period into paid, outstanding and overdue', () => {
    expect(overview.invoiceMix).toEqual([{ key: 'paid', label: 'Paid', count: 1, amount: 300 }, { key: 'outstanding', label: 'Outstanding', count: 1, amount: 200 }, { key: 'overdue', label: 'Overdue', count: 1, amount: 120 }]);
  });
  it('writes Pilot findings from those numbers', () => {
    const titles = overview.highlights.map((item) => item.title);
    expect(titles).toContain('Payments received are down 63% compared with the previous period');
    expect(titles).toContain('You have $390 in outstanding invoices');
    expect(titles).toContain('2 invoices are overdue');
    expect(overview.highlights.find((item) => item.id === 'overdue')).toMatchObject({ tone: 'attention', href: '/finance', hrefLabel: 'View invoices' });
  });
});

describe('jobs, leads, quotes, customers and workload', () => {
  const data = input({
    jobs: [
      { status: 'completed', date: at('2026-10-02'), customerId: 'c1' }, { status: 'completed', date: at('2026-10-03'), customerId: 'c1' },
      { status: 'booked', date: at('2026-10-25'), customerId: 'c2' }, { status: 'cancelled', date: at('2026-10-04'), customerId: 'c2' },
      { status: 'completed', date: at('2026-09-20'), customerId: 'c1' },
    ],
    leads: [
      { status: 'new', estimatedValue: '1000', createdAt: at('2026-10-02') }, { status: 'new', estimatedValue: null, createdAt: at('2026-10-03') },
      { status: 'won', estimatedValue: 500, createdAt: at('2026-10-04') }, { status: 'lost', estimatedValue: 100, createdAt: at('2026-08-01') }, { status: 'follow_up', estimatedValue: 250, createdAt: at('2026-07-01') },
    ],
    quotes: [
      { status: 'accepted', total: 400, createdAt: at('2026-10-02') }, { status: 'accepted', total: 100, createdAt: at('2026-10-03') }, { status: 'declined', total: 300, createdAt: at('2026-10-04') },
      { status: 'sent', total: 200, createdAt: at('2026-10-05') }, { status: 'draft', total: 50, createdAt: at('2026-10-06') }, { status: 'sent', total: 70, createdAt: at('2026-09-20') },
    ],
    customers: [{ id: 'c1', createdAt: at('2026-01-10') }, { id: 'c2', createdAt: at('2026-10-04') }, { id: 'c3', createdAt: at('2026-10-05') }, { id: 'c4', createdAt: at('2026-09-12') }],
    appointments: [
      { status: 'completed', scheduledAt: at('2026-10-06'), customerId: 'c1' }, { status: 'completed', scheduledAt: at('2026-10-13'), customerId: 'c1' }, { status: 'scheduled', scheduledAt: at('2026-10-27'), customerId: 'c2' },
      { status: 'cancelled', scheduledAt: at('2026-10-07'), customerId: 'c2' }, { status: 'completed', scheduledAt: at('2026-09-22'), customerId: 'c1' },
      { status: 'completed', scheduledAt: at('2026-10-20'), customerId: 'c3' }, { status: 'completed', scheduledAt: at('2026-10-20', 14), customerId: 'c3' },
    ],
    shifts: [
      { employeeId: 'e1', employeeName: 'Avery', startsAt: at('2026-10-05', 8), endsAt: at('2026-10-05', 16) }, { employeeId: 'e1', employeeName: 'Avery', startsAt: at('2026-10-06', 8), endsAt: at('2026-10-06', 12) },
      { employeeId: 'e2', employeeName: 'Sam', startsAt: at('2026-10-05', 9), endsAt: at('2026-10-05', 15) },
    ],
  });
  const overview = buildOverview(data);

  it('shows job statuses that exist, for jobs in the period only', () => {
    expect(overview.jobStatus).toEqual([{ status: 'completed', label: 'Completed', count: 2 }, { status: 'cancelled', label: 'Cancelled', count: 1 }]);
    expect(overview.kpis.jobs).toMatchObject({ current: 3, previous: 1, direction: 'up', change: 200 });
  });
  it('builds the lead pipeline from leads created in the period and counts open leads as of now', () => {
    expect(overview.leadPipeline.map((stage) => [stage.status, stage.count])).toEqual([['new', 2], ['contacted', 0], ['estimate_sent', 0], ['follow_up', 0], ['won', 1], ['lost', 0]]);
    expect(overview.leadPipeline[0].value).toBe(1000);
    expect(overview.kpis.leads.open).toBe(3); // 2 new + 1 follow-up
    expect(overview.highlights.find((item) => item.id === 'leads')?.title).toBe('You have 3 open leads worth approximately $1,250');
    expect(overview.highlights.find((item) => item.id === 'leads')?.detail).toMatch(/2 of them have an estimated value/);
  });
  it('works out quote counts, value and acceptance rate only from quotes that were sent', () => {
    expect(overview.quotes).toMatchObject({ total: 5, totalValue: 1050, sentOut: 4, accepted: 2, answered: 3, acceptanceRate: 50 });
    expect(overview.quotes.byStatus.map((item) => item.status)).toEqual(['draft', 'sent', 'accepted', 'declined']);
    expect(overview.highlights.find((item) => item.id === 'quotes')?.title).toBe('Your quote acceptance rate is 50%');
  });
  it('counts customers: total, new against the period before, returning, and growth over time', () => {
    expect(overview.kpis.customers).toMatchObject({ total: 4, new: { current: 2, previous: 1, direction: 'up' } });
    expect(overview.customerGrowth.returning).toBe(1); // c1 existed before and had work in the period
    expect(overview.customerGrowth.series.reduce((total, point) => total + point.added, 0)).toBe(2);
  });
  it('summarises appointments and staff hours, and does not claim hours worked', () => {
    expect(overview.kpis.appointments).toMatchObject({ current: 4, previous: 1 }); // month to date: the appointment next week and the cancelled one are not counted
    expect(overview.workload.appointments).toMatchObject({ completed: 4, cancelled: 1, comingUp: 1 });
    expect(overview.workload.staff).toEqual({ scheduledHours: 18, shifts: 3, byEmployee: [{ name: 'Avery', hours: 12 }, { name: 'Sam', hours: 6 }] });
    expect(overview.workload).not.toHaveProperty('hoursWorked');
    expect(overview.workload.busiestDays.find((day) => day.day === 'Tue')?.appointments).toBe(4);
    expect(overview.highlights.find((item) => item.id === 'busiest')).toBeUndefined(); // too few appointments to call a pattern
  });
});

describe('changing the date range changes the numbers', () => {
  const rows = { payments: [{ amount: 100, occurredAt: at('2026-10-05') }, { amount: 250, occurredAt: at('2026-09-12') }, { amount: 40, occurredAt: at('2025-12-01') }] };
  const received = (key: string) => buildOverview(input(rows, key)).kpis.received.current;
  it('counts only payments inside each range', () => {
    expect(received('this_month')).toBe(100);
    expect(received('last_month')).toBe(250);
    expect(received('this_week')).toBe(0);
    expect(received('last_3_months')).toBe(350);
    expect(received('last_12_months')).toBe(390);
  });
  it('uses weekly and monthly buckets for longer ranges', () => {
    expect(buildOverview(input({}, 'last_3_months')).revenueSeries.length).toBeGreaterThanOrEqual(13);
    expect(buildOverview(input({}, 'last_12_months')).revenueSeries).toHaveLength(13);
    expect(buildOverview(input({}, 'this_week')).revenueSeries).toHaveLength(3);
  });
});
