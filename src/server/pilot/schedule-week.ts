/**
 * Turns "this", "next" or a date such as 2026-10-21 into the week Pilot should work on.
 * `weekStartIso` is a time inside that week's Monday that the schedule routes accept
 * (they normalise it to the Monday of that week).
 */
export function resolveScheduleWeek(input: string, now: Date, timezone: string): { weekStartIso: string; label: string; mondayDate: string } | null {
  const todayParts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now); // YYYY-MM-DD
  const value = input.trim().toLowerCase();
  let reference: string;
  if (value === 'this' || value === 'this week' || value === 'current') reference = todayParts;
  else if (value === 'next' || value === 'next week') reference = addDays(todayParts, 7);
  else if (value === 'last' || value === 'last week' || value === 'previous') reference = addDays(todayParts, -7);
  else if (/^\d{4}-\d{2}-\d{2}$/.test(value)) reference = value;
  else return null;

  const base = new Date(`${reference}T12:00:00Z`);
  if (Number.isNaN(base.getTime())) return null;
  const monday = addDays(reference, -((base.getUTCDay() + 6) % 7));
  const label = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', month: 'long', day: 'numeric' }).format(new Date(`${monday}T12:00:00Z`));
  return { weekStartIso: `${monday}T12:00:00.000Z`, label: `the week of ${label}`, mondayDate: monday };
}

function addDays(date: string, days: number): string {
  const next = new Date(`${date}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}
