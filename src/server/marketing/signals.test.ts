import { describe, expect, it } from 'vitest';
import { buildSignals, countryFor, holidaysFor, seasonContext } from './signals';

const TZ = 'America/Toronto';
const NOW = new Date('2026-03-10T16:00:00Z'); // Tuesday 10 March 2026
const at = (daysAgo: number) => new Date(NOW.getTime() - daysAgo * 86_400_000);
const jobs = (name: string, daysAgoList: number[]) => daysAgoList.map((days) => ({ name, date: at(days) }));

describe('signals from the business’s own records', () => {
  it('says which service is most active, with the numbers', () => {
    const signals = buildSignals({ now: NOW, timezone: TZ, demand: [...jobs('Pool cleaning', [1, 5, 9, 20, 40, 70]), ...jobs('Pool opening', [3, 50])] });
    const top = signals.find((signal) => signal.kind === 'top_service')!;
    expect(top.label).toBe('Pool cleaning is your most active service');
    expect(top.detail).toBe('6 bookings in the last 90 days, ahead of Pool opening (2).');
  });

  it('notices a service slowing down only with enough bookings to say so', () => {
    const slow = buildSignals({ now: NOW, timezone: TZ, demand: [...jobs('Pool opening', [2]), ...jobs('Pool opening', [35, 38, 41, 44, 47])] });
    expect(slow.find((signal) => signal.kind === 'slowing_service')).toMatchObject({ label: 'Pool opening bookings have slowed', detail: '1 in the last 30 days, compared with 5 in the 30 days before.', service: 'Pool opening' });
    const tooFew = buildSignals({ now: NOW, timezone: TZ, demand: [...jobs('Pool opening', [35, 40]), ...jobs('Pool opening', [])] });
    expect(tooFew.find((signal) => signal.kind === 'slowing_service')).toBeUndefined();
  });

  it('notices a service picking up', () => {
    const rising = buildSignals({ now: NOW, timezone: TZ, demand: [...jobs('Filter swap', [1, 2, 3, 4]), ...jobs('Filter swap', [40, 45])] });
    expect(rising.find((signal) => signal.kind === 'growing_service')?.detail).toBe('4 in the last 30 days, up from 2 in the 30 days before.');
  });

  it('treats the same service written differently as one', () => {
    const signals = buildSignals({ now: NOW, timezone: TZ, demand: [{ name: 'Pool Cleaning', date: at(1) }, { name: ' pool  cleaning ', date: at(2) }] });
    expect(signals.find((signal) => signal.kind === 'top_service')?.detail).toMatch(/^2 bookings/);
  });

  it('invents nothing for a business with no records: only calendar facts remain', () => {
    const signals = buildSignals({ now: NOW, timezone: TZ, demand: [] });
    expect(signals.filter((signal) => ['top_service', 'slowing_service', 'growing_service'].includes(signal.kind))).toEqual([]);
    expect(signals.every((signal) => signal.kind === 'season' || signal.kind === 'holiday')).toBe(true);
  });
});

describe('seasons and holidays come from the calendar and say so', () => {
  it('knows when the next season starts and that it is calendar-based', () => {
    const signals = buildSignals({ now: NOW, timezone: TZ, demand: [] });
    const season = signals.find((signal) => signal.kind === 'season')!;
    expect(season.label).toBe('Spring begins in 10 days');
    expect(season.detail).toContain('This comes from the calendar, not from your records.');
  });

  it('lists holidays coming up within 45 days for the right country', () => {
    const signals = buildSignals({ now: NOW, timezone: TZ, demand: [] });
    expect(signals.filter((signal) => signal.kind === 'holiday').map((signal) => signal.label)).toEqual(['Easter is in 26 days']);
    expect(countryFor('America/Toronto')).toBe('CA');
    expect(countryFor('America/Chicago')).toBe('US');
  });

  it('computes movable holidays correctly', () => {
    const ca = Object.fromEntries(holidaysFor(2026, 'CA').map((holiday) => [holiday.name, holiday.date]));
    expect(ca).toMatchObject({ Easter: '2026-04-05', 'Mother’s Day': '2026-05-10', 'Father’s Day': '2026-06-21', 'Victoria Day': '2026-05-18', 'Labour Day': '2026-09-07', Thanksgiving: '2026-10-12' });
    const us = Object.fromEntries(holidaysFor(2026, 'US').map((holiday) => [holiday.name, holiday.date]));
    expect(us).toMatchObject({ 'Memorial Day': '2026-05-25', Thanksgiving: '2026-11-26' });
  });

  it('flips the seasons in the southern hemisphere', () => {
    expect(seasonContext(NOW, TZ).next).toBe('spring');
    expect(seasonContext(NOW, 'Australia/Sydney').next).toBe('fall');
  });
});
