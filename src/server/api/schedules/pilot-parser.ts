export type PilotEmployee = { id: string; name: string; status: string };
export type ParsedTime = { hour: number; minute: number };
export type PilotParseContext = { weekStart: Date; timezone: string };
export type PilotCommand =
  | { type: 'add'; employeeId: string; employeeName: string; days: number[]; start: ParsedTime; end: ParsedTime }
  | { type: 'off'; employeeId: string; employeeName: string; days: number[] }
  | { type: 'move'; employeeId: string; employeeName: string; fromDay: number; toDay: number }
  | { type: 'repeat'; employeeId: string; employeeName: string }
  /** "make this week like last week": start from the previous calendar week's shifts. */
  | { type: 'copy_previous' }
  /** "add Avery on every day she's not working, 8am-5pm": a shift on each day the employee has none. */
  | { type: 'fill'; employeeId: string; employeeName: string; start: ParsedTime; end: ParsedTime };

const dayNames: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
  sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, weds: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6,
};
const dayPattern = Object.keys(dayNames).sort((a, b) => b.length - a.length).join('|');
// Joins two days into a range: "Tuesday-Friday", "Tue – Fri", "Monday to Wednesday", "Mon through Thu".
const rangeJoiner = '(?:-|–|—|to|through|thru|until|till)';
const dayRange = `\\b(?:${dayPattern})\\b(?:\\s*${rangeJoiner}\\s*\\b(?:${dayPattern})\\b)?`;
// "Tuesday, Thursday and Friday", "Mon Wed Fri", "Tuesday-Friday"
const dayList = `${dayRange}(?:\\s*(?:,|and|&)?\\s*${dayRange})*`;
// The two halves of a time range such as "8-5", "8am to 5pm" or "08:00-17:00".
const timeRangePattern = () => /\b(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*(?:-|–|—|to|until|till)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/gi;
const copyPreviousPattern = /\b(?:like|same\s+as|copy|duplicate|based\s+on|match(?:ing)?)\s+(?:the\s+)?(?:previous|last)\s+week(?:['’]s)?(?:\s+schedule)?\b/i;
const fillPattern = /\b(?:not|isn[’']t|wasn[’']t|aren[’']t)\s+(?:currently\s+|already\s+)?(?:working|scheduled|on)\b|\b(?:other|remaining|rest\s+of\s+the)\s+days\b/i;
const monthNames: Record<string, number> = { january: 0, february: 1, march: 2, april: 3, may: 4, june: 5, july: 6, august: 7, september: 8, october: 9, november: 10, december: 11 };
const monthPattern = Object.keys(monthNames).join('|');

function escape(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

type ClockReading = { hour: number; minute: number; suffix?: 'am' | 'pm' };
function readClock(value: string): ClockReading | null {
  const match = value.trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  return match ? { hour: Number(match[1]), minute: Number(match[2] || '0'), suffix: match[3] as 'am' | 'pm' | undefined } : null;
}
const to24 = (hour12: number, suffix: 'am' | 'pm') => (hour12 % 12) + (suffix === 'pm' ? 12 : 0);
const otherSuffix = (suffix: 'am' | 'pm') => (suffix === 'am' ? 'pm' : 'am');

/**
 * Reads the two halves of a time range as a start and end time. Handles "8am-5pm",
 * "8-5pm", "8am-5", a plain "8-5" (read as a working day, 8 AM to 5 PM) and 24-hour
 * times such as "08:00-17:00".
 */
function interpretTimes(startText: string, endText: string): { start: ParsedTime; end: ParsedTime } | null {
  const first = readClock(startText); const second = readClock(endText);
  if (!first || !second || first.minute > 59 || second.minute > 59) return null;
  if (!first.suffix && !second.suffix && (first.hour > 12 || second.hour > 12 || first.hour === 0 || second.hour === 0)) {
    if (first.hour > 23 || second.hour > 23) return null;
    return { start: { hour: first.hour, minute: first.minute }, end: { hour: second.hour, minute: second.minute } };
  }
  if (first.hour < 1 || first.hour > 12 || second.hour < 1 || second.hour > 12) return null;
  const minutes = (reading: ClockReading, suffix: 'am' | 'pm') => to24(reading.hour, suffix) * 60 + reading.minute;

  let startSuffix = first.suffix; let endSuffix = second.suffix;
  if (!startSuffix && endSuffix) startSuffix = minutes(first, endSuffix) < minutes(second, endSuffix) ? endSuffix : otherSuffix(endSuffix);
  if (!startSuffix) startSuffix = first.hour === 12 || first.hour <= 5 ? 'pm' : 'am'; // 6-11 is morning; 12 and 1-5 are afternoon
  if (!endSuffix) endSuffix = minutes(second, startSuffix) > minutes(first, startSuffix) ? startSuffix : otherSuffix(startSuffix);
  return {
    start: { hour: to24(first.hour, startSuffix), minute: first.minute },
    end: { hour: to24(second.hour, endSuffix), minute: second.minute },
  };
}

const weekIndex = (day: number) => (day + 6) % 7; // Monday = 0 … Sunday = 6
const dayFromWeekIndex = (index: number) => (index + 1) % 7;

/** Every weekday named in the text, expanding ranges such as "Tuesday-Friday" and "Mon to Wed". */
function daysFrom(text: string): number[] {
  const found: number[] = [];
  const add = (day: number) => { if (!found.includes(day)) found.push(day); };
  const token = new RegExp(`\\b(${dayPattern})\\b(?:\\s*${rangeJoiner}\\s*\\b(${dayPattern})\\b)?`, 'g');
  for (const match of text.toLowerCase().matchAll(token)) {
    if (!match[2]) { add(dayNames[match[1]]); continue; }
    const from = weekIndex(dayNames[match[1]]); const to = weekIndex(dayNames[match[2]]);
    if (to < from) return []; // a range must run forward within the week
    for (let index = from; index <= to; index += 1) add(dayFromWeekIndex(index));
  }
  return found;
}

/**
 * The days a time range applies to: days written before it ("Tuesday-Friday 8-5"),
 * otherwise days written after it ("8-5 Tuesday-Friday"). `boundary` stops one
 * time range from claiming days that belong to the previous one.
 */
function daysForTime(text: string, boundary: number, start: number, end: number, nextStart: number) {
  const before = daysFrom(text.slice(boundary, start));
  if (before.length) return { days: before, boundary: end };
  const afterText = text.slice(end, nextStart);
  const lastDay = [...afterText.toLowerCase().matchAll(new RegExp(`\\b(?:${dayPattern})\\b`, 'g'))].at(-1);
  return { days: daysFrom(afterText), boundary: lastDay ? end + (lastDay.index ?? 0) + lastDay[0].length : end };
}

function localWeekDates(weekStart: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(weekStart);
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value || '0');
  const mondayUtc = Date.UTC(get('year'), get('month') - 1, get('day'));
  return Array.from({ length: 7 }, (_, index) => new Date(mondayUtc + index * 86400000));
}

function validateExplicitDates(text: string, context: PilotParseContext) {
  const targetDates = localWeekDates(context.weekStart, context.timezone);
  const selectedYear = targetDates[0].getUTCFullYear();
  const dates: { weekday: number; date: Date }[] = [];
  const numeric = new RegExp(`\\b(${dayPattern})\\b(?:\\s+(?:the\\s+)?)?(\\d{1,2})(?:st|nd|rd|th)\\b`, 'gi');
  for (const match of text.matchAll(numeric)) {
    const weekday = dayNames[match[1].toLowerCase()];
    const matchingWeekday = targetDates.find((date) => date.getUTCDay() === weekday);
    const month = matchingWeekday ? matchingWeekday.getUTCMonth() : targetDates[0].getUTCMonth();
    dates.push({ weekday, date: new Date(Date.UTC(selectedYear, month, Number(match[2]))) });
  }
  const named = new RegExp(`\\b(${dayPattern})\\b\\s*,?\\s*(${monthPattern})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?`, 'gi');
  for (const match of text.matchAll(named)) dates.push({ weekday: dayNames[match[1].toLowerCase()], date: new Date(Date.UTC(Number(match[4] || selectedYear), monthNames[match[2].toLowerCase()], Number(match[3]))) });
  for (const supplied of dates) {
    if (supplied.date.getUTCMonth() < 0 || supplied.date.getUTCDate() === 0 || supplied.date.getUTCDay() !== supplied.weekday) return `The calendar date does not match the requested weekday. Please check the day and date.`;
    if (!targetDates.some((date) => date.getTime() === supplied.date.getTime())) return `That calendar date is outside the selected schedule week. Choose a date within this week or select the correct week first.`;
  }
  return null;
}

function employeeAliases(employee: PilotEmployee) { return [employee.name, ...employee.name.split(/\s+/).filter((part) => part.length > 2)]; }
/** The one active employee the text names; the longest matching name wins ("Avery Park" over "Avery"). */
function employeeFor(text: string, employees: PilotEmployee[]) {
  const scored = employees.filter((employee) => employee.status === 'active').map((employee) => ({
    employee,
    score: Math.max(0, ...employeeAliases(employee).filter((alias) => new RegExp(`\\b${escape(alias)}\\b`, 'i').test(text)).map((alias) => alias.length)),
  })).filter((item) => item.score > 0);
  if (!scored.length) return null;
  const best = Math.max(...scored.map((item) => item.score));
  const top = scored.filter((item) => item.score === best);
  return top.length === 1 ? top[0].employee : null;
}
function employeeWindows(instruction: string, employees: PilotEmployee[]) {
  const names = employees.filter((employee) => employee.status === 'active').flatMap(employeeAliases).map(escape).sort((a, b) => b.length - a.length);
  if (!names.length) return [];
  const matches = [...instruction.matchAll(new RegExp(`\\b(?:${names.join('|')})\\b`, 'gi'))];
  return matches.map((match, index) => ({ name: match[0], text: instruction.slice(match.index, matches[index + 1]?.index), employee: employeeFor(match[0], employees) }));
}

export function parsePilotInstruction(instruction: string, employees: PilotEmployee[], context: PilotParseContext): { commands?: PilotCommand[]; clarification?: string } {
  const normalized = instruction.replace(/[.?!]+$/g, '').trim();
  const explicitDateError = validateExplicitDates(normalized, context);
  if (explicitDateError) return { clarification: explicitDateError };
  const move = normalized.match(new RegExp(`\\bmove\\s+(.+?)(?:'s|’s)?\\s+(${dayPattern})\\s+shift\\s+to\\s+(${dayPattern})\\b`, 'i'));
  if (move) {
    const employee = employeeFor(move[1].replace(/(?:'s|’s)$/i, '').trim(), employees);
    return employee ? { commands: [{ type: 'move', employeeId: employee.id, employeeName: employee.name, fromDay: dayNames[move[2].toLowerCase()], toDay: dayNames[move[3].toLowerCase()] }] } : { clarification: `I couldn’t identify one active employee in “${move[1]}”. Please use their full name.` };
  }

  // "like last week" always comes first, so the changes that follow are applied on top of the copy.
  const commands: PilotCommand[] = copyPreviousPattern.test(normalized) ? [{ type: 'copy_previous' }] : [];
  const windows = employeeWindows(normalized, employees);
  const unclear = windows.find((window) => !window.employee);
  if (unclear) return { clarification: `More than one employee matches “${unclear.name}”. Please use their full name.` };
  for (const window of windows) {
    const employee = window.employee as PilotEmployee;
    // "every day she's not working" is a request to fill the gaps, not to repeat one shift seven days a week.
    if (fillPattern.test(window.text)) {
      const found = [...window.text.matchAll(timeRangePattern())][0] ?? [...normalized.matchAll(timeRangePattern())][0];
      const times = found ? interpretTimes(found[1], found[2]) : null;
      if (!times) return { clarification: `What hours should ${employee.name} work on the days they aren’t scheduled? For example, 8am-5pm.` };
      if (times.end.hour * 60 + times.end.minute <= times.start.hour * 60 + times.start.minute) return { clarification: `The end time for ${employee.name} must be after the start time. Please clarify that shift.` };
      commands.push({ type: 'fill', employeeId: employee.id, employeeName: employee.name, start: times.start, end: times.end });
      continue;
    }
    if (/\b(?:same\s+shift\s+(?:every|each)\s+day|every\s+day|each\s+day|daily|all\s+week)\b/i.test(window.text)) { commands.push({ type: 'repeat', employeeId: employee.id, employeeName: employee.name }); continue; }
    // "Friday off", "Avery off Friday", "off Tuesday and Thursday", "off Mon-Wed"
    const offMatch = window.text.match(new RegExp(`(${dayList})\\s+off\\b`, 'i')) ?? window.text.match(new RegExp(`\\boff\\s+(?:on\\s+)?(${dayList})`, 'i'));
    const offDays = offMatch ? daysFrom(offMatch[1]) : [];
    if (offDays.length) { commands.push({ type: 'off', employeeId: employee.id, employeeName: employee.name, days: offDays }); continue; }
    const timeMatches = [...window.text.matchAll(timeRangePattern())];
    let boundary = 0;
    for (let index = 0; index < timeMatches.length; index += 1) {
      const match = timeMatches[index];
      const times = interpretTimes(match[1], match[2]);
      const matchStart = match.index || 0;
      const found = daysForTime(window.text, boundary, matchStart, matchStart + match[0].length, timeMatches[index + 1]?.index ?? window.text.length);
      boundary = found.boundary;
      if (!times || !found.days.length) return { clarification: `I found a time for ${employee.name}, but I need a valid day (for example, Monday, Monday through Friday, or Tue-Fri).` };
      if (times.end.hour * 60 + times.end.minute <= times.start.hour * 60 + times.start.minute) return { clarification: `The end time for ${employee.name} must be after the start time. Please clarify that shift.` };
      commands.push({ type: 'add', employeeId: employee.id, employeeName: employee.name, days: found.days, start: times.start, end: times.end });
    }
  }
  return commands.length ? { commands } : { clarification: 'I need an employee name, a day, and a time range. For example: “Gracie working 8–10pm Monday.”' };
}
