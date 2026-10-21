import { describe, expect, it } from 'vitest';
import { resolveScheduleWeek } from './schedule-week';

const wednesday = new Date('2026-10-21T15:00:00Z'); // Wed 21 Oct 2026, 11am in Toronto
const tz = 'America/Toronto';

describe('resolveScheduleWeek', () => {
  it('finds this week’s Monday', () => {
    expect(resolveScheduleWeek('this', wednesday, tz)).toMatchObject({ mondayDate: '2026-10-19', label: 'the week of October 19' });
  });
  it('finds next week’s and last week’s Monday', () => {
    expect(resolveScheduleWeek('next', wednesday, tz)?.mondayDate).toBe('2026-10-26');
    expect(resolveScheduleWeek('last week', wednesday, tz)?.mondayDate).toBe('2026-10-12');
  });
  it('accepts any date inside the week, including a Sunday', () => {
    expect(resolveScheduleWeek('2026-10-28', wednesday, tz)?.mondayDate).toBe('2026-10-26');
    expect(resolveScheduleWeek('2026-11-01', wednesday, tz)?.mondayDate).toBe('2026-10-26'); // Sunday belongs to the week before it
  });
  it('uses the business’s own calendar day, not UTC, near midnight', () => {
    const lateSundayToronto = new Date('2026-10-26T02:30:00Z'); // still Sunday 25 Oct 10:30pm in Toronto
    expect(resolveScheduleWeek('this', lateSundayToronto, tz)?.mondayDate).toBe('2026-10-19');
  });
  it('returns an iso time the schedule routes accept (inside Monday)', () => {
    expect(resolveScheduleWeek('this', wednesday, tz)?.weekStartIso).toBe('2026-10-19T12:00:00.000Z');
  });
  it('gives up on things it cannot read', () => {
    expect(resolveScheduleWeek('someday', wednesday, tz)).toBeNull();
    expect(resolveScheduleWeek('2026-13-45', wednesday, tz)).toBeNull();
  });
});
