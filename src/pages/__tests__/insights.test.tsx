import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HelmetProvider } from '@dr.pogodin/react-helmet';
import { MemoryRouter } from 'react-router';

vi.mock('@/lib/auth/auth-client', () => ({ ProtectedRoute: ({ children }: { children: unknown }) => children }));
vi.mock('@/layouts/WorkspaceLayout', () => ({ default: ({ children }: { children: unknown }) => children }));

import InsightsPage from '../insights';

const weekly = ['Sep 7', 'Sep 14', 'Sep 21', 'Sep 28', 'Oct 5', 'Oct 12', 'Oct 19', 'Oct 26'].map((label, index) => ({ weekStart: `2026-09-${index}`, label, revenue: index * 100, newCustomers: index % 3, appointments: index + 1 }));
const analytics = {
  hasData: true,
  comparison: [
    { key: 'revenue', label: 'Revenue', format: 'money', current: 2400, previous: 1200, change: 100, direction: 'up', good: true },
    { key: 'newCustomers', label: 'New customers', format: 'count', current: 3, previous: 5, change: -40, direction: 'down', good: false },
    { key: 'appointments', label: 'Appointments', format: 'count', current: 12, previous: 12, change: 0, direction: 'flat', good: null },
    { key: 'cancellationRate', label: 'Cancellation rate', format: 'percent', current: 25, previous: 0, change: null, direction: 'new', good: false },
  ],
  weekly,
  busiestDays: [{ day: 'Mon', appointments: 1 }, { day: 'Tue', appointments: 6 }, { day: 'Wed', appointments: 0 }, { day: 'Thu', appointments: 2 }, { day: 'Fri', appointments: 3 }, { day: 'Sat', appointments: 0 }, { day: 'Sun', appointments: 0 }],
  topServices: [{ service: 'Pool cleaning', jobs: 5 }, { service: 'Pool opening', jobs: 2 }],
  receivables: { total: 800, overdue: 300, buckets: [{ key: 'current', label: 'Not yet due', amount: 500, count: 1 }, { key: 'late30', label: '1–30 days late', amount: 300, count: 1 }, { key: 'late60', label: '31–60 days late', amount: 0, count: 0 }, { key: 'late60plus', label: 'Over 60 days late', amount: 0, count: 0 }, { key: 'noDueDate', label: 'No due date', amount: 0, count: 0 }] },
  customerHealth: { active: 4, cooling: 2, quiet: 3, total: 9 },
  patterns: [
    { id: 'overdue', tone: 'attention', title: '$300 is overdue', detail: 'Across 1 invoice past its due date.', href: '/finance', hrefLabel: 'View invoices' },
    { id: 'quiet-day', tone: 'opportunity', title: 'Wednesdays are quiet', detail: 'Only 0 appointments on Wednesdays.', href: '/calendar', hrefLabel: 'Open calendar' },
  ],
};
const recommendations = [{ id: 'r1', priority: 'opportunity', category: 'Revenue', title: 'Three quotes are waiting', whatHappened: 'x', whyItMatters: 'Quotes that sit for more than a week are rarely accepted.', recommendation: 'Follow up on the oldest quote today.', evidence: ['3 quotes, $2,100 in total'], action: { label: 'Review quotes', href: '/finance' } }];

const stub = (response: () => Response) => vi.stubGlobal('fetch', vi.fn(async () => response()));
const renderPage = () => render(<HelmetProvider><MemoryRouter><InsightsPage /></MemoryRouter></HelmetProvider>);
const json = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), { status });

