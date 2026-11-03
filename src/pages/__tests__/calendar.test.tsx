import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { HelmetProvider } from '@dr.pogodin/react-helmet';
import { MemoryRouter } from 'react-router';

const session = vi.hoisted(() => ({ userId: 'user-1' }));
vi.mock('@/lib/auth/auth-client', () => ({ ProtectedRoute: ({ children }: { children: unknown }) => children, useSession: () => ({ user: { id: session.userId }, isAuthenticated: true }) }));
vi.mock('@/layouts/WorkspaceLayout', () => ({ default: ({ children }: { children: unknown }) => children }));

import CalendarPage from '../calendar';
import { preferencesKey } from '@/lib/calendar-preferences';

const at = (day: number, hour: number) => new Date(`2026-10-${String(day).padStart(2, '0')}T${String(hour + 4).padStart(2, '0')}:00:00Z`).toISOString(); // Toronto is UTC-4 in October
const appointment = (id: string, customerName: string, title: string, status: string, scheduledAt: string) => ({ id, customerId: `c-${id}`, customerName, title, status, scheduledAt, durationMinutes: 60, notes: null, customerPhoneNumber: '5550100001', customerEmail: null });
const appointments = [
  appointment('a1', 'Jordan Rivera', 'Pool opening', 'completed', at(20, 10)),
  appointment('a2', 'Casey Lee', 'Filter swap', 'scheduled', at(21, 14)),
  appointment('a3', 'Sam Patel', 'Cleaning', 'cancelled', at(22, 9)),
  appointment('a4', 'Weekend Customer', 'Weekend visit', 'scheduled', at(24, 10)),
];
const jobs = [
  { id: 'j1', customerName: 'Pat Doyle', service: 'Pool Cleaning', status: 'booked', scheduledAt: at(21, 8), assignedEmployee: 'Avery' },
  { id: 'j2', customerName: 'Morgan Diaz', service: 'Lawn care', status: 'booked', scheduledAt: at(22, 11), assignedEmployee: 'Sarah' },
];
const employees = ['Avery', 'Sarah', 'Mike'].map((name, index) => ({ id: `e${index}`, name, status: 'active' }));

