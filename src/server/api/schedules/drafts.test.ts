import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addWeeks, shiftWeek } from './drafts';

const originalTz = process.env.TZ;
beforeEach(() => { process.env.TZ = 'America/Toronto'; }); // clocks go back on 1 Nov 2026 and forward on 14 Mar 2027
afterEach(() => { if (originalTz === undefined) delete process.env.TZ; else process.env.TZ = originalTz; });

const iso = (date: Date) => date.toISOString();

describe('addWeeks (calendar weeks, not 168 hours)', () => {
  it('finds the stored start of last week from the week of 2 November', () => {
    const nov2 = new Date('2026-11-02T05:00:00.000Z'); // midnight EST
    expect(iso(addWeeks(nov2, -1))).toBe('2026-10-26T04:00:00.000Z'); // midnight EDT: exactly how the week is stored
  });
  it('and goes forward again to the same moment', () => {
    expect(iso(addWeeks(new Date('2026-10-26T04:00:00.000Z'), 1))).toBe('2026-11-02T05:00:00.000Z');
  });
  it('handles the spring change too', () => {
    expect(iso(addWeeks(new Date('2027-03-15T04:00:00.000Z'), -1))).toBe('2027-03-08T05:00:00.000Z'); // 8 March, not 1 March
    expect(iso(addWeeks(new Date('2027-03-08T05:00:00.000Z'), 1))).toBe('2027-03-15T04:00:00.000Z');
  });
  it('is the plain 7 days when no clock change is involved', () => {
    expect(iso(addWeeks(new Date('2026-10-12T04:00:00.000Z'), 1))).toBe('2026-10-19T04:00:00.000Z');
  });
});

describe('shiftWeek keeps the wall-clock time of a shift', () => {
  const seed = (startsAt: string, endsAt: string) => ({ employeeId: 'e1', startsAt: new Date(startsAt), endsAt: new Date(endsAt), location: null, notes: null });

  it('a Thursday 8:00 AM–5:00 PM shift stays 8:00–5:00 when copied across the autumn clock change', () => {
    const copied = shiftWeek(seed('2026-10-29T12:00:00.000Z', '2026-10-29T21:00:00.000Z'), 1); // Thu 29 Oct 8:00–17:00 EDT
    expect([iso(copied.startsAt), iso(copied.endsAt)]).toEqual(['2026-11-05T13:00:00.000Z', '2026-11-05T22:00:00.000Z']); // Thu 5 Nov 8:00–17:00 EST
    expect(copied.startsAt.toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit', hour12: false })).toBe('08:00');
  });

  it('and the same going the other way across the spring change', () => {
    const copied = shiftWeek(seed('2027-03-15T12:00:00.000Z', '2027-03-15T21:00:00.000Z'), -1); // Mon 15 Mar 8:00–17:00 EDT
    expect(copied.startsAt.toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit', hour12: false })).toBe('08:00');
    expect(iso(copied.startsAt)).toBe('2027-03-08T13:00:00.000Z'); // Mon 8 Mar 8:00 EST
  });

  it('keeps the other details of the shift', () => {
    const copied = shiftWeek({ ...seed('2026-10-12T12:00:00.000Z', '2026-10-12T20:00:00.000Z'), location: 'Pool A', notes: 'Bring keys' }, 1);
    expect(copied).toMatchObject({ employeeId: 'e1', location: 'Pool A', notes: 'Bring keys' });
  });
});
