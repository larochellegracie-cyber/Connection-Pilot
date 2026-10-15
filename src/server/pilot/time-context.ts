export type PilotDatePeriod = 'today' | 'tomorrow' | 'yesterday' | 'this_week' | 'next_week' | 'past' | 'future' | 'upcoming' | 'overdue';

type LocalCalendarDate = { year: number; month: number; day: number };
type LocalDateTime = LocalCalendarDate & { hour: number; minute: number; weekday: number };

function localParts(date: Date, timezone: string): LocalDateTime {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || '';
  const weekdayNames: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: Number(value('year')),
    month: Number(value('month')),
    day: Number(value('day')),
    hour: Number(value('hour')),
    minute: Number(value('minute')),
    weekday: weekdayNames[value('weekday')] ?? 0,
  };
}

function addDays(date: LocalCalendarDate, days: number): LocalCalendarDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

function zonedDate(date: LocalCalendarDate, timezone: string): Date {
  const intended = Date.UTC(date.year, date.month - 1, date.day, 0, 0);
  let candidate = new Date(intended);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const actual = localParts(candidate, timezone);
    candidate = new Date(candidate.getTime() + intended - Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute));
  }
  return candidate;
}

export type PilotDateRange = {
  period: PilotDatePeriod;
  start?: Date;
  end?: Date;
  reference: Date;
  timezone: string;
};

export function pilotDateRange(period: PilotDatePeriod, timezone: string, reference = new Date()): PilotDateRange {
  const local = localParts(reference, timezone);
  const today = { year: local.year, month: local.month, day: local.day };
  const todayStart = zonedDate(today, timezone);
  const tomorrowStart = zonedDate(addDays(today, 1), timezone);
  const weekStartDate = addDays(today, -((local.weekday + 6) % 7));
  const weekStart = zonedDate(weekStartDate, timezone);
  const nextWeekStart = zonedDate(addDays(weekStartDate, 7), timezone);
  const afterNextWeekStart = zonedDate(addDays(weekStartDate, 14), timezone);

  if (period === 'today') return { period, start: todayStart, end: tomorrowStart, reference, timezone };
  if (period === 'tomorrow') return { period, start: tomorrowStart, end: zonedDate(addDays(today, 2), timezone), reference, timezone };
  if (period === 'yesterday') return { period, start: zonedDate(addDays(today, -1), timezone), end: todayStart, reference, timezone };
  if (period === 'this_week') return { period, start: weekStart, end: nextWeekStart, reference, timezone };
  if (period === 'next_week') return { period, start: nextWeekStart, end: afterNextWeekStart, reference, timezone };
  if (period === 'past') return { period, end: todayStart, reference, timezone };
  if (period === 'future') return { period, start: reference, reference, timezone };
  if (period === 'upcoming') return { period, start: todayStart, end: zonedDate(addDays(today, 14), timezone), reference, timezone };
  return { period, end: reference, reference, timezone };
}

export function pilotDateRangeSummary(range: PilotDateRange) {
  return {
    timezone: range.timezone,
    start: range.start?.toISOString() ?? null,
    end: range.end?.toISOString() ?? null,
    reference: range.reference.toISOString(),
  };
}
