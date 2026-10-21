import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { HelmetProvider } from '@dr.pogodin/react-helmet';
import { MemoryRouter } from 'react-router';

vi.mock('@/lib/auth/auth-client', () => ({ ProtectedRoute: ({ children }: { children: unknown }) => children }));
vi.mock('@/layouts/WorkspaceLayout', () => ({ default: ({ children }: { children: unknown }) => children }));

import SchedulingPage from '../scheduling';

const json = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), { status });

describe('Scheduling: Add shift', () => {
  let posts: { url: string; body: Record<string, string> }[];

  beforeEach(() => {
    posts = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST' && url === '/api/schedules') {
        posts.push({ url, body: JSON.parse(String(init.body)) });
        return json({ ok: true }, 201);
      }
      if (url.startsWith('/api/schedules?')) return json({ schedule: null, shifts: [], deliveries: [], timezone: 'America/Toronto' });
      if (url === '/api/employees') return json({ employees: [{ id: 'emp-1', name: 'Avery Stone', status: 'active' }, { id: 'emp-2', name: 'Former Fred', status: 'inactive' }] });
      if (url === '/api/schedule-templates') return json({ templates: [] });
      return json({}, 404);
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  function renderPage() {
    return render(<HelmetProvider><MemoryRouter><SchedulingPage /></MemoryRouter></HelmetProvider>);
  }

  it('opens the shift form as a dialog right away, not at the bottom of the page', async () => {
    renderPage();
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'Add shift' }));

    const dialog = screen.getByRole('dialog', { name: 'Add shift' });
    expect(dialog.closest('.fixed')).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Avery Stone' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'Former Fred' })).toBeNull();
  });

  it('saves the shift for the chosen employee and closes the dialog', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Add shift' }));
    const dialog = screen.getByRole('dialog');
    const field = (name: string) => dialog.querySelector(`[name="${name}"]`) as HTMLInputElement;
    fireEvent.change(field('employeeId'), { target: { value: 'emp-1' } });
    fireEvent.change(field('date'), { target: { value: '2026-10-21' } });
    fireEvent.change(field('startTime'), { target: { value: '08:00' } });
    fireEvent.change(field('endTime'), { target: { value: '17:00' } });
    fireEvent.submit(dialog);

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].body.employeeId).toBe('emp-1');
    expect(new Date(posts[0].body.endsAt).getTime() - new Date(posts[0].body.startsAt).getTime()).toBe(9 * 3_600_000);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('closes with Cancel or Escape without saving', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Add shift' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Add shift' }));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(posts).toEqual([]);
  });
});