let data: { appointments: unknown[]; jobs: unknown[] };
beforeEach(() => {
  window.localStorage.clear(); session.userId = 'user-1'; data = { appointments, jobs };
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-21T16:00:00Z') });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.startsWith('/api/calendar')) return new Response(JSON.stringify({ businessType: 'service', appointments: data.appointments, settings: { timezone: 'America/Toronto', defaultDurationMinutes: 60 } }), { status: 200 });
    if (url === '/api/customers') return new Response(JSON.stringify({ customers: [] }), { status: 200 });
    if (url === '/api/jobs') return new Response(JSON.stringify({ jobs: data.jobs }), { status: 200 });
    if (url === '/api/employees') return new Response(JSON.stringify({ employees }), { status: 200 });
    return new Response('{}', { status: 404 });
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

const renderCalendar = () => render(<HelmetProvider><MemoryRouter><CalendarPage /></MemoryRouter></HelmetProvider>);
const rgb = (hex: string) => { const n = parseInt(hex.slice(1), 16); return `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`; };
const chip = (text: string) => screen.getByText(text, { exact: false }).closest('[data-event]') as HTMLElement;
const edge = (element: HTMLElement) => element.style.borderLeft;
const openSettings = async () => { fireEvent.click(await screen.findByRole('button', { name: 'Calendar settings' })); return screen.getByRole('dialog', { name: 'Calendar settings' }); };
const saved = () => JSON.parse(window.localStorage.getItem(preferencesKey('user-1')) ?? 'null');

describe('calendar with real data', () => {
  it('shows appointments and jobs in the existing month view, with a hierarchy of customer, service, time', async () => {
    renderCalendar();
    const casey = await screen.findByText('Casey Lee');
    const event = casey.closest('[data-event]') as HTMLElement;
    expect(event.dataset.event).toBe('appointment');
    expect(event.textContent).toContain('Filter swap');
    expect(event.textContent).toContain('2:00 p.m.');
    expect(within(chip('Pat Doyle')).getByText(/Job · Pool Cleaning/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Month' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('works with nothing scheduled', async () => {
    data = { appointments: [], jobs: [] };
    renderCalendar();
    expect(await screen.findByText('No appointments or jobs in this period.')).toBeTruthy();
    expect(document.querySelectorAll('[data-event]')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Calendar settings' })); // the settings still open
    expect(screen.getByRole('dialog', { name: 'Calendar settings' })).toBeTruthy();
  });
});

describe('calendar settings', () => {
  it('opens from a gear button near the header and groups settings into Appearance, Layout and Display', async () => {
    renderCalendar();
    const panel = await openSettings();
    for (const heading of ['Appearance', 'Layout', 'Display']) expect(within(panel).getByText(heading)).toBeTruthy();
    fireEvent.keyDown(panel, { key: 'Escape' });
    fireEvent.click(within(panel).getByRole('button', { name: 'Close calendar settings' }));
    expect(screen.queryByRole('dialog', { name: 'Calendar settings' })).toBeNull();
  });

  it('colours events by status by default, with readable colours, and lets a status colour be changed', async () => {
    renderCalendar(); await screen.findByText('Casey Lee');
    expect(edge(chip('Jordan Rivera'))).toContain(rgb('#2E8B3D')); // completed is green
    expect(edge(chip('Casey Lee'))).toContain(rgb('#2454D6'));     // scheduled is blue
    expect(edge(chip('Sam Patel'))).toContain(rgb('#5B6B86'));     // cancelled is gray
    expect(chip('Casey Lee').style.color).toBe(rgb('#0B1F44'));     // navy text on a pale tint
    const panel = await openSettings();
    fireEvent.click(within(panel).getByRole('radio', { name: 'Scheduled: Purple' }));
    expect(edge(chip('Casey Lee'))).toContain(rgb('#7C3AED'));
    expect(saved().statusColors).toEqual({ scheduled: 'purple' });
  });

  it('colours by employee, with a colour picker for each employee', async () => {
    renderCalendar(); await screen.findByText('Casey Lee');
    const panel = await openSettings();
    fireEvent.click(within(panel).getByRole('radio', { name: 'Employee' }));
    expect(within(panel).getByText('Employee colours')).toBeTruthy();
    for (const name of ['Avery', 'Sarah', 'Mike']) expect(within(panel).getByRole('radiogroup', { name: `${name} colour` })).toBeTruthy();
    expect(edge(chip('Pat Doyle'))).toContain(rgb('#2454D6'));   // Avery gets the first colour
    expect(edge(chip('Casey Lee'))).toContain(rgb('#5B6B86'));   // an appointment with no employee stays gray
    fireEvent.click(within(panel).getByRole('radio', { name: 'Avery: Green' }));
    expect(edge(chip('Pat Doyle'))).toContain(rgb('#2E8B3D'));
    expect(edge(chip('Morgan Diaz'))).not.toContain(rgb('#2E8B3D'));
    expect(saved()).toMatchObject({ colorBy: 'employee', employeeColors: { avery: 'green' } });
  });

  it('colours by job or service type, so the same service matches', async () => {
    renderCalendar(); await screen.findByText('Casey Lee');
    const panel = await openSettings();
    fireEvent.click(within(panel).getByRole('radio', { name: 'Job / service type' }));
    expect(saved().colorBy).toBe('service');
    expect(edge(chip('Pat Doyle'))).not.toBe(edge(chip('Morgan Diaz')));
  });

  it('shows or hides each part of an event', async () => {
    renderCalendar(); await screen.findByText('Casey Lee');
    const panel = await openSettings();
    fireEvent.click(within(panel).getByRole('switch', { name: 'Customer names' }));
    expect(screen.queryByText('Casey Lee')).toBeNull();
    expect(screen.getAllByText('Filter swap').length).toBeGreaterThan(0);
    fireEvent.click(within(panel).getByRole('switch', { name: 'Customer names' }));
    fireEvent.click(within(panel).getByRole('switch', { name: 'Appointment status' }));
    expect(chip('Casey Lee').textContent).toContain('Scheduled');
    fireEvent.click(within(panel).getByRole('switch', { name: 'Employee names' }));
    expect(chip('Pat Doyle').textContent).not.toContain('Avery');
  });

  it('can hide completed and cancelled appointments', async () => {
    renderCalendar(); await screen.findByText('Casey Lee');
    const panel = await openSettings();
    fireEvent.click(within(panel).getByRole('switch', { name: 'Cancelled appointments' }));
    expect(screen.queryByText('Sam Patel')).toBeNull();
    fireEvent.click(within(panel).getByRole('switch', { name: 'Completed appointments' }));
    expect(screen.queryByText('Jordan Rivera')).toBeNull();
    expect(screen.getByText('Casey Lee')).toBeTruthy();
  });

  it('changes how much each event shows with density', async () => {
    renderCalendar(); await screen.findByText('Casey Lee');
    const panel = await openSettings();
    fireEvent.click(within(panel).getByRole('radio', { name: 'Compact' }));
    expect(chip('Casey Lee').querySelectorAll('span')).toHaveLength(1);
    expect(chip('Casey Lee').textContent).toBe('2:00 p.m. · Casey Lee');
    fireEvent.click(within(panel).getByRole('radio', { name: 'Spacious' }));
    expect(chip('Casey Lee').querySelectorAll('span').length).toBeGreaterThanOrEqual(2);
    expect(saved().density).toBe('spacious');
  });
});

describe('layout settings', () => {
  const headers = () => [...document.querySelectorAll('.border-l.border-t.border-border > div')].map((node) => node.textContent);

  it('hides weekends and says when events are hidden because of it', async () => {
    renderCalendar(); await screen.findByText('Casey Lee');
    expect(headers()).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
    expect(screen.getByText('Weekend Customer')).toBeTruthy();
    const panel = await openSettings();
    fireEvent.click(within(panel).getByRole('switch', { name: 'Show weekends' }));
    expect(headers()).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);
    expect(screen.queryByText('Weekend Customer')).toBeNull();
    expect(screen.getByText(/1 event falls on a weekend and is hidden/)).toBeTruthy();
    expect(document.querySelectorAll('[data-day]').length % 5).toBe(0);
    fireEvent.click(within(panel).getByRole('switch', { name: 'Show weekends' }));
    expect(screen.getByText('Weekend Customer')).toBeTruthy();
  });

  it('starts the week on Monday when asked', async () => {
    renderCalendar(); await screen.findByText('Casey Lee');
    const panel = await openSettings();
    fireEvent.click(within(panel).getByRole('radio', { name: 'Monday' }));
    await waitFor(() => expect(headers()[0]).toBe('Mon'));
    expect(headers()).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    expect(document.querySelector('[data-day]')?.getAttribute('data-day')).toBe('2026-09-28');
    expect(saved().weekStartsOn).toBe(1);
  });

  it('switches between day, week and month, and the buttons and settings agree', async () => {
    renderCalendar(); await screen.findByText('Casey Lee');
    fireEvent.click(screen.getByRole('button', { name: 'Week' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Week' }).getAttribute('aria-pressed')).toBe('true'));
    expect(document.querySelectorAll('[data-day]')).toHaveLength(7);
    fireEvent.click(screen.getByRole('button', { name: 'Day' }));
    await waitFor(() => expect(document.querySelectorAll('[data-day]')).toHaveLength(1));
    const panel = await openSettings();
    expect(within(panel).getByRole('radio', { name: 'Day' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(within(panel).getByRole('radio', { name: 'Month' }));
    await waitFor(() => expect(document.querySelectorAll('[data-day]')).toHaveLength(42));
  });
});

describe('saved preferences', () => {
  it('remembers the last view and every choice when the calendar is opened again', async () => {
    const first = renderCalendar(); await screen.findByText('Casey Lee');
    fireEvent.click(screen.getByRole('button', { name: 'Week' }));
    const panel = await openSettings();
    fireEvent.click(within(panel).getByRole('radio', { name: 'Employee' }));
    fireEvent.click(within(panel).getByRole('radio', { name: 'Avery: Purple' }));
    fireEvent.click(within(panel).getByRole('radio', { name: 'Compact' }));
    fireEvent.click(within(panel).getByRole('switch', { name: 'Show weekends' }));
    fireEvent.click(within(panel).getByRole('radio', { name: 'Monday' }));
    first.unmount();

    renderCalendar(); await screen.findByText(/Casey Lee/);
    expect(screen.getByRole('button', { name: 'Week' }).getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelectorAll('[data-day]')).toHaveLength(5);
    expect(edge(chip('Pat Doyle'))).toContain(rgb('#7C3AED'));
    expect(chip('Casey Lee').querySelectorAll('span')).toHaveLength(1);
    const reopened = await openSettings();
    expect(within(reopened).getByRole('switch', { name: 'Show weekends' }).hasAttribute('checked') || (within(reopened).getByRole('switch', { name: 'Show weekends' }) as HTMLInputElement).checked).toBe(false);
  });

  it('keeps each user’s preferences separate', async () => {
    const first = renderCalendar(); await screen.findByText('Casey Lee');
    fireEvent.click(screen.getByRole('button', { name: 'Day' }));
    expect(saved().view).toBe('day');
    first.unmount();
    session.userId = 'user-2';
    renderCalendar(); await screen.findByText('Casey Lee');
    expect(screen.getByRole('button', { name: 'Month' }).getAttribute('aria-pressed')).toBe('true');
    expect(window.localStorage.getItem(preferencesKey('user-2'))).toBeNull();
  });

  it('falls back to defaults if the saved preferences are damaged', async () => {
    window.localStorage.setItem(preferencesKey('user-1'), '{"view":"decade","density":"gigantic"');
    renderCalendar(); expect(await screen.findByText('Casey Lee')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Month' }).getAttribute('aria-pressed')).toBe('true');
  });
});

describe('existing calendar features still work', () => {
  it('opens the new appointment form, and an existing appointment’s details', async () => {
    renderCalendar(); fireEvent.click(await screen.findByText('Casey Lee'));
    expect(screen.getByRole('dialog', { name: /Filter swap/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getAllByRole('button', { name: /New appointment/i })[0]);
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});
