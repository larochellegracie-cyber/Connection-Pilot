import type { Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '@/server/db/client.js';
import { calendarSettings } from '@/server/db/schema.js';
import { getTenant } from '../customers/tenant.js';
import { defaultWeeklyHours, getCalendarSettings, type BookingPolicy, type WeeklyHours } from '../calendar/shared.js';

const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

function boundedNumber(value: unknown, fallback: number, min: number, max: number, step = 1) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const rounded = Math.round(parsed);
  return rounded >= min && rounded <= max && rounded % step === 0 ? rounded : fallback;
}
function booleanValue(value: unknown, fallback: boolean) { return typeof value === 'boolean' ? value : fallback; }
function policy(value: unknown): BookingPolicy { return value === 'notice' || value === 'disabled' ? value : 'anytime'; }
function time(value: unknown, fallback: string) { return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : fallback; }
function minutes(value: string) { const [hours, minute] = value.split(':').map(Number); return hours * 60 + minute; }
function weeklyHours(value: unknown): WeeklyHours {
  const input = value && typeof value === 'object' ? value as Partial<WeeklyHours> : {};
  return Object.fromEntries(days.map((day) => {
    const source = input[day]; const fallback = defaultWeeklyHours[day];
    const start = time(source?.start, fallback.start); const end = time(source?.end, fallback.end); const enabled = Boolean(source?.enabled);
    if (enabled && minutes(start) >= minutes(end)) throw new Error(`${day[0].toUpperCase()}${day.slice(1)} must end after it starts.`);
    return [day, { enabled, start, end }];
  })) as WeeklyHours;
}

export default async function handler(req: Request, res: Response) {
  try {
    const tenant = await getTenant(req, res); if (!tenant) return;
    const current = await getCalendarSettings(tenant.id);
    const allowOverlaps = booleanValue(req.body.allowOverlaps, current.allowOverlaps);
    const reschedulingPolicy = policy(req.body.reschedulingPolicy);
    const cancellationPolicy = policy(req.body.cancellationPolicy);
    const settings = {
      defaultDurationMinutes: boundedNumber(req.body.defaultDurationMinutes, current.defaultDurationMinutes, 15, 480, 15),
      bufferMinutes: boundedNumber(req.body.bufferMinutes, current.bufferMinutes, 0, 240, 5),
      allowOverlaps,
      maxConcurrentAppointments: allowOverlaps ? boundedNumber(req.body.maxConcurrentAppointments, current.maxConcurrentAppointments, 2, 20) : 1,
      minimumNoticeMinutes: boundedNumber(req.body.minimumNoticeMinutes, current.minimumNoticeMinutes, 0, 10080),
      bookingWindowDays: boundedNumber(req.body.bookingWindowDays, current.bookingWindowDays, 1, 730),
      allowSameDay: booleanValue(req.body.allowSameDay, current.allowSameDay),
      reschedulingPolicy,
      reschedulingNoticeHours: reschedulingPolicy === 'notice' ? boundedNumber(req.body.reschedulingNoticeHours, current.reschedulingNoticeHours, 1, 720) : 0,
      cancellationPolicy,
      cancellationNoticeHours: cancellationPolicy === 'notice' ? boundedNumber(req.body.cancellationNoticeHours, current.cancellationNoticeHours, 1, 720) : 0,
      weeklyHours: JSON.stringify(weeklyHours(req.body.weeklyHours)),
    };
    await db.update(calendarSettings).set(settings).where(eq(calendarSettings.businessProfileId, tenant.id));
    res.json({ settings: await getCalendarSettings(tenant.id) });
  } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : 'Unable to save booking rules.' }); }
}
