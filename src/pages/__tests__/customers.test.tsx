import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { HelmetProvider } from '@dr.pogodin/react-helmet';
import { MemoryRouter, Route, Routes, useParams } from 'react-router';

vi.mock('@/lib/auth/auth-client', () => ({ ProtectedRoute: ({ children }: { children: unknown }) => children }));
vi.mock('@/layouts/WorkspaceLayout', () => ({ default: ({ children }: { children: unknown }) => children }));

import CustomersPage from '../customers';

const customer = {
  id: 'cust-123', name: 'Jordan Rivera', phoneNumber: '+15555550100', email: 'jordan@example.com', company: null,
  status: 'active', createdAt: '2026-10-01T00:00:00.000Z', lastContactedAt: '2026-10-02T00:00:00.000Z',
  callCount: 0, messageCount: 0, tags: [], nextAppointment: null,
};

function ProfileStub() {
  const { customerId } = useParams();
  return <p>Profile page for {customerId}</p>;
}

function renderCustomers() {
  return render(
    <HelmetProvider>
      <MemoryRouter initialEntries={['/customers']}>
        <Routes>
          <Route path="/customers" element={<CustomersPage />} />
          <Route path="/dashboard/customers/:customerId" element={<ProfileStub />} />
        </Routes>
      </MemoryRouter>
    </HelmetProvider>,
  );
}

describe('Customers page profile links', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      businessType: 'service', customers: [customer],
      pagination: { page: 1, pageSize: 25, total: 1, totalPages: 1 },
      summary: { total: 1, newCustomers: 0, returningCustomers: 1, upcomingAppointments: 0 },
    }), { status: 200 })));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('opens the customer profile when the customer name is clicked', async () => {
    renderCustomers();
    const nameLink = await screen.findByRole('link', { name: 'Jordan Rivera' });
    expect(nameLink.getAttribute('href')).toBe('/dashboard/customers/cust-123');
    fireEvent.click(nameLink);
    await waitFor(() => expect(screen.getByText('Profile page for cust-123')).toBeTruthy());
  });

  it('still opens the same profile from the "Open profile" link', async () => {
    renderCustomers();
    await screen.findByRole('link', { name: 'Jordan Rivera' });
    const hrefs = screen.getAllByRole('link').map((link) => link.getAttribute('href'));
    expect(hrefs.filter((href) => href === '/dashboard/customers/cust-123').length).toBe(2);
  });
  it('shows how recently each customer was in touch, and their status', async () => {
    const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      businessType: 'service',
      customers: [
        { ...customer, id: 'a', name: 'Recent Rita', status: 'new', lastContactedAt: daysAgo(2) },
        { ...customer, id: 'b', name: 'Cooling Carl', status: 'returning', lastContactedAt: daysAgo(15) },
        { ...customer, id: 'c', name: 'Quiet Quinn', status: 'active', lastContactedAt: daysAgo(90) },
      ],
      pagination: { page: 1, pageSize: 25, total: 3, totalPages: 1 },
      summary: { total: 3, newCustomers: 1, returningCustomers: 1, upcomingAppointments: 0 },
    }), { status: 200 })));
    renderCustomers();
    const row = async (name: string) => (await screen.findByRole('link', { name })).closest('tr') as HTMLElement;

    expect((await row('Recent Rita')).textContent).toContain('Active');
    expect((await row('Recent Rita')).textContent).toContain('New');
    expect((await row('Cooling Carl')).textContent).toContain('Cooling');
    expect((await row('Cooling Carl')).textContent).toContain('Returning');
    expect((await row('Quiet Quinn')).textContent).toContain('Quiet');
  });
});
