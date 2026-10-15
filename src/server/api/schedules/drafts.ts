import { and, eq, gte, lt } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '@/server/db/client.js';
import { employeeShift, weeklySchedule } from '@/server/db/schema.js';

export type ShiftSeed = { employeeId: string; startsAt: Date; endsAt: Date; location: string | null; notes: string | null };

export function weekStart(value: Date) {
  const result = new Date(value);
  result.setHours(0, 0, 0, 0);
  result.setDate(result.getDate() - ((result.getDay() + 6) % 7));
  return result;
}

export function parseWeekStart(value: unknown) {
  if (typeof value !== 'string') return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : weekStart(parsed);
}

export async function findSchedule(businessProfileId: string, startsAt: Date) {
  const endsAt = new Date(startsAt);
  endsAt.setDate(endsAt.getDate() + 7);
  const rows = await db.select().from(weeklySchedule).where(and(eq(weeklySchedule.businessProfileId, businessProfileId), gte(weeklySchedule.weekStartsAt, startsAt), lt(weeklySchedule.weekStartsAt, endsAt))).limit(1);
  return rows[0] ?? null;
}

function destinationShift(seed: ShiftSeed, businessProfileId: string, weeklyScheduleId: string) {
  const { id: sourceId, businessProfileId: sourceBusinessProfileId, weeklyScheduleId: sourceWeeklyScheduleId, ...shift } = seed as ShiftSeed & { id?: string; businessProfileId?: string; weeklyScheduleId?: string };
  void sourceId;
  void sourceBusinessProfileId;
  void sourceWeeklyScheduleId;
  return { ...shift, id: randomUUID(), businessProfileId, weeklyScheduleId };
}

export async function createDraftFromSeeds(businessProfileId: string, startsAt: Date, seeds: ShiftSeed[]) {
  const existing = await findSchedule(businessProfileId, startsAt);
  if (existing) {
    const existingShifts = await db.select({ id: employeeShift.id }).from(employeeShift).where(and(eq(employeeShift.businessProfileId, businessProfileId), eq(employeeShift.weeklyScheduleId, existing.id))).limit(1);
    if (existing.status === 'published' || existingShifts.length) throw new Error('Choose a week without an existing schedule before creating a new draft.');
    if (seeds.length) await db.insert(employeeShift).values(seeds.map((shift) => destinationShift(shift, businessProfileId, existing.id)));
    return existing.id;
  }
  const scheduleId = randomUUID();
  await db.transaction(async (tx) => {
    await tx.insert(weeklySchedule).values({ id: scheduleId, businessProfileId, weekStartsAt: startsAt, status: 'draft' });
    if (seeds.length) await tx.insert(employeeShift).values(seeds.map((shift) => destinationShift(shift, businessProfileId, scheduleId)));
  });
  return scheduleId;
}

export function shiftWeek(shift: ShiftSeed, weekDifference: number): ShiftSeed {
  const offset = weekDifference * 7 * 24 * 60 * 60 * 1000;
  return { ...shift, startsAt: new Date(shift.startsAt.getTime() + offset), endsAt: new Date(shift.endsAt.getTime() + offset) };
}