describe('Insights page', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows trends and analysis, not a copy of the Home dashboard', async () => {
    stub(() => json({ analytics, recommendations, updatedAt: '2026-10-21T16:00:00Z' }));
    const { container } = renderPage();
    await screen.findByText('How your business is trending');

    // sections Insights has
    for (const id of ['trend-title', 'weekly-title', 'patterns-title', 'owed-title', 'busy-title', 'customers-title', 'services-title', 'recs-title']) expect(container.querySelector(`#${id}`)).toBeTruthy();
    // sections that belong to Home, and must not be duplicated here
    for (const id of ['schedule-title', 'attention-title', 'pipeline-title', 'activity-title', 'pilot-title']) expect(container.querySelector(`#${id}`)).toBeNull();
  });

  it('compares this period with the last, colouring changes by whether they are good', async () => {
    stub(() => json({ analytics, recommendations, updatedAt: '' }));
    const { container } = renderPage();
    await screen.findByText('How your business is trending');
    const card = (label: string) => [...container.querySelectorAll<HTMLElement>('.cp-kpi')].find((item) => item.querySelector('.cp-eyebrow')?.textContent === label) as HTMLElement;

    expect(card('Revenue').textContent).toContain('$2,400');
    expect(card('Revenue').querySelector('.cp-pill')?.textContent).toBe('+100%');
    expect(card('Revenue').querySelector('.cp-pill')?.className).toContain('tone-positive');
    expect(card('New customers').querySelector('.cp-pill')?.textContent).toBe('−40%');
    expect(card('New customers').querySelector('.cp-pill')?.className).toContain('tone-attention'); // down is not good
    expect(card('Appointments').querySelector('.cp-pill')?.textContent).toBe('No change');
    expect(card('Cancellation rate').textContent).toContain('25%');
    expect(card('Cancellation rate').querySelector('.cp-pill')?.className).toContain('tone-attention'); // higher cancellations are not good
    expect(container.querySelectorAll('.cp-kpi')).toHaveLength(4);
  });

  it('draws each weekly chart from the real numbers', async () => {
    stub(() => json({ analytics, recommendations, updatedAt: '' }));
    renderPage();
    const revenue = await screen.findByRole('figure', { name: 'Revenue, last 8 weeks' });
    const bars = [...revenue.querySelectorAll('[data-value]')].map((bar) => Number(bar.getAttribute('data-value')));
    expect(bars).toEqual(weekly.map((week) => week.revenue));
    expect(revenue.textContent).toContain('$2,800'); // total of the eight weeks
  });

  it('lists patterns with a way to act on each, in words rather than jargon', async () => {
    stub(() => json({ analytics, recommendations, updatedAt: '' }));
    renderPage();
    expect((await screen.findByText('$300 is overdue')).closest('li')?.querySelector('a')?.getAttribute('href')).toBe('/finance');
    expect(screen.getByText('Wednesdays are quiet').closest('li')?.className).toContain('tone-pilot'); // opportunities use the Pilot purple
  });

  it('shows Pilot’s recommendations as cards: category, why, supporting data, advice and a button', async () => {
    stub(() => json({ analytics, recommendations, updatedAt: '' }));
    const { container } = renderPage();
    await screen.findByText('Three quotes are waiting');
    const card = screen.getByText('Three quotes are waiting').closest('article') as HTMLElement;
    expect(card.textContent).toContain('Revenue');
    expect(card.textContent).toContain('Quotes that sit for more than a week');
    expect(card.textContent).toContain('3 quotes, $2,100 in total');
    expect(card.textContent).toContain('Recommended: Follow up on the oldest quote today.');
    expect(card.querySelector('a')?.getAttribute('href')).toBe('/finance');
    expect(container.querySelector('#recs-title')?.closest('section')?.className).toContain('cp-pilot');
  });

  it('shows money owed by lateness and customer activity', async () => {
    stub(() => json({ analytics, recommendations: [], updatedAt: '' }));
    const { container } = renderPage();
    await screen.findByText('Money owed');
    const owed = container.querySelector('#owed-title')?.closest('section') as HTMLElement;
    expect(owed.textContent).toContain('$800');
    expect(owed.textContent).toContain('1–30 days late');
    expect(owed.textContent).not.toContain('31–60 days late'); // empty buckets are hidden
    expect(screen.getByRole('img', { name: '4 active, 2 cooling, 3 quiet' })).toBeTruthy();
    expect(screen.getByText('Nothing needs Pilot’s attention right now. As your records grow, recommendations will appear here.')).toBeTruthy();
  });

  it('says so, instead of inventing charts, when there is no data yet', async () => {
    stub(() => json({ analytics: { ...analytics, hasData: false, patterns: [], topServices: [] }, recommendations: [], updatedAt: '' }));
    const { container } = renderPage();
    await screen.findByText('Not enough activity yet');
    expect(container.querySelector('#weekly-title')).toBeNull();
    expect(screen.getByText(/Nothing here is estimated/)).toBeTruthy();
  });

  it('points to the plans page when the plan does not include insights', async () => {
    stub(() => json({ error: 'This feature requires an upgraded plan.', upgradeRequired: true }, 403));
    renderPage();
    expect((await screen.findByRole('link', { name: 'See plans' })).getAttribute('href')).toBe('/subscription');
  });

  it('shows the server’s message when loading fails', async () => {
    stub(() => json({ error: 'Unable to load your insights right now.' }, 500));
    renderPage();
    expect((await screen.findByRole('alert')).textContent).toBe('Unable to load your insights right now.');
  });
});
