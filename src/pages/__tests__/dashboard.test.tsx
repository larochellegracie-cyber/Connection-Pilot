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

function renderHome() {
  return render(<HelmetProvider><MemoryRouter><DashboardPage /></MemoryRouter></HelmetProvider>);
}

describe('Home (command centre)', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 }))); });
  afterEach(() => vi.unstubAllGlobals());

  it('shows the money and workload numbers from the dashboard data', async () => {
    renderHome();
    expect(await screen.findByText('$8,400')).toBeTruthy();
    expect(screen.getByText('$1,250')).toBeTruthy();
    expect(screen.getByText('7', { selector: '.cp-metric-value' })).toBeTruthy(); // open leads
    expect(screen.getByText('3', { selector: '.cp-metric-value' })).toBeTruthy(); // 1 today + 2 active jobs
  });

  it('lists today’s schedule and attention items as links to the right customer, with a status pill', async () => {
    renderHome();
    const appointment = (await screen.findByText('Jordan Rivera')).closest('a');
    expect(appointment?.getAttribute('href')).toBe('/dashboard/customers/cust-1');
    expect(appointment?.textContent).toContain('Confirmed');
    expect(screen.getByText('Casey Lee').closest('a')?.getAttribute('href')).toBe('/dashboard/customers/cust-2');
  });

  it('keeps Pilot’s briefing, with its recommended action link', async () => {
    renderHome();
    expect(await screen.findByText('Three quotes are waiting')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Review quotes' }).getAttribute('href')).toBe('/finance');
  });

  it('no longer shows the hard-coded sales chart', async () => {
    renderHome();
    await screen.findByText('Jordan Rivera');
    expect(document.querySelector('[aria-label="Sales activity chart"]')).toBeNull();
  });
  it('uses colour with meaning: green sales, orange money owed, blue core work, purple only for Pilot', async () => {
    const { container } = renderHome();
    await screen.findByText('Jordan Rivera');
    const tone = (label: string) => screen.getByText(label, { selector: '.cp-eyebrow' }).closest('article')?.className ?? '';

    expect(tone('Sales')).toContain('tone-positive');
    expect(tone('Outstanding')).toContain('tone-attention');
    expect(tone('Appointments & jobs')).toContain('tone-brand');
    expect(tone('Open leads')).toContain('tone-customer');
    // each KPI card carries its own coloured icon tile
    expect(container.querySelectorAll('.cp-kpi .cp-tile')).toHaveLength(4);

    // Ask Pilot and Pilot's Flight Plan are the purple surfaces; ordinary panels are not
    const pilotSurfaces = [...container.querySelectorAll('.cp-pilot')].map((node) => node.getAttribute('aria-labelledby'));
    expect(pilotSurfaces.sort()).toEqual(['attention-title', 'pilot-title']);
    expect(container.querySelector('[aria-labelledby="attention-title"]')?.className).toContain('cp-pilot--soft');
    for (const id of ['schedule-title', 'pipeline-title', 'activity-title']) {
      expect(container.querySelector(`[aria-labelledby="${id}"]`)?.className).not.toContain('cp-pilot');
    }
  });

  it('shows an overdue-style amount as orange only when money is actually owed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...payload, summary: { ...payload.summary, unpaidBalance: 0 } }), { status: 200 })));
    renderHome();
    await screen.findByText('Jordan Rivera');
    expect(screen.getByText('Outstanding', { selector: '.cp-eyebrow' }).closest('article')?.className).toContain('tone-neutral');
  });
  describe('Recent activity', () => {
    it('shows useful business events with the customer, the key detail and a clear action', async () => {
      const { container } = renderHome();
      await screen.findByText('Invoice created');
      const feed = container.querySelector('[aria-labelledby="activity-title"]') as HTMLElement;
      const rows = [...feed.querySelectorAll('li')];
      expect(rows).toHaveLength(3);

      const invoiceRow = rows.find((row) => row.textContent?.includes('Invoice created')) as HTMLElement;
      expect(invoiceRow.textContent).toContain('Morgan Diaz');
      expect(invoiceRow.textContent).toContain('$159.30');
      expect(invoiceRow.querySelector('a')?.getAttribute('href')).toBe('/finance');
      expect(invoiceRow.querySelector('a')?.textContent).toBe('View invoice');

      const customerRow = rows.find((row) => row.textContent?.includes('New customer added')) as HTMLElement;
      expect(customerRow.querySelector('a')?.getAttribute('href')).toBe('/dashboard/customers/cust-3');
    });

    it('tags what Pilot did, and only that', async () => {
      const { container } = renderHome();
      await screen.findByText('Appointment rescheduled');
      const feed = container.querySelector('[aria-labelledby="activity-title"]') as HTMLElement;
      const tagged = [...feed.querySelectorAll('li')].filter((row) => row.querySelector('.tone-pilot'));
      expect(tagged).toHaveLength(1);
      expect(tagged[0].textContent).toContain('Appointment rescheduled');
    });

    it('does not show private-note or record-edit housekeeping', async () => {
      const { container } = renderHome();
      await screen.findByText('Invoice created');
      const text = (container.querySelector('[aria-labelledby="activity-title"]') as HTMLElement).textContent?.toLowerCase() ?? '';
      for (const housekeeping of ['private note', 'note removed', 'note added', 'information updated']) expect(text).not.toContain(housekeeping);
    });

    it('is a compact list, not a timeline rail', async () => {
      const { container } = renderHome();
      await screen.findByText('Invoice created');
      expect(container.querySelector('[aria-labelledby="activity-title"] .cp-rail')).toBeNull();
    });
  });
});
