import { describe, expect, it } from 'vitest';
import { buildInsights, type InsightsInput } from './analytics';

const NOW = new Date('2026-10-21T16:00:00Z'); // Wednesday 21 Oct 2026, noon in Toronto
const daysAgo = (days: number, hour = 16) => new Date(NOW.getTime() - days * 86_400_000 + (hour - 16) * 3_600_000);
const empty = (): InsightsInput => ({ now: NOW, timezone: 'America/Toronto', payments: [], customers: [], appointments: [], jobs: [], openInvoices: [], receivedByInvoice: new Map() });
const build = (input: Partial<InsightsInput>) => buildInsights({ ...empty(), ...input });
const pattern = (data: ReturnType<typeof build>, id: string) => data.patterns.find((item) => item.id === id);

describe('insights analytics', () => {
  it('has nothing to say, and says so, for a business with no records', () => {
    const data = build({});
    expect(data.hasData).toBe(false);
    expect(data.patterns).toEqual([]);
    expect(data.topServices).toEqual([]);
    expect(data.weekly).toHaveLength(8);
    expect(data.weekly.every((week) => week.revenue === 0 && week.newCustomers === 0 && week.appointments === 0)).toBe(true);
  });

  describe('last 30 days against the 30 before', () => {
    it('compares revenue and calls the direction', () => {
      const data = build({ payments: [{ amount: '600', occurredAt: daysAgo(5) }, { amount: 400, occurredAt: daysAgo(20) }, { amount: 500, occurredAt: daysAgo(40) }, { amount: 999, occurredAt: daysAgo(100) }] });
      expect(data.comparison[0]).toMatchObject({ key: 'revenue', current: 1000, previous: 500, change: 100, direction: 'up', good: true });
      expect(pattern(data, 'revenue-trend')).toMatchObject({ tone: 'positive', title: 'Revenue is up 100%' });
    });

    it('flags a revenue drop as something to watch, and ignores small wobbles', () => {
      const down = build({ payments: [{ amount: 300, occurredAt: daysAgo(3) }, { amount: 600, occurredAt: daysAgo(35) }] });
      expect(down.comparison[0]).toMatchObject({ change: -50, direction: 'down', good: false });
      expect(pattern(down, 'revenue-trend')).toMatchObject({ tone: 'attention', title: 'Revenue is down 50%' });
      const steady = build({ payments: [{ amount: 1050, occurredAt: daysAgo(3) }, { amount: 1000, occurredAt: daysAgo(35) }] });
      expect(pattern(steady, 'revenue-trend')).toBeUndefined();
    });

    it('treats growth from nothing as new, not an infinite percentage', () => {
      const data = build({ customers: [{ createdAt: daysAgo(3), lastContactedAt: null }] });
      expect(data.comparison[1]).toMatchObject({ key: 'newCustomers', current: 1, previous: 0, change: null, direction: 'new' });
    });

    it('counts new customers, and appointments that were not cancelled', () => {
      const data = build({
        customers: [{ createdAt: daysAgo(2), lastContactedAt: null }, { createdAt: daysAgo(10), lastContactedAt: null }, { createdAt: daysAgo(45), lastContactedAt: null }],
        appointments: [{ scheduledAt: daysAgo(4), status: 'completed' }, { scheduledAt: daysAgo(6), status: 'cancelled' }, { scheduledAt: daysAgo(50), status: 'completed' }, { scheduledAt: daysAgo(55), status: 'completed' }],
      });
      expect(data.comparison[1]).toMatchObject({ current: 2, previous: 1 });
      expect(data.comparison[2]).toMatchObject({ key: 'appointments', current: 1, previous: 2, direction: 'down' });
    });

    it('treats a higher cancellation rate as worse, and a lower one as better', () => {
      const worse = build({ appointments: [{ scheduledAt: daysAgo(3), status: 'cancelled' }, { scheduledAt: daysAgo(4), status: 'completed' }, { scheduledAt: daysAgo(40), status: 'completed' }, { scheduledAt: daysAgo(41), status: 'completed' }] });
      expect(worse.comparison[3]).toMatchObject({ key: 'cancellationRate', current: 50, previous: 0, direction: 'new', good: false });
      const better = build({ appointments: [{ scheduledAt: daysAgo(3), status: 'completed' }, { scheduledAt: daysAgo(4), status: 'completed' }, { scheduledAt: daysAgo(40), status: 'cancelled' }, { scheduledAt: daysAgo(41), status: 'completed' }] });
      expect(better.comparison[3]).toMatchObject({ current: 0, previous: 50, direction: 'down', good: true });
    });

    it('calls out a high cancellation rate only when there is enough to judge', () => {
      const few = build({ appointments: [{ scheduledAt: daysAgo(3), status: 'cancelled' }, { scheduledAt: daysAgo(4), status: 'completed' }] });
      expect(pattern(few, 'cancellations')).toBeUndefined();
      const many = build({ appointments: [1, 2, 3, 4].map((day) => ({ scheduledAt: daysAgo(day), status: day <= 2 ? 'cancelled' : 'completed' })) });
      expect(pattern(many, 'cancellations')).toMatchObject({ tone: 'attention', title: '50% of appointments were cancelled', detail: '2 of 4 appointments in the last 30 days.' });
    });
  });

  describe('eight-week trend', () => {
    it('puts each record in its own local week, oldest first, current week last', () => {
      const data = build({
        payments: [{ amount: 100, occurredAt: daysAgo(1) }, { amount: 50, occurredAt: daysAgo(9) }, { amount: 25, occurredAt: daysAgo(400) }],
        customers: [{ createdAt: daysAgo(2), lastContactedAt: null }],
        appointments: [{ scheduledAt: daysAgo(1), status: 'scheduled' }, { scheduledAt: daysAgo(1), status: 'cancelled' }],
      });
      expect(data.weekly.map((week) => week.weekStart)).toEqual(['2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19']);
      const current = data.weekly[7];
      const previous = data.weekly[6];
      expect(current).toMatchObject({ weekStart: '2026-10-19', revenue: 100, appointments: 1 }); // 20 Oct is Tuesday of the current week
      expect(previous.revenue).toBe(50);
      expect(data.weekly.reduce((sum, week) => sum + week.revenue, 0)).toBe(150); // the 400-day-old payment is outside the chart
    });
  });

  describe('busiest days', () => {
    const at = (date: string) => ({ scheduledAt: new Date(`${date}T16:00:00Z`), status: 'completed' });
    it('finds the busiest and the quietest weekday and suggests using the quiet one', () => {
      // six Tuesdays and one Thursday inside the last 90 days
      const data = build({ appointments: ['2026-10-20', '2026-10-13', '2026-10-06', '2026-09-29', '2026-09-22', '2026-09-15', '2026-10-15'].map(at) });
      expect(data.busiestDays.map((item) => [item.day, item.appointments])).toEqual([['Mon', 0], ['Tue', 6], ['Wed', 0], ['Thu', 1], ['Fri', 0], ['Sat', 0], ['Sun', 0]]);
      expect(pattern(data, 'busiest-day')).toMatchObject({ title: 'Tuesdays are your busiest day', detail: '6 of 7 appointments in the last 90 days (86%).' });
      expect(pattern(data, 'quiet-day')).toMatchObject({ tone: 'opportunity', title: 'Mondays are quiet', href: '/calendar' });
    });

    it('says nothing about days until there are enough appointments', () => {
      const data = build({ appointments: [{ scheduledAt: daysAgo(3), status: 'completed' }] });
      expect(pattern(data, 'busiest-day')).toBeUndefined();
    });

    it('ignores cancelled appointments and ones older than 90 days', () => {
      const data = build({ appointments: [{ scheduledAt: daysAgo(3), status: 'cancelled' }, { scheduledAt: daysAgo(120), status: 'completed' }] });
      expect(data.busiestDays.reduce((sum, item) => sum + item.appointments, 0)).toBe(0);
    });
  });

  it('ranks the most booked services, ignoring case and old jobs', () => {
    const data = build({ jobs: [
      { service: 'Pool cleaning', createdAt: daysAgo(3) }, { service: 'pool cleaning ', createdAt: daysAgo(10) }, { service: 'Pool opening', createdAt: daysAgo(12) },
      { service: 'Liner repair', createdAt: daysAgo(200) }, { service: '', createdAt: daysAgo(2) },
    ] });
    expect(data.topServices).toEqual([{ service: 'Pool cleaning', jobs: 2 }, { service: 'Pool opening', jobs: 1 }]);
    expect(pattern(data, 'top-service')?.title).toBe('Most booked: Pool cleaning');
  });

  describe('money owed', () => {
    it('sorts what is owed by how late it is, net of payments, and reports the overdue part', () => {
      const data = build({
        openInvoices: [
          { id: 'a', total: 500, dueAt: daysAgo(-10) },     // due in 10 days
          { id: 'b', total: '300', dueAt: daysAgo(10) },    // 10 days late
          { id: 'c', total: 400, dueAt: daysAgo(45) },      // 45 days late, 100 already paid
          { id: 'd', total: 200, dueAt: daysAgo(90) },      // 90 days late
          { id: 'e', total: 150, dueAt: null },             // no due date
          { id: 'f', total: 100, dueAt: daysAgo(5) },       // fully paid already
        ],
        receivedByInvoice: new Map([['c', 100], ['f', 100]]),
      });
      expect(data.receivables.buckets.map((bucket) => [bucket.key, bucket.amount, bucket.count])).toEqual([
        ['current', 500, 1], ['late30', 300, 1], ['late60', 300, 1], ['late60plus', 200, 1], ['noDueDate', 150, 1],
      ]);
      expect(data.receivables).toMatchObject({ total: 1450, overdue: 800 });
      expect(pattern(data, 'overdue')).toMatchObject({ tone: 'attention', title: '$800 is overdue', detail: 'Across 3 invoices past their due date.', href: '/finance' });
    });

    it('does not raise an alarm when nothing is late', () => {
      const data = build({ openInvoices: [{ id: 'a', total: 500, dueAt: daysAgo(-10) }] });
      expect(pattern(data, 'overdue')).toBeUndefined();
    });
  });

  it('groups customers by how recently they were in touch, and nudges about the quiet ones', () => {
    const data = build({ customers: [
      { createdAt: daysAgo(100), lastContactedAt: daysAgo(2) },
      { createdAt: daysAgo(100), lastContactedAt: daysAgo(20) },
      { createdAt: daysAgo(100), lastContactedAt: daysAgo(60) },
      { createdAt: daysAgo(100), lastContactedAt: daysAgo(90) },
      { createdAt: daysAgo(100), lastContactedAt: null },
    ] });
    expect(data.customerHealth).toEqual({ active: 1, cooling: 1, quiet: 3, total: 5 });
    expect(pattern(data, 'quiet-customers')).toMatchObject({ tone: 'opportunity', title: '3 customers have gone quiet', href: '/customers' });
  });

  it('only reports patterns it can back with numbers', () => {
    const data = build({ customers: [{ createdAt: daysAgo(100), lastContactedAt: daysAgo(2) }] });
    expect(data.hasData).toBe(true);
    expect(data.patterns).toEqual([]);
  });
});
