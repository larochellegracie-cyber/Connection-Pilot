import type { Request, Response } from 'express';
import { and, eq, gte, lt } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '@/server/db/client.js';
import { employee, employeeAvailability, employeeShift, employeeTimeOffRequest, weeklySchedule } from '@/server/db/schema.js';
import { requirePlanFeature } from '@/server/plan-access.js';
import { getCalendarSettings } from '../../calendar/shared.js';
import { getTenant, textValue } from '../../customers/tenant.js';
import { findSchedule, parseWeekStart } from '../drafts.js';
import { parsePilotInstruction, type PilotCommand, type PilotEmployee } from '../pilot-parser.js';

type ShiftSeed = { employeeId: string; startsAt: Date; endsAt: Date; location: string | null; notes: string | null };
type ExistingShift = { id: string; employeeId: string; startsAt: Date; endsAt: Date; location: string | null; notes: string | null };

function localParts(date: Date, timezone: string) {
  const pieces = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => pieces.find((piece) => piece.type === type)?.value || '';
  const weekdays: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { year: Number(get('year')), month: Number(get('month')), day: Number(get('day')), weekday: weekdays[get('weekday')], hour: Number(get('hour')), minute: Number(get('minute')) };
}

function zonedDate(year: number, month: number, day: number, hour: number, minute: number, timezone: string) {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute);
  let candidate = new Date(utcGuess);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const actual = localParts(candidate, timezone);
    const actualUtc = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute);
    candidate = new Date(candidate.getTime() + (utcGuess - actualUtc));
  }
  return candidate;
}

function dateForDay(weekStart: Date, dayOfWeek: number, timezone: string) {
  const monday = localParts(weekStart, timezone);
  const baseUtc = Date.UTC(monday.year, monday.month - 1, monday.day);
  const targetUtc = new Date(baseUtc + (dayOfWeek === 0 ? 6 : dayOfWeek - 1) * 86400000);
  return { year: targetUtc.getUTCFullYear(), month: targetUtc.getUTCMonth() + 1, day: targetUtc.getUTCDate() };
}

function seedFor(command: Extract<PilotCommand, { type: 'add' }>, day: number, weekStart: Date, timezone: string): ShiftSeed {
  const date = dateForDay(weekStart, day, timezone);
  return { employeeId: command.employeeId, startsAt: zonedDate(date.year, date.month, date.day, command.start.hour, command.start.minute, timezone), endsAt: zonedDate(date.year, date.month, date.day, command.end.hour, command.end.minute, timezone), location: null, notes: null };
}

function availabilityAllows(seed: ShiftSeed, availability: { employeeId: string; dayOfWeek: number; startTime: string; endTime: string; isAvailable: boolean }[], timezone: string) {
  const local = localParts(seed.startsAt, timezone);
  const recorded = availability.filter((slot) => slot.employeeId === seed.employeeId && slot.dayOfWeek === local.weekday);
  if (!recorded.length) return true;
  const start = `${String(local.hour).padStart(2, '0')}:${String(local.minute).padStart(2, '0')}`;
  const localEnd = localParts(seed.endsAt, timezone);
  const end = `${String(localEnd.hour).padStart(2, '0')}:${String(localEnd.minute).padStart(2, '0')}`;
  return recorded.some((slot) => slot.isAvailable && slot.startTime <= start && slot.endTime >= end);
}

function overlaps(left: { startsAt: Date; endsAt: Date }, right: { startsAt: Date; endsAt: Date }) { return left.startsAt < right.endsAt && left.endsAt > right.startsAt; }
function clarification(res: Response, message: string) { return res.status(400).json({ error: message, clarification: true }); }

function repeatSeeds(command: Extract<PilotCommand, { type: 'repeat' }>, sourceShifts: ExistingShift[], targetWeek: Date, timezone: string): { seeds?: ShiftSeed[]; error?: string } {
  const employeeShifts = sourceShifts.filter((shift) => shift.employeeId === command.employeeId);
  if (!employeeShifts.length) return { error: `${command.employeeName} has no shift in the previous week to repeat. Add a shift first, or tell me the days and times you want.` };
  const patterns = new Set(employeeShifts.map((shift) => {
    const start = localParts(shift.startsAt, timezone); const end = localParts(shift.endsAt, timezone);
    return `${start.hour}:${start.minute}-${end.hour}:${end.minute}-${shift.location || ''}-${shift.notes || ''}`;
  }));
  if (patterns.size !== 1) return { error: `${command.employeeName} has more than one kind of shift last week. Tell me which time range to repeat.` };
  const baseline = employeeShifts[0]; const start = localParts(baseline.startsAt, timezone); const end = localParts(baseline.endsAt, timezone);
  return { seeds: Array.from({ length: 7 }, (_, index) => {
    const date = dateForDay(targetWeek, index === 6 ? 0 : index + 1, timezone);
    return { employeeId: command.employeeId, startsAt: zonedDate(date.year, date.month, date.day, start.hour, start.minute, timezone), endsAt: zonedDate(date.year, date.month, date.day, end.hour, end.minute, timezone), location: baseline.location, notes: baseline.notes };
  }) };
}

