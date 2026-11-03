import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HelmetProvider } from '@dr.pogodin/react-helmet';
import { MemoryRouter } from 'react-router';

vi.mock('@/lib/auth/auth-client', () => ({ ProtectedRoute: ({ children }: { children: unknown }) => children }));
vi.mock('@/layouts/WorkspaceLayout', () => ({ default: ({ children }: { children: unknown }) => children }));

import DashboardPage from '../dashboard';

const payload = {
  businessName: 'Somerset Pool', businessType: 'service',
  todaySchedule: [{ id: 's1', customerId: 'cust-1', customerName: 'Jordan Rivera', title: 'Pool opening', status: 'confirmed', scheduledAt: '2026-10-21T14:00:00.000Z' }],
  summary: { openLeads: 7, activeJobs: 2, estimates: 1, invoices: 4, unpaidBalance: 1250, revenue: 8400 },
  attention: [{ id: 'a1', customerId: 'cust-2', customerName: 'Casey Lee', title: 'Asked for a call back', kind: 'follow_up', occurredAt: '2026-10-20T14:00:00.000Z' }],
  recentActivity: [
    { id: 'r1', kind: 'customer_added', type: 'customer_added', title: 'New customer added', customerId: 'cust-3', customerName: 'Sam Patel', detail: null, occurredAt: '2026-10-20T15:00:00.000Z', byPilot: false, action: { label: 'View customer', href: '/dashboard/customers/cust-3' } },
    { id: 'r2', kind: 'invoice_created', type: 'invoice_created', title: 'Invoice created', customerId: 'cust-4', customerName: 'Morgan Diaz', detail: '$159.30', occurredAt: '2026-10-20T14:00:00.000Z', byPilot: false, action: { label: 'View invoice', href: '/finance' } },
    { id: 'r3', kind: 'appointment_rescheduled', type: 'appointment_rescheduled', title: 'Appointment rescheduled', customerId: 'cust-5', customerName: 'Taylor Brooks', detail: 'Filter swap · Fri, Oct 23, 10:00 a.m.', occurredAt: '2026-10-20T13:00:00.000Z', byPilot: true, action: { label: 'View appointment', href: '/calendar' } },
  ],
  briefing: { todayAppointments: 1, attentionItems: 1, openLeads: 3, activeJobs: 2 },
  proactiveBriefing: { updatedAt: '2026-10-21T12:00:00.000Z', insights: [{ id: 'i1', priority: 'opportunity', category: 'Revenue', title: 'Three quotes are waiting', whatHappened: 'x', whyItMatters: 'y', recommendation: 'z', evidence: ['e1'], action: { label: 'Review quotes', href: '/finance' } }] },
};

const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
const at = (hour: number) => new Date(`${today}T${String(hour).padStart(2, '0')}:00:00-04:00`).toISOString();
const shiftsPayload = { schedule: { id: 'w1', status: 'published' }, shifts: [
  { id: 'sh1', employeeId: 'e1', employeeName: 'Avery', startsAt: at(8), endsAt: at(17), location: null },
  { id: 'sh2', employeeId: 'e2', employeeName: 'Sarah', startsAt: at(9), endsAt: at(15), location: 'Shop' },
  { id: 'sh3', employeeId: 'e3', employeeName: 'Mike', startsAt: '2020-01-01T14:00:00.000Z', endsAt: '2020-01-01T20:00:00.000Z', location: null },
] };
const jobsPayload = { jobs: [
  { id: 'j1', customerId: 'cust-6', customerName: 'Pat Doyle', service: 'Pool Cleaning', assignedEmployee: 'Sarah', scheduledAt: at(11), status: 'booked' },
  { id: 'j2', customerId: 'cust-7', customerName: 'Old Customer', service: 'Filter swap', assignedEmployee: null, scheduledAt: '2020-01-01T14:00:00.000Z', status: 'booked' },
] };

function stubFetch(overrides: { dashboard?: unknown; shifts?: unknown; jobs?: unknown } = {}) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.startsWith('/api/schedules')) return new Response(JSON.stringify(overrides.shifts ?? shiftsPayload), { status: 200 });
    if (url === '/api/jobs') return new Response(JSON.stringify(overrides.jobs ?? jobsPayload), { status: 200 });
    return new Response(JSON.stringify(overrides.dashboard ?? payload), { status: 200 });
  }));
}

function renderHome() {
  return render(<HelmetProvider><MemoryRouter><DashboardPage /></MemoryRouter></HelmetProvider>);
}

