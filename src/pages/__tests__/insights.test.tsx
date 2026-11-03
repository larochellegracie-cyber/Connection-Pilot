import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { HelmetProvider } from '@dr.pogodin/react-helmet';
import { MemoryRouter } from 'react-router';

vi.mock('@/lib/auth/auth-client', () => ({ ProtectedRoute: ({ children }: { children: unknown }) => children }));
vi.mock('@/layouts/WorkspaceLayout', () => ({ default: ({ children }: { children: unknown }) => children }));

import InsightsPage from '../insights';

const change = (current: number, previous: number, direction: string, pct: number | null) => ({ current, previous, change: pct, direction });
const series = ['Oct 1', 'Oct 2', 'Oct 3'].map((label, index) => ({ key: `2026-10-0${index + 1}`, label, received: index * 100, invoiced: index * 150 }));
const full = {
  hasAnyData: true, timezone: 'America/Toronto',
  range: { key: 'this_month', label: 'This month', from: '2026-10-01', to: '2026-10-21', days: 21, previousFrom: '2026-09-10', previousTo: '2026-09-30', granularity: 'day' },
  kpis: {
    received: change(300, 200, 'up', 50), invoiced: change(450, 450, 'flat', 0),
    outstanding: { amount: 2420, count: 4 }, overdue: { amount: 800, count: 3 },
    jobs: change(12, 8, 'up', 50), customers: { total: 40, new: change(5, 5, 'flat', 0) }, leads: { open: 7, new: change(3, 2, 'up', 50) },
    quotes: { ...change(6, 0, 'new', null), totalValue: 5200 }, appointments: change(9, 12, 'down', -25),
  },
  revenueSeries: series,
  customerGrowth: { series: series.map((point) => ({ key: point.key, label: point.label, added: 1 })), total: 40, new: 3, returning: 9 },
  jobStatus: [{ status: 'completed', label: 'Completed', count: 8 }, { status: 'booked', label: 'Booked', count: 3 }, { status: 'cancelled', label: 'Cancelled', count: 1 }],
  leadPipeline: [{ status: 'new', label: 'New', count: 4, value: 3000 }, { status: 'contacted', label: 'Contacted', count: 2, value: 0 }, { status: 'estimate_sent', label: 'Estimate sent', count: 0, value: 0 }, { status: 'follow_up', label: 'Follow-up', count: 0, value: 0 }, { status: 'won', label: 'Won', count: 1, value: 500 }, { status: 'lost', label: 'Lost', count: 0, value: 0 }],
  invoiceMix: [{ key: 'paid', label: 'Paid', count: 5, amount: 3000 }, { key: 'outstanding', label: 'Outstanding', count: 2, amount: 900 }, { key: 'overdue', label: 'Overdue', count: 1, amount: 400 }],
  quotes: { total: 6, totalValue: 5200, byStatus: [{ status: 'accepted', label: 'Accepted', count: 3, value: 2000 }, { status: 'sent', label: 'Sent', count: 2, value: 2200 }, { status: 'declined', label: 'Declined', count: 1, value: 1000 }], sentOut: 6, accepted: 3, answered: 4, acceptanceRate: 50 },
  workload: { appointments: { completed: 7, cancelled: 2, inRange: 11, comingUp: 4 }, jobs: { completed: 8, comingUp: 3 }, staff: { scheduledHours: 36, shifts: 5, byEmployee: [{ name: 'Avery', hours: 24 }, { name: 'Sam', hours: 12 }] }, busiestDays: [{ day: 'Mon', appointments: 1 }, { day: 'Tue', appointments: 5 }, { day: 'Wed', appointments: 0 }, { day: 'Thu', appointments: 2 }, { day: 'Fri', appointments: 1 }, { day: 'Sat', appointments: 0 }, { day: 'Sun', appointments: 0 }] },
  highlights: [{ id: 'overdue', tone: 'attention', title: '3 invoices are overdue', detail: '$800 is past its due date.', href: '/finance', hrefLabel: 'View invoices' }, { id: 'leads', tone: 'neutral', title: 'You have 7 open leads', detail: 'None of them has an estimated value saved yet.', href: '/leads', hrefLabel: 'View leads' }],
  recommendations: [{ id: 'r1', priority: 'opportunity', category: 'Revenue', title: 'Three quotes are waiting', whatHappened: 'x', whyItMatters: 'y', recommendation: 'Follow up on the quotes.', evidence: [], action: { label: 'Review quotes', href: '/finance' } }],
  updatedAt: '2026-10-21T16:00:00.000Z',
};
const empty = {
  ...full, hasAnyData: false,
  kpis: { received: change(0, 0, 'flat', null), invoiced: change(0, 0, 'flat', null), outstanding: { amount: 0, count: 0 }, overdue: { amount: 0, count: 0 }, jobs: change(0, 0, 'flat', null), customers: { total: 0, new: change(0, 0, 'flat', null) }, leads: { open: 0, new: change(0, 0, 'flat', null) }, quotes: { ...change(0, 0, 'flat', null), totalValue: 0 }, appointments: change(0, 0, 'flat', null) },
  revenueSeries: series.map((point) => ({ ...point, received: 0, invoiced: 0 })),
  customerGrowth: { series: series.map((point) => ({ key: point.key, label: point.label, added: 0 })), total: 0, new: 0, returning: 0 },
  jobStatus: [], leadPipeline: full.leadPipeline.map((stage) => ({ ...stage, count: 0, value: 0 })), invoiceMix: [],
  quotes: { total: 0, totalValue: 0, byStatus: [], sentOut: 0, accepted: 0, answered: 0, acceptanceRate: null },
  workload: { appointments: { completed: 0, cancelled: 0, inRange: 0, comingUp: 0 }, jobs: { completed: 0, comingUp: 0 }, staff: { scheduledHours: 0, shifts: 0, byEmployee: [] }, busiestDays: full.workload.busiestDays.map((day) => ({ ...day, appointments: 0 })) },
  highlights: [], recommendations: [],
};