export default async function handler(req: Request, res: Response) {
  try {
    const tenant = await getTenant(req, res); if (!tenant) return;
    const access = await requirePlanFeature(tenant.id, 'scheduling');
    if (!access.allowed) return void res.status(403).json({ error: access.error, upgradeRequired: true });
    const instruction = textValue(req.body.instruction, 1000); const targetWeek = parseWeekStart(req.body.weekStart);
    if (!instruction || !targetWeek) return void clarification(res, 'Describe the schedule change and choose a target week.');

    const [settings, members] = await Promise.all([
      getCalendarSettings(tenant.id),
      db.select({ id: employee.id, name: employee.name, status: employee.status }).from(employee).where(eq(employee.businessProfileId, tenant.id)),
    ]);
    const parsed = parsePilotInstruction(instruction, members as PilotEmployee[], { weekStart: targetWeek, timezone: settings.timezone });
    if (parsed.clarification || !parsed.commands) return void clarification(res, parsed.clarification || 'Please clarify the schedule change.');
    const weekEnd = new Date(targetWeek.getTime() + 7 * 86400000);
    const [targetSchedule, sourceSchedule, availability, timeOff] = await Promise.all([
      findSchedule(tenant.id, targetWeek),
      findSchedule(tenant.id, new Date(targetWeek.getTime() - 7 * 86400000)),
      db.select({ employeeId: employeeAvailability.employeeId, dayOfWeek: employeeAvailability.dayOfWeek, startTime: employeeAvailability.startTime, endTime: employeeAvailability.endTime, isAvailable: employeeAvailability.isAvailable }).from(employeeAvailability).where(eq(employeeAvailability.businessProfileId, tenant.id)),
      db.select({ employeeId: employeeTimeOffRequest.employeeId, startsAt: employeeTimeOffRequest.startsAt, endsAt: employeeTimeOffRequest.endsAt }).from(employeeTimeOffRequest).where(and(eq(employeeTimeOffRequest.businessProfileId, tenant.id), eq(employeeTimeOffRequest.status, 'approved'))),
    ]);
    if (targetSchedule?.status === 'published') return void res.status(409).json({ error: 'The selected week is already published. Choose another week so Pilot can prepare an editable draft.' });
    const [targetShifts, sourceShifts] = await Promise.all([
      targetSchedule ? db.select({ id: employeeShift.id, employeeId: employeeShift.employeeId, startsAt: employeeShift.startsAt, endsAt: employeeShift.endsAt, location: employeeShift.location, notes: employeeShift.notes }).from(employeeShift).where(and(eq(employeeShift.businessProfileId, tenant.id), eq(employeeShift.weeklyScheduleId, targetSchedule.id))) : Promise.resolve([] as ExistingShift[]),
      sourceSchedule ? db.select({ id: employeeShift.id, employeeId: employeeShift.employeeId, startsAt: employeeShift.startsAt, endsAt: employeeShift.endsAt, location: employeeShift.location, notes: employeeShift.notes }).from(employeeShift).where(and(eq(employeeShift.businessProfileId, tenant.id), eq(employeeShift.weeklyScheduleId, sourceSchedule.id))) : Promise.resolve([] as ExistingShift[]),
    ]);

    const additions: ShiftSeed[] = []; const deleteIds = new Set<string>(); const updateMoves: { id: string; startsAt: Date; endsAt: Date }[] = [];
    for (const command of parsed.commands) {
      if (command.type === 'add') additions.push(...command.days.map((day) => seedFor(command, day, targetWeek, settings.timezone)));
      if (command.type === 'repeat') {
        const repeated = repeatSeeds(command, sourceShifts, targetWeek, settings.timezone);
        if (repeated.error || !repeated.seeds) return void clarification(res, repeated.error || 'Please clarify the repeat pattern.');
        additions.push(...repeated.seeds);
      }
      if (command.type === 'off') {
        const matching = targetShifts.filter((shift) => shift.employeeId === command.employeeId && command.days.includes(localParts(shift.startsAt, settings.timezone).weekday));
        if (!matching.length) return void clarification(res, `${command.employeeName} has no scheduled shift on the requested day in this draft.`);
        matching.forEach((shift) => deleteIds.add(shift.id));
      }
      if (command.type === 'move') {
        const matching = targetShifts.filter((shift) => shift.employeeId === command.employeeId && localParts(shift.startsAt, settings.timezone).weekday === command.fromDay);
        if (matching.length !== 1) return void clarification(res, matching.length ? `${command.employeeName} has more than one shift on that day. Tell me which time range to move.` : `${command.employeeName} has no shift on that day in the selected draft to move.`);
        const shift = matching[0]; const start = localParts(shift.startsAt, settings.timezone); const end = localParts(shift.endsAt, settings.timezone); const destination = dateForDay(targetWeek, command.toDay, settings.timezone);
        updateMoves.push({ id: shift.id, startsAt: zonedDate(destination.year, destination.month, destination.day, start.hour, start.minute, settings.timezone), endsAt: zonedDate(destination.year, destination.month, destination.day, end.hour, end.minute, settings.timezone) });
      }
    }

    const allExisting = await db.select({ id: employeeShift.id, employeeId: employeeShift.employeeId, startsAt: employeeShift.startsAt, endsAt: employeeShift.endsAt }).from(employeeShift).where(and(eq(employeeShift.businessProfileId, tenant.id), lt(employeeShift.startsAt, weekEnd), gte(employeeShift.endsAt, targetWeek)));
    const ignoreIds = new Set([...deleteIds, ...updateMoves.map((move) => move.id)]);
    const proposed = [...additions, ...updateMoves.map((move) => ({ ...move, employeeId: targetShifts.find((shift) => shift.id === move.id)?.employeeId || '', location: null, notes: null }))];
    for (const shift of proposed) {
      if (!availabilityAllows(shift, availability, settings.timezone)) {
        const member = members.find((item) => item.id === shift.employeeId);
        return void clarification(res, `Recorded availability does not cover ${member?.name || 'this employee'}’s requested shift. Update availability or choose another time.`);
      }
      if (timeOff.some((request) => request.employeeId === shift.employeeId && overlaps(shift, request))) return void clarification(res, 'This shift overlaps approved time off. Choose another day or time.');
      if (allExisting.some((existing) => existing.employeeId === shift.employeeId && !ignoreIds.has(existing.id) && overlaps(shift, existing))) return void res.status(409).json({ error: 'One or more requested shifts overlap an existing shift. Adjust the draft or give Pilot a different time.' });
    }
    for (let index = 0; index < proposed.length; index += 1) for (let next = index + 1; next < proposed.length; next += 1) if (proposed[index].employeeId === proposed[next].employeeId && overlaps(proposed[index], proposed[next])) return void clarification(res, 'Two requested changes overlap for the same employee. Please clarify the times.');

    if (!targetSchedule && !additions.length) return void clarification(res, 'There is no draft schedule for that week to change. Ask Pilot to add a shift first.');
    const scheduleId = targetSchedule?.id ?? randomUUID();
    await db.transaction(async (tx) => {
      if (!targetSchedule) await tx.insert(weeklySchedule).values({ id: scheduleId, businessProfileId: tenant.id, weekStartsAt: targetWeek, status: 'draft' });
      for (const id of deleteIds) await tx.delete(employeeShift).where(and(eq(employeeShift.businessProfileId, tenant.id), eq(employeeShift.weeklyScheduleId, scheduleId), eq(employeeShift.id, id)));
      for (const move of updateMoves) await tx.update(employeeShift).set({ startsAt: move.startsAt, endsAt: move.endsAt }).where(and(eq(employeeShift.id, move.id), eq(employeeShift.businessProfileId, tenant.id), eq(employeeShift.weeklyScheduleId, scheduleId)));
      if (additions.length) await tx.insert(employeeShift).values(additions.map((shift) => ({ id: randomUUID(), businessProfileId: tenant.id, weeklyScheduleId: scheduleId, ...shift })));
    });
    res.status(201).json({ scheduleId, created: additions.length, moved: updateMoves.length, removed: deleteIds.size, status: 'draft' });
  } catch (error) {
    console.error('schedule_pilot_draft.failed', error instanceof Error ? { name: error.name, message: error.message } : { type: typeof error });
    res.status(500).json({ error: 'Pilot could not save that draft. No schedule was published.' });
  }
}
