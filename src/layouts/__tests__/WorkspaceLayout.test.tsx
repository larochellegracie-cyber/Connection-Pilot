import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

vi.mock('@/lib/auth/auth-client', () => ({
  useSession: () => ({ user: { name: 'Owner', email: 'owner@example.com' } }),
  LogoutButton: ({ className }: { className?: string }) => <button className={className}>Log out</button>,
}));

import WorkspaceLayout from '../WorkspaceLayout';

const json = (payload: unknown) => new Response(JSON.stringify(payload), { status: 200 });

describe('WorkspaceLayout navigation (dark navy sidebar)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/business-profile') return json({ profile: { businessName: 'Somerset Pool', businessType: 'service' } });
      if (url === '/api/subscription') return json({ subscription: { status: 'trialing', planName: 'Growth', trialDaysRemaining: 4, features: ['basic_insights', 'connections'] } });
      return new Response('{}', { status: 404 });
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  const renderAt = (path: string) => render(<MemoryRouter initialEntries={[path]}><WorkspaceLayout><p>Page content</p></WorkspaceLayout></MemoryRouter>);

  it('keeps every navigation item and its address', async () => {
    renderAt('/dashboard');
    await screen.findByRole('link', { name: 'Insights' });
    const hrefs = Object.fromEntries([...document.querySelectorAll('aside nav a')].map((link) => [link.textContent?.trim(), link.getAttribute('href')]));
    expect(hrefs).toMatchObject({
      Home: '/dashboard', Customers: '/customers', Leads: '/leads', Jobs: '/jobs', Scheduling: '/scheduling', Employees: '/employees',
      Messages: '/messages', 'Quotes & invoices': '/finance', Connections: '/connections', Marketing: '/marketing', Notifications: '/notifications',
      Insights: '/insights', 'Business information': '/business-profile', Settings: '/settings', Help: '/dashboard/help',
    });
    // Calendar is reached through Scheduling and + Create; the unfinished voice feature is hidden for now.
    expect(Object.keys(hrefs).filter((name) => /^calendar$|ai voice/i.test(name))).toEqual([]);
    expect(Object.keys(hrefs)).toEqual(['Home', 'Customers', 'Leads', 'Jobs', 'Scheduling', 'Employees', 'Messages', 'Quotes & invoices', 'Connections', 'Marketing', 'Notifications', 'Insights', 'Business information', 'Settings', 'Help']);
  });

  it('makes the current page unmistakable: a bright blue rounded item with aria-current', async () => {
    renderAt('/customers');
    const active = await screen.findByRole('link', { name: 'Customers' });
    expect(active.getAttribute('aria-current')).toBe('page');
    expect(active.className).toContain('bg-primary');
    expect(active.className).toContain('text-primary-foreground');
    const others = [...document.querySelectorAll('aside nav a')].filter((link) => link !== active);
    expect(others.every((link) => !link.hasAttribute('aria-current') && !link.className.includes('bg-primary'))).toBe(true);
  });

  it('keeps Scheduling highlighted on the Calendar page', async () => {
    renderAt('/calendar');
    await screen.findByRole('link', { name: 'Scheduling' });
    expect([...document.querySelectorAll('aside a[aria-current="page"]')].map((link) => link.textContent?.trim())).toEqual(['Scheduling']);
  });

  it('marks only one item active, including on the Insights page', async () => {
    renderAt('/insights');
    await screen.findByRole('link', { name: 'Insights' });
    const active = [...document.querySelectorAll('aside a[aria-current="page"]')];
    expect(active.map((link) => link.textContent?.trim())).toEqual(['Insights']);
  });

  it('puts the sidebar on deep navy with white text, a white logo and a blue active item', async () => {
    renderAt('/customers');
    const active = await screen.findByRole('link', { name: 'Customers' });
    const sidebar = document.querySelector('aside') as HTMLElement;
    expect(sidebar.className).toContain('bg-[#0B1F44]');
    expect(sidebar.className).toContain('text-white');
    expect(sidebar.className).not.toContain('bg-card');
    expect(sidebar.querySelector('img')?.className).toContain('invert');
    expect(active.className).toContain('bg-primary');
    expect(active.querySelector('svg')?.getAttribute('class')).toContain('text-white');
    const inactive = [...sidebar.querySelectorAll('nav a')].find((link) => link !== active) as HTMLElement;
    expect(inactive.querySelector('svg')?.getAttribute('class')).toContain('text-[#6C98FF]');
  });

  it('renders the page content and the page background token', async () => {
    renderAt('/dashboard');
    expect(await screen.findByText('Page content')).toBeTruthy();
    expect(document.querySelector('.workspace-page')?.className).toContain('--canvas');
  });
});
