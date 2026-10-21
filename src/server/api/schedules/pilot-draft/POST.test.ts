import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';

type StoredSchedule = { id: string; status: string; weekStartsAt: Date };
const state = vi.hoisted(() => ({ queue: [] as unknown[][], updates: [] as unknown[], inserts: [] as unknown[], deletes: [] as unknown[], failWrites: false }));
const world = vi.hoisted(() => ({ schedules: [] as StoredSchedule[], lookups: [] as Date[] }));

vi.mock('@/server/db/client.js', async () => ({ db: (await import('@/test/db-mock')).buildDb(state) }));
vi.mock('../../customers/tenant.js', () => ({
  getTenant: vi.fn(async () => ({ id: 'biz-1', businessName: 'Somerset Pool', businessType: 'service' })),
  textValue: (value: unknown, max = 255) => (typeof value === 'string' ? value.trim().slice(0, max) : ''),
}));
vi.mock('../../calendar/shared.js', () => ({ getCalendarSettings: vi.fn(async () => ({ timezone: 'America/Toronto' })) }));
vi.mock('@/server/plan-access.js', () => ({ requirePlanFeature: vi.fn(async () => ({ allowed: true })) }));
// Behaves like the real lookup: the schedule whose stored week start lies in [start, start + 7 calendar days).
// A wrongly computed "last week" (an hour out) therefore finds nothing, exactly as it did in the browser.
vi.mock('../drafts.js', async () => {
  const actual = await vi.importActual<typeof import('../drafts.js')>('../drafts.js');
  return {
    ...actual,
    findSchedule: vi.fn(async (_businessId: string, startsAt: Date) => {
      world.lookups.push(startsAt);
      const end = actual.addWeeks(startsAt, 1);
      return world.schedules.find((schedule) => schedule.weekStartsAt >= startsAt && schedule.weekStartsAt < end) ?? null;
    }),
  };
});

import handler from './POST';

const originalTz = process.env.TZ;
const respond = () => ({ statusCode: 200, body: undefined as unknown, status(code: number) { this.statusCode = code; return this; }, json(payload: unknown) { this.body = payload; return this; } });
const ask = (weekStart: string, instruction: string) => ({ body: { weekStart, instruction }, headers: {} }) as unknown as Request;

const avery = { id: 'avery', name: 'Avery Duggan', status: 'active' };
const sam = { id: 'sam', name: 'Sam Patel', status: 'active' };
// Avery's real shifts from the week of Oct 26 (stored in UTC): Mon 7:30–16:00, Thu 8:00–17:00, Fri 8:30–17:00 (EDT).
const shift = (id: string, employeeId: string, startsAt: string, endsAt: string) => ({ id, employeeId, startsAt: new Date(startsAt), endsAt: new Date(endsAt), location: null, notes: null });
const lastWeek = [
  shift('s1', 'avery', '2026-10-26T11:30:00.000Z', '2026-10-26T20:00:00.000Z'),
  shift('s2', 'avery', '2026-10-29T12:00:00.000Z', '2026-10-29T21:00:00.000Z'),
  shift('s3', 'avery', '2026-10-30T12:30:00.000Z', '2026-10-30T21:00:00.000Z'),
];

/** Queue what the handler reads, in the order it reads it: members, 4 lookups, week shifts, all shifts. */
function queueWeek({ members = [avery] as unknown[], availability = [] as unknown[], timeOff = [] as unknown[], targetShifts = [] as unknown[], sourceShifts = lastWeek as unknown[], allExisting = [] as unknown[], hasTarget = false }) {
  state.queue.push(members, availability, timeOff);
  if (hasTarget) state.queue.push(targetShifts);
  state.queue.push(sourceShifts, allExisting);
}
const created = () => (state.inserts.find((row) => Array.isArray(row) && (row as { weeklyScheduleId?: string }[])[0]?.weeklyScheduleId) as { employeeId: string; startsAt: Date; endsAt: Date }[]) ?? [];
const local = (date: Date) => date.toLocaleString('en-CA', { timeZone: 'America/Toronto', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: false });

