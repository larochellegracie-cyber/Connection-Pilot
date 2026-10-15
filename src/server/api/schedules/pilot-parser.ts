export type PilotEmployee = { id: string; name: string; status: string };
export type ParsedTime = { hour: number; minute: number };
export type PilotParseContext = { weekStart: Date; timezone: string };
export type PilotCommand =
  | { type: 'add'; employeeId: string; employeeName: string; days: number[]; start: ParsedTime; end: ParsedTime }
  | { type: 'off'; employeeId: string; employeeName: string; days: number[] }
  | { type: 'move'; employeeId: string; employeeName: string; fromDay: number; toDay: number }
  | { type: 'repeat'; employeeId: string; employeeName: string };

const dayNames: Record<string, number> = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
const dayPattern = Object.keys(dayNames).join('|');
const monthNames: Record<string, number> = { january: 0, february: 1, march: 2, april: 3, may: 4, june: 5, july: 6, august: 7, september: 8, october: 9, november: 10, december: 11 };
const monthPattern = Object.keys(monthNames).join('|');

function escape(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function parseTime(value: string): ParsedTime | null {
  const match = value.trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/);
  if (!match) return null;
  const rawHour = Number(match[1]); const minute = Number(match[2] || '0'); const suffix = match[3];
  if (rawHour < 1 || rawHour > 12 || minute > 59) return null;
  return { hour: (rawHour % 12) + (suffix === 'pm' ? 12 : 0), minute };
}

function weekdayMatches(text: string) {
  return [...text.toLowerCase().matchAll(new RegExp(`\\b(${dayPattern})\\b`, 'g'))].map((match) => ({ day: dayNames[match[1]], index: match.index || 0 }));
}

function daysFrom(text: string): number[] {
  const normalized = text.toLowerCase();
  const range = normalized.match(new RegExp(`\\b(${dayPattern})\\s+(?:through|to|-)\\s+(${dayPattern})\\b`));
  if (range) {
    const start = dayNames[range[1]]; const end = dayNames[range[2]];
    if (end < start) return [];
    return Array.from({ length: end - start + 1 }, (_, index) => start + index);
  }
  return weekdayMatches(normalized).map((item) => item.day).filter((day, index, all) => all.indexOf(day) === index);
}

function daysForTime(text: string, startIndex: number, endIndex: number) {
  const nearbyAfter = daysFrom(text.slice(endIndex, text.indexOf('\n', endIndex) === -1 ? text.length : text.indexOf('\n', endIndex)));
  if (nearbyAfter.length) return nearbyAfter;
  const before = text.slice(0, startIndex);
  const lastDay = weekdayMatches(before).at(-1);
  if (!lastDay) return [];
  const nearbyBefore = before.slice(lastDay.index);
  const rangeDays = daysFrom(nearbyBefore);
  return rangeDays.length ? rangeDays : [lastDay.day];
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
function employeeFor(text: string, employees: PilotEmployee[]) {
  const matching = employees.filter((employee) => employee.status === 'active' && employeeAliases(employee).some((alias) => new RegExp(`\\b${escape(alias)}\\b`, 'i').test(text)));
  return matching.length === 1 ? matching[0] : null;
}
function employeeWindows(instruction: string, employees: PilotEmployee[]) {
  const names = employees.filter((employee) => employee.status === 'active').flatMap(employeeAliases).map(escape).sort((a, b) => b.length - a.length);
  if (!names.length) return [];
  const matches = [...instruction.matchAll(new RegExp(`\\b(?:${names.join('|')})\\b`, 'gi'))];
  return matches.map((match, index) => ({ text: instruction.slice(match.index, matches[index + 1]?.index), employee: employeeFor(match[0], employees) })).filter((item): item is { text: string; employee: PilotEmployee } => Boolean(item.employee));
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

  const commands: PilotCommand[] = [];
  for (const window of employeeWindows(normalized, employees)) {
    if (/\b(?:same\s+shift\s+(?:every|each)\s+day|every\s+day|each\s+day|daily|all\s+week)\b/i.test(window.text)) { commands.push({ type: 'repeat', employeeId: window.employee.id, employeeName: window.employee.name }); continue; }
    const offMatch = window.text.match(new RegExp(`\\b(${dayPattern})\\s+off\\b`, 'i'));
    if (offMatch) { commands.push({ type: 'off', employeeId: window.employee.id, employeeName: window.employee.name, days: [dayNames[offMatch[1].toLowerCase()]] }); continue; }
    const timeMatches = [...window.text.matchAll(/\b(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*(?:-|–|to)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/gi)];
    for (let index = 0; index < timeMatches.length; index += 1) {
      const match = timeMatches[index];
      const startSuffix = match[1].match(/(am|pm)\s*$/i)?.[1] || '';
      const endSuffix = match[2].match(/(am|pm)\s*$/i)?.[1] || '';
      const inferredSuffix = startSuffix || endSuffix || 'am';
      const start = parseTime(startSuffix ? match[1] : `${match[1]}${inferredSuffix}`);
      const end = parseTime(endSuffix ? match[2] : `${match[2]}${inferredSuffix}`);
      const startIndex = match.index || 0; const nextTimeIndex = timeMatches[index + 1]?.index ?? window.text.length;
      const days = daysForTime(window.text.slice(0, nextTimeIndex), startIndex, startIndex + match[0].length);
      if (!start || !end || !days.length) return { clarification: `I found a time for ${window.employee.name}, but I need a valid day (for example, Monday or Monday through Friday).` };
      if (end.hour * 60 + end.minute <= start.hour * 60 + start.minute) return { clarification: `The end time for ${window.employee.name} must be after the start time. Please clarify that shift.` };
      commands.push({ type: 'add', employeeId: window.employee.id, employeeName: window.employee.name, days, start, end });
    }
  }
  return commands.length ? { commands } : { clarification: 'I need an employee name, a day, and a time range. For example: “Gracie working 8–10pm Monday.”' };
}