let urls: string[];
const stub = (payload: unknown, status = 200) => vi.stubGlobal('fetch', vi.fn(async (url: string) => { urls.push(url); return new Response(JSON.stringify(payload), { status }); }));
const renderPage = (path = '/insights') => render(<HelmetProvider><MemoryRouter initialEntries={[path]}><InsightsPage /></MemoryRouter></HelmetProvider>);

describe('Insights dashboard', () => {
  beforeEach(() => { urls = []; });
  afterEach(() => vi.unstubAllGlobals());

  it('shows the key numbers from the data, with comparisons only where they can be calculated, and links to the right pages', async () => {
    stub(full); renderPage();
    const numbers = await screen.findByRole('region', { name: 'Key numbers' });
    const card = (label: string) => within(numbers).getByText(label, { selector: '.cp-eyebrow' }).closest('a') as HTMLElement;
    expect(card('Payments received').textContent).toContain('$300');
    expect(card('Payments received').textContent).toContain('50%');
    expect(card('Payments received').getAttribute('href')).toBe('/finance');
    expect(card('Outstanding').textContent).toContain('$2,420');
    expect(card('Outstanding').textContent).toContain('4 unpaid invoices');
    expect(card('Overdue').textContent).toContain('$800');
    expect(card('Jobs').getAttribute('href')).toBe('/jobs');
    expect(card('Customers').getAttribute('href')).toBe('/customers');
    expect(card('Open leads').textContent).toContain('7');
    expect(card('Open leads').getAttribute('href')).toBe('/leads');
    expect(card('Quotes').textContent).toContain('New this period');
    expect(card('Appointments').textContent).toContain('25%');
    // an open-leads or outstanding card has no "vs previous period" comparison to show
    expect(card('Outstanding').textContent).not.toContain('vs previous period');
  });

  it('draws charts and cards for each area from the real numbers', async () => {
    stub(full); renderPage();
    await screen.findByRole('region', { name: 'Key numbers' });
    expect(screen.getByRole('img', { name: /Payments received and invoiced per day/ })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Jobs by status' })).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Lead pipeline' }).textContent).toContain('Estimate sent');
    expect(screen.getByRole('img', { name: 'Invoices by status' })).toBeTruthy();
    expect(screen.getByText('Total outstanding today').parentElement?.textContent).toContain('$2,420');
    expect(screen.getByRole('img', { name: 'Quote acceptance rate 50%' })).toBeTruthy();
    expect(screen.getByText('3 of 6 quotes that were sent were accepted.')).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Scheduled hours by employee' }).textContent).toContain('Avery');
    expect(screen.getByText(/does not track hours actually worked/)).toBeTruthy();
  });

  it('shows Pilot’s findings with links, from the data and the proactive recommendations', async () => {
    stub(full); renderPage();
    const section = (await screen.findByText('Pilot’s Business Insights')).closest('section') as HTMLElement;
    expect(section.className).toContain('cp-navy');
    expect(within(section).getByText('3 invoices are overdue')).toBeTruthy();
    expect(within(section).getByRole('link', { name: /View leads/ }).getAttribute('href')).toBe('/leads');
    expect(within(section).getByText('Three quotes are waiting')).toBeTruthy();
    expect(within(section).getByRole('link', { name: /Review quotes/ }).getAttribute('href')).toBe('/finance');
  });

  it('does not crash with an empty business and shows empty states instead of numbers', async () => {
    stub(empty); renderPage();
    const numbers = await screen.findByRole('region', { name: 'Key numbers' });
    expect(numbers.textContent).toContain('$0');
    expect(numbers.textContent).toContain('Nothing owing');
    expect(numbers.textContent).not.toContain('vs previous period');
    expect(screen.getAllByText('Not enough data yet').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByRole('img', { name: 'Jobs by status' })).toBeNull();
    expect(screen.queryByRole('img', { name: /Quote acceptance rate/ })).toBeNull();
    expect(screen.getByText('Quotes created in this period will show here.')).toBeTruthy();
    expect(screen.getByText('Jobs scheduled in this period will show here.')).toBeTruthy();
  });

  it('asks the server for the chosen range, and for custom dates once both are picked', async () => {
    stub(full); renderPage();
    await screen.findByRole('region', { name: 'Key numbers' });
    expect(urls[0]).toBe('/api/insights/overview?range=this_month');
    fireEvent.change(screen.getByLabelText('Date range'), { target: { value: 'last_3_months' } });
    await waitFor(() => expect(urls).toContain('/api/insights/overview?range=last_3_months'));
    fireEvent.change(screen.getByLabelText('Date range'), { target: { value: 'custom' } });
    expect(await screen.findByLabelText('From date')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2026-10-01' } });
    fireEvent.change(screen.getByLabelText('To date'), { target: { value: '2026-10-10' } });
    await waitFor(() => expect(urls).toContain('/api/insights/overview?range=custom&from=2026-10-01&to=2026-10-10'));
  });

  it('shows different numbers when the range changes', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => { urls.push(url); return new Response(JSON.stringify(url.includes('last_month') ? { ...empty, kpis: { ...empty.kpis, received: change(1200, 0, 'new', null) } } : full), { status: 200 }); }));
    renderPage();
    const numbers = await screen.findByRole('region', { name: 'Key numbers' });
    expect(numbers.textContent).toContain('$300');
    fireEvent.change(screen.getByLabelText('Date range'), { target: { value: 'last_month' } });
    await waitFor(() => expect(screen.getByRole('region', { name: 'Key numbers' }).textContent).toContain('$1,200'));
  });

  it('shows a clear message if the data cannot be loaded or the plan does not include Insights', async () => {
    stub({ error: 'This feature requires an upgraded plan.', upgradeRequired: true }, 403); renderPage();
    expect((await screen.findByRole('alert')).textContent).toContain('requires an upgraded plan');
  });

  it('is clearly different from Home: no today’s staff, appointments or jobs lists', async () => {
    stub(full); renderPage();
    await screen.findByRole('region', { name: 'Key numbers' });
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Insights');
    for (const homeOnly of ['Today’s staff', 'Today’s appointments', 'Today’s jobs', 'Good morning']) expect(screen.queryByText(homeOnly)).toBeNull();
  });
});
