/**
 * Opening hours as a website scrape or a text model hands them over are often a lump of page text ("Hours Monday 9am to 5pm Tuesday ... We
 * are closed on holidays. Questions? Call ..."). Customers and Pilot need only the hours. This pulls out the day and time ranges it can
 * recognise and writes them tidily, one per line ("Mon–Fri: 9:00 AM – 5:00 PM"). If it cannot find any, a short plain line such as
 * "By appointment" is kept; anything longer is dropped, so the field is blank rather than full of raw text.
 */
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY = '(?:mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)s?';
const TIME = '\\d{1,2}(?::\\d{2})?\\s*(?:[ap]\\.?m\\.?)?';
const RANGE = '\\s*(?:-|–|—|to|through|thru|until)\\s*';

const dayIndex = (word: string) => DAYS.findIndex((day) => word.toLowerCase().startsWith(day.toLowerCase()));
const days = (from: string, to?: string) => { const a = DAYS[dayIndex(from)]; const b = to ? DAYS[dayIndex(to)] : ''; return b && b !== a ? `${a}–${b}` : a; };

function time(raw: string): string {
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(?:([ap])\.?m\.?)?$/i.exec(raw.trim());
  if (!m) return raw.trim();
  const hour = Number(m[1]); if (hour > 24) return raw.trim();
  return `${hour}:${m[2] ?? '00'}${m[3] ? ` ${m[3].toUpperCase()}M` : ''}`;
}

export function cleanHours(value: unknown): string {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  if (!text) return '';
  const found: { at: number; line: string }[] = [];
  const add = (at: number, line: string) => { if (!found.some((entry) => entry.line === line)) found.push({ at, line }); };

  const open = new RegExp(`\\b(${DAY})\\.?(?:${RANGE}(${DAY})\\.?)?\\s*[:,]?\\s*(?:open\\s*)?(${TIME})${RANGE}(${TIME})`, 'gi');
  for (const m of text.matchAll(open)) {
    const bothMeridiem = /[ap]\.?m/i.test(m[3]) || /[ap]\.?m/i.test(m[4]);
    if (!bothMeridiem && !/:/.test(m[3] + m[4]) && Number(m[4].replace(/\D/g, '')) > 12) continue; // "Mon 2 - 20" is not a time range
    add(m.index ?? 0, `${days(m[1], m[2])}: ${time(m[3])} – ${time(m[4])}`);
  }
  const closedAfter = new RegExp(`\\b(${DAY})\\.?(?:${RANGE}(${DAY})\\.?)?\\s*[:,]?\\s*closed\\b`, 'gi');
  for (const m of text.matchAll(closedAfter)) add(m.index ?? 0, `${days(m[1], m[2])}: Closed`);
  const closedBefore = new RegExp(`\\bclosed\\s+(?:on\\s+)?(${DAY})\\b`, 'gi');
  for (const m of text.matchAll(closedBefore)) add(m.index ?? 0, `${days(m[1])}: Closed`);

  if (found.length) return found.sort((a, b) => a.at - b.at).slice(0, 8).map((entry) => entry.line).join('\n');
  if (/\b(?:24\s*(?:\/\s*7|hours)|open 24)\b/i.test(text) && text.length <= 60) return 'Open 24 hours';
  return text.length <= 80 && !/[?]|\.\s+[A-Z]/.test(text) ? text : '';
}
