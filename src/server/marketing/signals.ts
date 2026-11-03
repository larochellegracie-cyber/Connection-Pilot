/**
 * Real signals for marketing, worked out from the business's own records and the calendar.
 * Pure functions: nothing here is estimated, and a signal only exists when the numbers support it.
 */
export type Signal = {
  id: string;
  kind: 'top_service' | 'slowing_service' | 'growing_service' | 'season' | 'holiday';
  label: string;
  /** A plain-language statement of fact, with the numbers it rests on. */
  detail: string;
  /** The service this is about, when it is about one. */
  service?: string;
  asOf: string;
};

export type SignalInput = {
  now: Date;
  timezone: string;
  /** Anything that shows demand for a service: job names and appointment titles, with the day they were scheduled. */
  demand: Array<{ name: string; date: Date | null }>;
};

const DAY_MS = 86_400_000;
const localDate = (date: Date, timezone: string) => new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
const normalize = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ');
const shortDate = (day: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', month: 'long', day: 'numeric' }).format(new Date(`${day}T12:00:00Z`));
const addDays = (day: string, days: number) => { const next = new Date(`${day}T12:00:00Z`); next.setUTCDate(next.getUTCDate() + days); return next.toISOString().slice(0, 10); };
const daysUntil = (from: string, to: string) => Math.round((new Date(`${to}T12:00:00Z`).getTime() - new Date(`${from}T12:00:00Z`).getTime()) / DAY_MS);

const canadianZones = /^America\/(Toronto|Vancouver|Edmonton|Winnipeg|Halifax|Regina|St_Johns|Montreal|Moncton|Glace_Bay|Iqaluit|Whitehorse|Yellowknife|Thunder_Bay|Nipigon|Rainy_River|Cambridge_Bay)/;
export const isSouthernHemisphere = (timezone: string) => /^(Australia\/|Pacific\/Auckland|America\/(Sao_Paulo|Argentina|Santiago|Montevideo)|Africa\/(Johannesburg|Harare|Maputo))/.test(timezone);
export const countryFor = (timezone: string): 'CA' | 'US' => (canadianZones.test(timezone) ? 'CA' : 'US');

/** Date of the nth weekday (0 = Sunday) of a month; n = -1 means the last one. */
function nthWeekday(year: number, month: number, weekday: number, n: number): string {
  if (n > 0) { const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay(); return new Date(Date.UTC(year, month - 1, 1 + ((weekday - first + 7) % 7) + (n - 1) * 7)).toISOString().slice(0, 10); }
  const last = new Date(Date.UTC(year, month, 0)); return new Date(Date.UTC(year, month - 1, last.getUTCDate() - ((last.getUTCDay() - weekday + 7) % 7))).toISOString().slice(0, 10);
}
/** Easter Sunday (Gregorian). */
function easter(year: number): string {
  const a = year % 19; const b = Math.floor(year / 100); const c = year % 100; const d = Math.floor(b / 4); const e = b % 4; const f = Math.floor((b + 8) / 25); const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30; const i = Math.floor(c / 4); const k = c % 4; const l = (32 + 2 * e + 2 * i - h - k) % 7; const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function holidaysFor(year: number, country: 'CA' | 'US'): Array<{ name: string; date: string }> {
  const fixed = (month: number, day: number) => `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const common = [
    { name: 'Valentine’s Day', date: fixed(2, 14) }, { name: 'Easter', date: easter(year) }, { name: 'Mother’s Day', date: nthWeekday(year, 5, 0, 2) },
    { name: 'Father’s Day', date: nthWeekday(year, 6, 0, 3) }, { name: 'Halloween', date: fixed(10, 31) }, { name: 'Christmas', date: fixed(12, 25) },
  ];
  const victoria = (() => { const may25 = new Date(Date.UTC(year, 4, 25)); return new Date(Date.UTC(year, 4, 25 - (((may25.getUTCDay() + 6) % 7) || 7))).toISOString().slice(0, 10); })();
  const ca = [{ name: 'Victoria Day', date: victoria }, { name: 'Canada Day', date: fixed(7, 1) }, { name: 'Labour Day', date: nthWeekday(year, 9, 1, 1) }, { name: 'Thanksgiving', date: nthWeekday(year, 10, 1, 2) }, { name: 'Remembrance Day', date: fixed(11, 11) }];
  const us = [{ name: 'Memorial Day', date: nthWeekday(year, 5, 1, -1) }, { name: 'Independence Day', date: fixed(7, 4) }, { name: 'Labor Day', date: nthWeekday(year, 9, 1, 1) }, { name: 'Thanksgiving', date: nthWeekday(year, 11, 4, 4) }];
  return [...common, ...(country === 'CA' ? ca : us)].sort((a, b) => a.date.localeCompare(b.date));
}

const seasons = [{ name: 'spring', month: 3, day: 20 }, { name: 'summer', month: 6, day: 21 }, { name: 'fall', month: 9, day: 22 }, { name: 'winter', month: 12, day: 21 }] as const;
const flip: Record<string, string> = { spring: 'fall', summer: 'winter', fall: 'spring', winter: 'summer' };

export function seasonContext(now: Date, timezone: string) {
  const today = localDate(now, timezone);
  const year = Number(today.slice(0, 4));
  const starts = [-1, 0, 1].flatMap((offset) => seasons.map((season) => ({ name: season.name, date: `${year + offset}-${String(season.month).padStart(2, '0')}-${String(season.day).padStart(2, '0')}` }))).sort((a, b) => a.date.localeCompare(b.date));
  const south = isSouthernHemisphere(timezone);
  const name = (value: string) => (south ? flip[value] : value);
  const current = [...starts].reverse().find((season) => season.date <= today)!;
  const next = starts.find((season) => season.date > today)!;
  return { current: name(current.name), next: name(next.name), nextStarts: next.date, daysToNext: daysUntil(today, next.date) };
}

export function buildSignals(input: SignalInput): Signal[] {
  const { now, timezone } = input;
  const today = localDate(now, timezone);
  const signals: Signal[] = [];
  const day = (date: Date | null) => (date ? localDate(date, timezone) : null);
  const within = (date: Date | null, from: string, to: string) => { const key = day(date); return key !== null && key >= from && key <= to; };

  const names = new Map<string, string>();
  for (const row of input.demand) { const key = normalize(row.name); if (key && !names.has(key)) names.set(key, row.name.trim()); }
  const count = (key: string, from: string, to: string) => input.demand.filter((row) => normalize(row.name) === key && within(row.date, from, to)).length;

  const from90 = addDays(today, -89); const from30 = addDays(today, -29); const prevTo = addDays(today, -30); const prevFrom = addDays(today, -59);
  const ranked = [...names.keys()].map((key) => ({ key, total: count(key, from90, today) })).filter((row) => row.total > 0).sort((a, b) => b.total - a.total || a.key.localeCompare(b.key));
  if (ranked[0] && ranked[0].total >= 2) signals.push({ id: `top:${ranked[0].key}`, kind: 'top_service', label: `${names.get(ranked[0].key)} is your most active service`, detail: `${ranked[0].total} bookings in the last 90 days${ranked[1] ? `, ahead of ${names.get(ranked[1].key)} (${ranked[1].total})` : ''}.`, service: names.get(ranked[0].key), asOf: today });

  for (const { key } of ranked) {
    const current = count(key, from30, today); const previous = count(key, prevFrom, prevTo);
    const service = names.get(key)!;
    if (previous >= 3 && current <= previous * 0.75) signals.push({ id: `slowing:${key}`, kind: 'slowing_service', label: `${service} bookings have slowed`, detail: `${current} in the last 30 days, compared with ${previous} in the 30 days before.`, service, asOf: today });
    else if (current >= 3 && previous > 0 && current >= previous * 1.25) signals.push({ id: `growing:${key}`, kind: 'growing_service', label: `${service} is picking up`, detail: `${current} in the last 30 days, up from ${previous} in the 30 days before.`, service, asOf: today });
  }

  const season = seasonContext(now, timezone);
  if (season.daysToNext <= 30) signals.push({ id: `season:${season.next}`, kind: 'season', label: `${season.next[0].toUpperCase()}${season.next.slice(1)} begins in ${season.daysToNext} ${season.daysToNext === 1 ? 'day' : 'days'}`, detail: `The ${season.next} season starts on ${shortDate(season.nextStarts)}. This comes from the calendar, not from your records.`, asOf: today });
  else signals.push({ id: `season:${season.current}`, kind: 'season', label: `It is ${season.current}`, detail: `The calendar puts you in the ${season.current} season. This comes from the calendar, not from your records.`, asOf: today });

  const country = countryFor(timezone); const year = Number(today.slice(0, 4));
  for (const holiday of [...holidaysFor(year, country), ...holidaysFor(year + 1, country)]) {
    const gap = daysUntil(today, holiday.date);
    if (gap >= 0 && gap <= 45) signals.push({ id: `holiday:${holiday.name}`, kind: 'holiday', label: `${holiday.name} is ${gap === 0 ? 'today' : `in ${gap} ${gap === 1 ? 'day' : 'days'}`}`, detail: `${holiday.name} falls on ${shortDate(holiday.date)}.`, asOf: today });
  }
  return signals;
}