describe('Scheduling: week navigation', () => {
  const originalTz = process.env.TZ;
  type WeekData = { status?: string; shifts?: { id: string; employeeName: string }[]; delayMs?: number };
  let weeks: Record<string, WeekData>;
  let requested: string[];
  const pending: { resolve: () => void }[] = [];

  const localDay = (iso: string) => new Date(iso).toLocaleDateString('en-CA'); // YYYY-MM-DD in the browser's zone

  beforeEach(() => {
    process.env.TZ = 'America/Toronto'; // the zone where the clock changes on 1 Nov 2026 and 14 Mar 2027
    weeks = {}; requested = []; pending.length = 0;
    vi.useFakeTimers({ toFake: ['Date'] }); // only the clock; promises and timers keep working
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.startsWith('/api/schedules?')) {
        const day = localDay(decodeURIComponent(url.split('weekStart=')[1]));
        requested.push(day);
        const data = weeks[day] ?? {};
        if (data.delayMs) await new Promise<void>((resolve) => pending.push({ resolve }));
        return json({
          schedule: data.status ? { id: `sched-${day}`, status: data.status } : null,
          shifts: (data.shifts ?? []).map((shift) => ({ ...shift, employeeId: shift.id, startsAt: `${day}T14:00:00.000Z`, endsAt: `${day}T22:00:00.000Z`, location: null, notes: null })),
          deliveries: [], timezone: 'America/Toronto',
        });
      }
      if (url === '/api/employees') return json({ employees: [] });
      if (url === '/api/schedule-templates') return json({ templates: [] });
      return json({}, 404);
    }));
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); if (originalTz === undefined) delete process.env.TZ; else process.env.TZ = originalTz; });

  const open = (now: string) => { vi.setSystemTime(new Date(now)); render(<HelmetProvider><MemoryRouter><SchedulingPage /></MemoryRouter></HelmetProvider>); };
  const label = () => (screen.getByText(/^Week of /).textContent ?? '').replace(/ · .*$/, '');
  const next = () => fireEvent.click(screen.getByRole('button', { name: 'Next week' }));
  const previous = () => fireEvent.click(screen.getByRole('button', { name: 'Previous week' }));

  it('moves forward and back one week at a time', async () => {
    open('2026-10-14T16:00:00-04:00');
    await screen.findByText('Week of October 12, 2026 · Draft');
    next(); await waitFor(() => expect(label()).toBe('Week of October 19, 2026'));
    next(); await waitFor(() => expect(label()).toBe('Week of October 26, 2026'));
    previous(); await waitFor(() => expect(label()).toBe('Week of October 19, 2026'));
  });

  it('gets past the autumn clock change instead of sticking on the week of 26 October', async () => {
    open('2026-10-27T12:00:00-04:00');
    await screen.findByText(/Week of October 26, 2026/);
    next(); await waitFor(() => expect(label()).toBe('Week of November 2, 2026'));
    next(); await waitFor(() => expect(label()).toBe('Week of November 9, 2026'));
    previous(); await waitFor(() => expect(label()).toBe('Week of November 2, 2026'));
    previous(); await waitFor(() => expect(label()).toBe('Week of October 26, 2026'));
  });

  it('does not skip the week of 8 March when going back across the spring clock change', async () => {
    open('2027-03-17T12:00:00-04:00');
    await screen.findByText(/Week of March 15, 2027/);
    previous(); await waitFor(() => expect(label()).toBe('Week of March 8, 2027'));
    previous(); await waitFor(() => expect(label()).toBe('Week of March 1, 2027'));
    next(); await waitFor(() => expect(label()).toBe('Week of March 8, 2027'));
    next(); await waitFor(() => expect(label()).toBe('Week of March 15, 2027'));
  });

  it('visits every week in turn, with none repeated or skipped, across both clock changes', async () => {
    open('2026-10-14T12:00:00-04:00');
    await screen.findByText(/Week of October 12, 2026/);
    const seen = [label()];
    for (let step = 0; step < 8; step += 1) { const before = label(); next(); await waitFor(() => expect(label()).not.toBe(before)); seen.push(label()); }
    expect(seen).toEqual(['October 12', 'October 19', 'October 26', 'November 2', 'November 9', 'November 16', 'November 23', 'November 30', 'December 7'].map((day) => `Week of ${day}, 2026`));
    expect(requested.slice(-3)).toEqual(['2026-11-23', '2026-11-30', '2026-12-07']); // the right Monday is asked for each time
  });

  it('shows seven day columns that match the selected week', async () => {
    open('2026-10-27T12:00:00-04:00');
    await screen.findByText(/Week of October 26, 2026/);
    next(); await waitFor(() => expect(label()).toBe('Week of November 2, 2026'));
    const headings = screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent ?? '');
    const days = headings.filter((text) => /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/.test(text));
    expect(days).toHaveLength(7);
    expect(days[0]).toMatch(/Nov(ember)? 2/);
    expect(days[6]).toMatch(/Nov(ember)? 8/);
  });

  it('loads each week’s own shifts and status, and they are intact when you come back', async () => {
    weeks = { '2026-10-19': { status: 'published', shifts: [{ id: 'a', employeeName: 'Avery Stone' }, { id: 'b', employeeName: 'Sam Patel' }] }, '2026-10-26': { status: 'draft', shifts: [{ id: 'c', employeeName: 'Morgan Diaz' }] } };
    open('2026-10-21T12:00:00-04:00');
    await screen.findByText('Week of October 19, 2026 · published');
    expect(screen.getAllByText('Avery Stone')).toHaveLength(1);
    expect(screen.getAllByText('Sam Patel')).toHaveLength(1);

    next();
    await screen.findByText('Week of October 26, 2026 · draft');
    expect(screen.queryByText('Avery Stone')).toBeNull();
    expect(screen.getAllByText('Morgan Diaz')).toHaveLength(1);

    next();
    await screen.findByText('Week of November 2, 2026 · Draft'); // no schedule yet for this week
    expect(screen.queryByText('Morgan Diaz')).toBeNull();

    previous(); previous();
    await screen.findByText('Week of October 19, 2026 · published');
    expect(screen.getAllByText('Avery Stone')).toHaveLength(1); // not lost, not duplicated
    expect(screen.getAllByText('Sam Patel')).toHaveLength(1);
    expect(screen.queryByText('Morgan Diaz')).toBeNull();
  });

  it('ignores a slow answer for a week you have already left', async () => {
    weeks = { '2026-10-19': { status: 'published', shifts: [{ id: 'a', employeeName: 'Avery Stone' }], delayMs: 1 }, '2026-10-26': { status: 'draft', shifts: [{ id: 'c', employeeName: 'Morgan Diaz' }] } };
    open('2026-10-21T12:00:00-04:00');
    await waitFor(() => expect(pending).toHaveLength(1)); // the first week is still loading
    next();
    await screen.findByText('Week of October 26, 2026 · draft');
    expect(screen.getAllByText('Morgan Diaz')).toHaveLength(1);

    pending[0].resolve(); // the old week's answer finally arrives
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByText('Avery Stone')).toBeNull(); // it must not overwrite the week on screen
    expect(screen.getByText('Week of October 26, 2026 · draft')).toBeTruthy();
    expect(screen.getAllByText('Morgan Diaz')).toHaveLength(1);
  });
});
