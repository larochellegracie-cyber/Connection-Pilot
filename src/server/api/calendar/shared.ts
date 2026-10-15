import { randomUUID } from 'node:crypto';
import { and, eq, ne } from 'drizzle-orm';
import { db } from '@/server/db/client.js';
import { calendarSettings, customer, customerAppointment } from '@/server/db/schema.js';

export type WeeklyHours = Record<string, { enabled: boolean; start: string; end: string }>;
export type BookingPolicy = 'anytime' | 'notice' | 'disabled';

export const defaultWeeklyHours: WeeklyHours = {
  monday: { enabled: true, start: '09:00', end: '17:00' },
  tuesday: { enabled: true, start: '09:00', end: '17:00' },
  wednesday: { enabled: true, start: '09:00', end: '17:00' },
  thursday: { enabled: true, start: '09:00', end: '17:00' },
  friday: { enabled: true, start: '09:00', end: '17:00' },
  saturday: { enabled: false, start: '09:00', end: '17:00' },
  sunday: { enabled: false, start: '09:00', end: '17:00' },
};

function parseWeeklyHours(value: string): WeeklyHours {
  try {
    const parsed = JSON.parse(value) as Partial<WeeklyHours>;
    return { ...defaultWeeklyHours, ...parsed } as WeeklyHours;
  } catch {
    return defaultWeeklyHours;
  }
}

export async function getCalendarSettings(businessProfileId: string) {
  const saved = await db.select().from(calendarSettings).where(eq(calendarSettings.businessProfileId, businessProfileId)).limit(1);
  if (saved[0]) return { ...saved[0], weeklyHours: parseWeeklyHours(saved[0].weeklyHours) };
  const id = randomUUID();
  await db.insert(calendarSettings).values({ id, businessProfileId, weeklyHours: JSON.stringify(defaultWeeklyHours) });
  return {
    id, businessProfileId, timezone: 'America/Toronto', weeklyHours: defaultWeeklyHours, defaultDurationMinutes: 60,
    bufferMinutes: 0, allowOverlaps: false, maxConcurrentAppointments: 1, minimumNoticeMinutes: 0,
    bookingWindowDays: 90, allowSameDay: true, reschedulingPolicy: 'anytime', reschedulingNoticeHours: 0,
    cancellationPolicy: 'anytime', cancellationNoticeHours: 0,
  };
}

export async function tenantCustomer(customerId: string, businessProfileId: string) {
  const found = await db.select({ id: customer.id }).from(customer).where(and(eq(customer.id, customerId), eq(customer.businessProfileId, businessProfileId))).limit(1);
  return found[0] || null;
}

export async function hasSchedulingConflict(businessProfileId: string, start: Date, durationMinutes: number, excludeId?: string) {
  const settings = await getCalendarSettings(businessProfileId);
  const rows = await db
    .select({ id: customerAppointment.id, scheduledAt: customerAppointment.scheduledAt, durationMinutes: customerAppointment.durationMinutes, status: customerAppointment.status })
    .from(customerAppointment)
    .innerJoin(customer, eq(customerAppointment.customerId, customer.id))
    .where(and(eq(customer.businessProfileId, businessProfileId), excludeId ? ne(customerAppointment.id, excludeId) : undefined));
  const candidateStart = start.getTime();
  const candidateEnd = candidateStart + (durationMinutes + settings.bufferMinutes) * 60000;
  const capacity = settings.allowOverlaps ? Math.max(2, settings.maxConcurrentAppointments) : 1;
  const concurrentAppointments = rows.filter((appointment) => {
    if (appointment.status === 'cancelled') return false;
    const appointmentStart = appointment.scheduledAt.getTime();
    const appointmentEnd = appointmentStart + (appointment.durationMinutes + settings.bufferMinutes) * 60000;
    return candidateStart < appointmentEnd && candidateEnd > appointmentStart;
  });
  return concurrentAppointments.length >= capacity;
}

function minutesFromTime(value: string) {
  const [hours, minutes] = value.split(':').map(Number);
  return Number.isFinite(hours) && Number.isFinite(minutes) ? hours * 60 + minutes : 0;
}

function localScheduleParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value || '';
  return { weekday: part('weekday').toLowerCase(), minutes: Number(part('hour')) * 60 + Number(part('minute')) };
}

export async function assertSchedulingAvailability(businessProfileId: string, start: Date, durationMinutes: number, excludeId?: string) {
  const settings = await getCalendarSettings(businessProfileId);
  const now = Date.now();
  const leadMinutes = (start.getTime() - now) / 60000;
  if (leadMinutes < settings.minimumNoticeMinutes) throw new Error(`Appointments require at least ${settings.minimumNoticeMinutes} minutes of notice.`);
  if (start.getTime() > now + settings.bookingWindowDays * 86400000) throw new Error(`Appointments can only be booked ${settings.bookingWindowDays} days in advance.`);
  const localTime = localScheduleParts(start, settings.timezone);
  const localNow = localScheduleParts(new Date(), settings.timezone);
  if (!settings.allowSameDay && localTime.weekday === localNow.weekday && start.getTime() < now + 86400000) throw new Error('Same-day appointments are not available.');
  const hours = settings.weeklyHours[localTime.weekday];
  if (!hours?.enabled || localTime.minutes < minutesFromTime(hours.start) || localTime.minutes + durationMinutes > minutesFromTime(hours.end)) {
    throw new Error('This time is outside the business availability hours.');
  }
  if (await hasSchedulingConflict(businessProfileId, start, durationMinutes, excludeId)) throw new Error('This time conflicts with the current booking rules.');
}

export async function findNextAvailableSlots(businessProfileId: string, after: Date, durationMinutes: number, count = 3): Promise<Date[]> {
  const results: Date[] = [];
  const candidate = new Date(after);
  candidate.setMinutes(candidate.getMinutes() + 30 - (candidate.getMinutes() % 30), 0, 0);
  for (let attempt = 0; attempt < 336 && results.length < count; attempt += 1) {
    try {
      await assertSchedulingAvailability(businessProfileId, candidate, durationMinutes);
      results.push(new Date(candidate));
    } catch {
      // Continue searching through the business's configured availability.
    }
    candidate.setMinutes(candidate.getMinutes() + 30);
  }
  return results;
}
