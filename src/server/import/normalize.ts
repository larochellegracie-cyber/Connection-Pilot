/** Small, forgiving readers for spreadsheet values. They return null instead of guessing. */

export function clean(value: unknown, limit = 255): string { return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit); }

export function headerKey(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]+/g, ''); }

export function parseMoney(value: string): number | null {
  const text = value.trim();
  if (!text) return null;
  const negative = /^\(.*\)$/.test(text) || /^-/.test(text);
  const digits = text.replace(/[^0-9.,]/g, '');
  if (!digits || !/[0-9]/.test(digits)) return null;
  const parsed = Number(digits.replace(/,/g, ''));
  if (!Number.isFinite(parsed)) return null;
  return negative ? -parsed : parsed;
}

export function normalizePhoneNumber(value: string): string {
  const cleaned = value.replace(/[^0-9+]/g, '');
  return cleaned.length >= 7 ? cleaned : '';
}

export function digitsOnly(value: string): string { return value.replace(/\D/g, ''); }

export function validEmail(value: string): string | null {
  const email = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 255 ? email : null;
}

const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** Reads ISO dates, "1/5/2024" (month first unless the first number can only be a day), and "Jan 5, 2024". Returns local noon for date-only values. */
export function parseDate(value: string): Date | null {
  const text = value.trim();
  if (!text) return null;
  const time = text.match(/(?:T|\s)(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?\s*$/i);
  let hour = 12; let minute = 0;
  if (time) { hour = Number(time[1]); minute = Number(time[2]); if (time[3]) { const pm = time[3].toLowerCase() === 'pm'; if (pm && hour < 12) hour += 12; if (!pm && hour === 12) hour = 0; } }
  const datePart = time ? text.slice(0, time.index).trim() : text;
  let year: number; let month: number; let day: number;
  let match = datePart.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (match) { year = Number(match[1]); month = Number(match[2]); day = Number(match[3]); }
  else if ((match = datePart.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/))) {
    const first = Number(match[1]); const second = Number(match[2]);
    year = Number(match[3]); if (year < 100) year += 2000;
    if (first > 12) { day = first; month = second; } else { month = first; day = second; }
  } else if ((match = datePart.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/))) {
    month = months.indexOf(match[1].slice(0, 3).toLowerCase()) + 1; day = Number(match[2]); year = Number(match[3]);
  } else if ((match = datePart.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})$/))) {
    day = Number(match[1]); month = months.indexOf(match[2].slice(0, 3).toLowerCase()) + 1; year = Number(match[3]);
  } else return null;
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || year < 1990 || year > 2100) return null;
  const date = new Date(year, month - 1, day, hour, minute);
  return date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

export function splitName(first: string, last: string): string { return clean(`${first} ${last}`); }