describe('Home (daily briefing)', () => {
  beforeEach(() => stubFetch());
  afterEach(() => vi.unstubAllGlobals());

  it('opens with a dark navy header: date, greeting with the business name and both buttons', async () => {
    renderHome();
    const heading = await screen.findByRole('heading', { level: 1 });
    expect(heading.textContent).toContain('Somerset Pool');
    const header = heading.closest('section') as HTMLElement;
    expect(header.className).toContain('cp-hero');
    expect(header.querySelectorAll(':scope > div > div > a')).toHaveLength(2);
  });

  it('shows the four at-a-glance numbers inside the header, secondary to the day’s work', async () => {
    renderHome();
    await screen.findByText('Avery');
    const stats = [...document.querySelectorAll('.cp-hero .cp-stat')] as HTMLElement[];
    expect(stats.map((stat) => stat.querySelector('.cp-eyebrow')?.textContent)).toEqual(['Appointments & jobs', 'Staff working', 'Outstanding', 'Open leads']);
    const value = (label: string) => stats.find((stat) => stat.textContent?.startsWith(label))?.querySelector('.cp-stat-value')?.textContent;
    expect(value('Appointments & jobs')).toBe('2'); // 1 appointment + 1 job today
    expect(value('Staff working')).toBe('2');       // the 2020 shift is not today
    expect(value('Outstanding')).toBe('$1,250');
    expect(value('Open leads')).toBe('7');
    expect(stats.find((stat) => stat.textContent?.startsWith('Outstanding'))?.className).not.toContain('tone-attention'); // orange is only for real warnings
  });

  it('lists only today’s real staff shifts with their times', async () => {
    renderHome();
    await screen.findByText('Avery');
    const staff = document.querySelector('#staff-title')?.closest('section') as HTMLElement;
    expect(staff.textContent).toContain('8:00 a.m. – 5:00 p.m.');
    expect(staff.textContent).toContain('Sarah');
    expect(staff.textContent).toContain('Shop');
    expect(staff.textContent).not.toContain('Mike');
    expect(staff.querySelector('a')?.getAttribute('href')).toBe('/scheduling');
  });

  it('lists today’s jobs with time, job, customer and employee, and leaves out other days', async () => {
    renderHome();
    const job = (await screen.findByText('Pool Cleaning')).closest('a') as HTMLElement;
    expect(job.textContent).toContain('11:00 a.m.');
    expect(job.textContent).toContain('Pat Doyle · Sarah');
    expect(job.textContent).toContain('Booked');
    expect(job.getAttribute('href')).toBe('/dashboard/customers/cust-6');
    expect(screen.queryByText('Filter swap')).toBeNull();
  });

  it('lists today’s appointments as links to the customer with a status', async () => {
    renderHome();
    const appointment = (await screen.findByText('Jordan Rivera')).closest('a') as HTMLElement;
    expect(appointment.getAttribute('href')).toBe('/dashboard/customers/cust-1');
    expect(appointment.textContent).toContain('Pool opening');
    expect(appointment.textContent).toContain('Confirmed');
    expect(appointment.querySelector('.cp-dot-lg')).toBeTruthy();
  });

  it('shows clean empty states when nothing is scheduled today', async () => {
    stubFetch({ dashboard: { ...payload, todaySchedule: [] }, shifts: { schedule: null, shifts: [] }, jobs: { jobs: [] } });
    renderHome();
    expect(await screen.findByText('No one is scheduled today')).toBeTruthy();
    expect(screen.getByText('No jobs today')).toBeTruthy();
    expect(screen.getByText('Nothing is scheduled today')).toBeTruthy();
  });

  it('still shows the rest of Home if staff and jobs cannot be loaded', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url === '/api/dashboard' ? new Response(JSON.stringify(payload), { status: 200 }) : new Response('{}', { status: 500 }))));
    renderHome();
    expect(await screen.findByText('Jordan Rivera')).toBeTruthy();
    expect(screen.getByText('No one is scheduled today')).toBeTruthy();
  });

  it('shows Pilot’s Briefing on dark navy, with the attention items and recommended action', async () => {
    renderHome();
    const briefing = (await screen.findByText('Pilot’s Briefing')).closest('section') as HTMLElement;
    expect(briefing.className).toContain('cp-navy');
    expect(briefing.textContent).toContain('Casey Lee');
    expect(briefing.querySelector('a[href="/dashboard/customers/cust-2"]')).toBeTruthy();
    expect(screen.getByText('Three quotes are waiting')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Review quotes' }).getAttribute('href')).toBe('/finance');
  });

  it('says the flight plan is clear when Pilot has nothing to raise', async () => {
    stubFetch({ dashboard: { ...payload, attention: [], proactiveBriefing: { updatedAt: payload.proactiveBriefing.updatedAt, insights: [] } } });
    renderHome();
    expect(await screen.findByText('Your flight plan is clear')).toBeTruthy();
  });

  it('keeps Home to today: no recent activity, no Ask Pilot chat box, no sales chart, no pipeline', async () => {
    const { container } = renderHome();
    await screen.findByText('Jordan Rivera');
    expect(container.querySelector('#activity-title')).toBeNull();
    expect(screen.queryByText('Invoice created')).toBeNull();
    expect(screen.queryByText('Recent activity')).toBeNull();
    expect(container.querySelector('#pilot-title')).toBeNull();
    expect(screen.queryByText('What needs my attention today?')).toBeNull();
    expect(container.querySelector('[aria-label="Sales activity chart"]')).toBeNull();
    expect(container.querySelector('#pipeline-title')).toBeNull();
  });

  it('groups staff and jobs in one white card, with appointments and the navy briefing beside it', async () => {
    const { container } = renderHome();
    await screen.findByText('Avery');
    const card = container.querySelector('.cp-card') as HTMLElement;
    expect(card.querySelector('#staff-title')).toBeTruthy();
    expect(card.querySelector('#jobs-title')).toBeTruthy();
    expect(card.querySelector('#schedule-title')).toBeNull();
  });
});