beforeEach(() => {
  process.env.TZ = 'America/Toronto';
  state.queue.length = 0; state.updates.length = 0; state.inserts.length = 0; state.deletes.length = 0; state.failWrites = false;
  world.schedules = [{ id: 'sched-oct26', status: 'draft', weekStartsAt: new Date('2026-10-26T04:00:00.000Z') }]; // week of Oct 26, as stored
  world.lookups.length = 0;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); if (originalTz === undefined) delete process.env.TZ; else process.env.TZ = originalTz; });

describe('Pilot draft: "like last week" across the 1 November clock change', () => {
  const sentence = "Can you make this week's schedule like last week but add Avery on every day she's not working from last week and make the shifts 8am-5pm";

  it('finds last week (Oct 26) from the week of Nov 2, copies Avery’s real shifts, and adds her on the days she was off at 8am–5pm', async () => {
    queueWeek({});
    const res = respond();
    await handler(ask('2026-11-02T05:00:00.000Z', sentence), res as unknown as Response);

    expect(res.statusCode).toBe(201);
    expect(res.body).toMatchObject({ created: 7, moved: 0, removed: 0, skipped: 0, status: 'draft' });
    // it looked for last week at exactly the stored start, not an hour later
    expect(world.lookups.map((date) => date.toISOString())).toContain('2026-10-26T04:00:00.000Z');

    const shifts = created().map((row) => `${local(row.startsAt)} – ${local(row.endsAt).split(', ').pop()}`).sort();
    expect(shifts.sort()).toEqual([
      'Fri, Nov 6, 08:30 – 17:00',   // copied from Fri Oct 30 (8:30–5:00), keeping its own hours
      'Mon, Nov 2, 07:30 – 16:00',   // copied from Mon Oct 26 (7:30–4:00)
      'Sat, Nov 7, 08:00 – 17:00',   // added: she was off Saturday last week
      'Sun, Nov 8, 08:00 – 17:00',   // added
      'Thu, Nov 5, 08:00 – 17:00',   // copied from Thu Oct 29 (8:00–5:00), still 8:00 after the clock change
      'Tue, Nov 3, 08:00 – 17:00',   // added
      'Wed, Nov 4, 08:00 – 17:00',   // added
    ].sort());
    expect(created().every((row) => row.employeeId === 'avery')).toBe(true);
  });

  it('keeps the result an editable draft and leaves last week untouched', async () => {
    queueWeek({});
    const res = respond();
    await handler(ask('2026-11-02T05:00:00.000Z', sentence), res as unknown as Response);
    const schedule = state.inserts.find((row) => !Array.isArray(row)) as { status: string; weekStartsAt: Date };
    expect(schedule).toMatchObject({ status: 'draft' });
    expect(schedule.weekStartsAt.toISOString()).toBe('2026-11-02T05:00:00.000Z');
    expect(state.updates).toEqual([]);   // no shift of last week was changed
    expect(state.deletes).toEqual([]);   // or removed
    expect(created().every((row) => row.startsAt >= new Date('2026-11-02T05:00:00.000Z'))).toBe(true); // everything lands in the new week
  });

  it('works for any employee, not just Avery', async () => {
    const samWeek = [shift('t1', 'sam', '2026-10-27T13:00:00.000Z', '2026-10-27T21:00:00.000Z'), shift('t2', 'sam', '2026-10-28T13:00:00.000Z', '2026-10-28T21:00:00.000Z')]; // Tue, Wed
    queueWeek({ members: [avery, sam], sourceShifts: [...lastWeek, ...samWeek] });
    const res = respond();
    await handler(ask('2026-11-02T05:00:00.000Z', 'Make this week like last week and add Sam on the other days 10am-6pm'), res as unknown as Response);

    expect(res.statusCode).toBe(201);
    const bySam = created().filter((row) => row.employeeId === 'sam').map((row) => local(row.startsAt));
    expect(bySam.sort()).toEqual(['Fri, Nov 6, 10:00', 'Mon, Nov 2, 10:00', 'Sat, Nov 7, 10:00', 'Sun, Nov 8, 10:00', 'Thu, Nov 5, 10:00', 'Tue, Nov 3, 09:00', 'Wed, Nov 4, 09:00'].sort());
    expect(created().filter((row) => row.employeeId === 'avery')).toHaveLength(3); // Avery is just copied
    expect(res.body).toMatchObject({ created: 10 });
  });

  it('can copy the previous week on its own', async () => {
    queueWeek({});
    const res = respond();
    await handler(ask('2026-11-02T05:00:00.000Z', 'Make this week like last week'), res as unknown as Response);
    expect(res.statusCode).toBe(201);
    expect(res.body).toMatchObject({ created: 3 });
    expect(created().map((row) => local(row.startsAt)).sort()).toEqual(['Fri, Nov 6, 08:30', 'Mon, Nov 2, 07:30', 'Thu, Nov 5, 08:00']);
  });

  it('does not add a second shift on a day the employee already has one in this week', async () => {
    world.schedules.push({ id: 'sched-nov2', status: 'draft', weekStartsAt: new Date('2026-11-02T05:00:00.000Z') });
    const tuesday = shift('x1', 'avery', '2026-11-03T14:00:00.000Z', '2026-11-03T22:00:00.000Z'); // Avery already on Tue Nov 3
    queueWeek({ hasTarget: true, targetShifts: [tuesday], allExisting: [tuesday] });
    const res = respond();
    await handler(ask('2026-11-02T05:00:00.000Z', sentence), res as unknown as Response);
    expect(res.statusCode).toBe(201);
    const days = created().map((row) => local(row.startsAt).split(',')[0]).sort();
    expect(days).toEqual(['Fri', 'Mon', 'Sat', 'Sun', 'Thu', 'Wed']); // no second Tuesday
  });

  it('leaves out a copied shift that clashes with approved time off and says how many', async () => {
    queueWeek({ timeOff: [{ employeeId: 'avery', startsAt: new Date('2026-11-05T00:00:00.000Z'), endsAt: new Date('2026-11-06T04:00:00.000Z') }] }); // Thursday Nov 5
    const res = respond();
    await handler(ask('2026-11-02T05:00:00.000Z', 'Make this week like last week'), res as unknown as Response);
    expect(res.statusCode).toBe(201);
    expect(res.body).toMatchObject({ created: 2, skipped: 1 });
  });

  it('says so, rather than failing mysteriously, when last week really has no schedule', async () => {
    world.schedules = [];
    state.queue.push([avery], [], []);
    const res = respond();
    await handler(ask('2026-11-02T05:00:00.000Z', 'Make this week like last week'), res as unknown as Response);
    expect(res.statusCode).toBe(400);
    expect((res.body as { error: string }).error).toBe('There is no schedule for the previous week (the week of October 26) to copy.');
  });

  it('asks for the hours instead of guessing when none are given', async () => {
    queueWeek({});
    const res = respond();
    await handler(ask('2026-11-02T05:00:00.000Z', 'Add Avery on every day she is not working'), res as unknown as Response);
    expect(res.statusCode).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/What hours should Avery Duggan work/);
  });

  it('still understands "every day" on its own as repeating one shift, now that last week is found correctly', async () => {
    queueWeek({ sourceShifts: [lastWeek[0]] });
    const res = respond();
    await handler(ask('2026-11-02T05:00:00.000Z', 'Avery same shift every day'), res as unknown as Response);
    expect(res.statusCode).toBe(201);
    expect(res.body).toMatchObject({ created: 7 });
  });
});
