import { and, asc, eq, like, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { tool } from 'ai';
import { z } from 'zod';
import { db } from '@/server/db/client.js';
import { customer, customerActivity, customerAppointment, customerNote } from '@/server/db/schema.js';
import { createAppointmentChangeNotification } from '@/server/appointment-notifications.js';
import { logCustomerActivity } from '@/server/api/customers/activity.js';
import { assertSchedulingAvailability, findNextAvailableSlots, getCalendarSettings } from '@/server/api/calendar/shared.js';
import { card } from './confirmation-card.js';

function formatPilotDateTime(date: Date, timezone: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date).replace(',', ' at');
}

/** Customer notes, customer edits and appointment changes. Each one only prepares a confirmation until the owner presses Confirm. */
export function createCoreWriteTools({ tenantId }: { tenantId: string }) {
  const tenantCustomer = eq(customer.businessProfileId, tenantId);
  return {
        addCustomerNote: tool({
          description: 'Save a note to a customer profile only when the owner explicitly asks, the customer is uniquely identified, and the owner has confirmed the exact note in this conversation.',
          inputSchema: z.object({ customerName: z.string().min(1).max(120), note: z.string().min(1).max(2000), confirmed: z.boolean().default(false) }),
          execute: async ({ customerName, note, confirmed }) => {
            const matches = await db.select({ id: customer.id, name: customer.name }).from(customer).where(and(tenantCustomer, sql`${customer.archivedAt} IS NULL`, like(customer.name, `%${customerName.trim()}%`))).limit(3);
            if (matches.length !== 1) return { ok: false, message: matches.length ? 'More than one customer matches that name.' : 'No active customer matches that name.' };
            if (!confirmed) return { ok: false, needsConfirmation: true, customerName: matches[0].name, proposedNote: note, card: card('Add a note to ' + matches[0].name, [`Note: “${note.trim()}”`], 'Save note', 'Saving the note…', { label: 'Open customer', href: `/dashboard/customers/${matches[0].id}` }), message: 'Ask the owner to confirm before saving this customer note.' };
            await db.insert(customerNote).values({ id: randomUUID(), customerId: matches[0].id, body: note.trim() });
            await logCustomerActivity(matches[0].id, 'customer_note_added', 'Pilot added a customer note', note.trim());
            return { ok: true, customerName: matches[0].name, message: 'Customer note saved.' };
          },
        }),
        updateCustomer: tool({
          description: 'Update a customer name, email, address, or status only after the owner confirms the exact change.',
          inputSchema: z.object({ customerName: z.string().min(1).max(120), updates: z.object({ name: z.string().min(1).max(255).optional(), email: z.string().email().optional(), address: z.string().max(1000).optional(), status: z.enum(['new', 'active', 'inactive', 'returning']).optional() }), confirmed: z.boolean().default(false) }),
          execute: async ({ customerName, updates, confirmed }) => {
            const matches = await db.select({ id: customer.id, name: customer.name }).from(customer).where(and(tenantCustomer, sql`${customer.archivedAt} IS NULL`, like(customer.name, `%${customerName.trim()}%`))).limit(3);
            if (matches.length !== 1) return { ok: false, message: matches.length ? 'More than one customer matches that name.' : 'No active customer matches that name.' };
            if (!Object.keys(updates).length) return { ok: false, message: 'No customer updates were supplied.' };
            if (!confirmed) return { ok: false, needsConfirmation: true, customerName: matches[0].name, proposedUpdates: updates, card: card('Update ' + matches[0].name, Object.entries(updates).map(([field, value]) => `Set ${field} to “${String(value)}”`), 'Update customer', 'Updating the customer…', { label: 'Open customer', href: `/dashboard/customers/${matches[0].id}` }), message: 'Ask the owner to confirm before changing this customer record.' };
            await db.update(customer).set(updates).where(eq(customer.id, matches[0].id));
            await logCustomerActivity(matches[0].id, 'customer_updated', 'Pilot updated customer information', JSON.stringify(updates));
            return { ok: true, customerName: matches[0].name, message: 'Customer information updated.' };
          },
        }),
        changeAppointment: tool({
          description: 'Create, reschedule, or cancel an appointment. Always identify a single customer and require explicit owner confirmation before making any change. Date/time must be a valid ISO 8601 datetime with timezone offset.',
          inputSchema: z.object({ action: z.enum(['create', 'reschedule', 'cancel']), customerName: z.string().min(1).max(120), appointmentId: z.string().uuid().optional(), title: z.string().min(1).max(255).optional(), scheduledAt: z.string().datetime({ offset: true }).optional(), durationMinutes: z.number().int().min(15).max(480).multipleOf(15).optional(), confirmed: z.boolean().default(false) }),
          execute: async ({ action, customerName, appointmentId, title, scheduledAt, durationMinutes, confirmed }) => {
            const matches = await db.select({ id: customer.id, name: customer.name }).from(customer).where(and(tenantCustomer, sql`${customer.archivedAt} IS NULL`, like(customer.name, `%${customerName.trim()}%`))).limit(3);
            if (matches.length !== 1) return { ok: false, message: matches.length ? 'More than one customer matches that name.' : 'No active customer matches that name.' };
            const customerRecord = matches[0];
            if (action === 'create') {
              if (!title || !scheduledAt) return { ok: false, message: 'A title and an ISO date/time are required to create an appointment.' };
              const date = new Date(scheduledAt);
              const duration = durationMinutes || 60;
              {
                const timezone = (await getCalendarSettings(tenantId)).timezone;
                if (Number.isNaN(date.getTime())) return { ok: false, message: 'That date and time is not valid.' };
                try { await assertSchedulingAvailability(tenantId, date, duration); } catch {
                  const availableTimes = await findNextAvailableSlots(tenantId, date, duration);
                  return { ok: false, unavailable: true, message: 'That time is not available, so nothing was prepared.', availableTimes: availableTimes.map((time) => ({ localTime: formatPilotDateTime(time, timezone), internalScheduledAt: time.toISOString() })) };
                }
                if (!confirmed) return { ok: false, needsConfirmation: true, customerName: customerRecord.name, proposedChange: { action, title, scheduledAt, durationMinutes: duration }, card: card(`Create an appointment for ${customerRecord.name}`, [`${title}`, `${formatPilotDateTime(date, timezone)} for ${duration} minutes`, 'This time is open: no conflicts found'], 'Create appointment', 'Creating the appointment…', { label: 'Open calendar', href: '/calendar' }), message: 'Ask the owner to confirm before creating this appointment.' };
              }
              try {
                await assertSchedulingAvailability(tenantId, date, duration);
              } catch {
                const availableTimes = await findNextAvailableSlots(tenantId, date, duration);
                const timezone = (await getCalendarSettings(tenantId)).timezone;
                return {
                  ok: false,
                  unavailable: true,
                  message: 'That time is not available.',
                  availableTimes: availableTimes.map((time) => ({ localTime: formatPilotDateTime(time, timezone), internalScheduledAt: time.toISOString() })),
                };
              }
              const id = randomUUID();
              await db.insert(customerAppointment).values({ id, customerId: customerRecord.id, title, scheduledAt: date, durationMinutes: duration });
              const timezone = (await getCalendarSettings(tenantId)).timezone;
              await logCustomerActivity(customerRecord.id, 'appointment_created', 'Appointment created by Pilot', `${title} at ${formatPilotDateTime(date, timezone)}`);
              return { ok: true, appointmentId: id, message: 'Appointment created.' };
            }
            const appointments = await db.select().from(customerAppointment).where(and(eq(customerAppointment.customerId, customerRecord.id), appointmentId ? eq(customerAppointment.id, appointmentId) : sql`${customerAppointment.status} = 'scheduled'`)).orderBy(asc(customerAppointment.scheduledAt)).limit(5);
            const timezone = (await getCalendarSettings(tenantId)).timezone;
            if (appointments.length !== 1) return {
              ok: false,
              appointments: appointments.map((item) => ({ id: item.id, title: item.title, scheduledAt: formatPilotDateTime(item.scheduledAt, timezone), status: item.status })),
              message: appointments.length ? 'More than one appointment matches. Ask the owner which appointment to change.' : 'No scheduled appointment matches that customer.',
            };
            const appointment = appointments[0];
            const proposedDate = scheduledAt ? new Date(scheduledAt) : null;
            if (action === 'reschedule') {
              if (!proposedDate || Number.isNaN(proposedDate.getTime())) return { ok: false, message: 'A valid new date and time is required to move an appointment. Ask the owner when it should move to.' };
              try { await assertSchedulingAvailability(tenantId, proposedDate, durationMinutes || appointment.durationMinutes, appointment.id); } catch {
                const availableTimes = await findNextAvailableSlots(tenantId, proposedDate, durationMinutes || appointment.durationMinutes, 3);
                return { ok: false, unavailable: true, message: 'That time is not available, so nothing was prepared.', availableTimes: availableTimes.map((time) => ({ localTime: formatPilotDateTime(time, timezone), internalScheduledAt: time.toISOString() })) };
              }
            }
            if (!confirmed) return {
              ok: false,
              needsConfirmation: true,
              card: action === 'cancel'
                ? card(`Cancel ${customerRecord.name}'s appointment`, [`${appointment.title}`, `Currently ${formatPilotDateTime(appointment.scheduledAt, timezone)}`, 'The appointment is kept in the history as cancelled'], 'Cancel appointment', 'Cancelling the appointment…', { label: 'Open calendar', href: '/calendar' }, 'danger')
                : card(`Move ${customerRecord.name}'s appointment`, [`${appointment.title}`, `From ${formatPilotDateTime(appointment.scheduledAt, timezone)}`, `To ${formatPilotDateTime(proposedDate as Date, timezone)}`, 'This time is open: no conflicts found'], 'Move appointment', 'Moving the appointment…', { label: 'Open calendar', href: '/calendar' }),
              customerName: customerRecord.name,
              proposedChange: {
                action,
                appointmentId: appointment.id,
                title: appointment.title,
                currentTime: formatPilotDateTime(appointment.scheduledAt, timezone),
                scheduledAt: scheduledAt ? formatPilotDateTime(new Date(scheduledAt), timezone) : null,
                durationMinutes,
              },
              message: `Ask the owner to confirm before ${action === 'cancel' ? 'cancelling' : 'rescheduling'} this appointment.`,
            };
            if (action === 'cancel') {
              await db.update(customerAppointment).set({ status: 'cancelled' }).where(eq(customerAppointment.id, appointment.id));
              await logCustomerActivity(customerRecord.id, 'appointment_cancelled', 'Appointment cancelled by Pilot', appointment.title);
              await createAppointmentChangeNotification({ businessProfileId: tenantId, customerId: customerRecord.id, customerName: customerRecord.name, appointmentId: appointment.id, before: appointment, after: { ...appointment, status: 'cancelled' } });
              return { ok: true, message: 'Appointment cancelled.' };
            }
            if (!scheduledAt) return { ok: false, message: 'A new ISO date/time is required to reschedule an appointment.' };
            const date = new Date(scheduledAt);
            const duration = durationMinutes || appointment.durationMinutes;
            try {
              await assertSchedulingAvailability(tenantId, date, duration, appointment.id);
            } catch {
              const availableTimes = await findNextAvailableSlots(tenantId, date, duration, 3);
              const timezone = (await getCalendarSettings(tenantId)).timezone;
                return {
                  ok: false,
                  unavailable: true,
                  message: 'That time is not available.',
                  availableTimes: availableTimes.map((time) => ({ localTime: formatPilotDateTime(time, timezone), internalScheduledAt: time.toISOString() })),
                };
            }
            await db.update(customerAppointment).set({ scheduledAt: date, durationMinutes: duration }).where(eq(customerAppointment.id, appointment.id));
            await logCustomerActivity(customerRecord.id, 'appointment_rescheduled', 'Appointment rescheduled by Pilot', `${appointment.title} to ${formatPilotDateTime(date, timezone)}`);
            await createAppointmentChangeNotification({ businessProfileId: tenantId, customerId: customerRecord.id, customerName: customerRecord.name, appointmentId: appointment.id, before: appointment, after: { ...appointment, scheduledAt: date, durationMinutes: duration } });
            return { ok: true, message: 'Appointment rescheduled.' };
          },
        }),
        addFollowUpNote: tool({
          description: 'Add a follow-up activity note to a specific customer record only after the owner confirms the exact note.',
          inputSchema: z.object({ customerName: z.string().min(1).max(120), note: z.string().min(1).max(1000), confirmed: z.boolean().default(false) }),
          execute: async ({ customerName, note, confirmed }) => {
            const matches = await db.select({ id: customer.id, name: customer.name })
              .from(customer)
              .where(and(tenantCustomer, sql`${customer.archivedAt} IS NULL`, like(customer.name, `%${customerName.trim()}%`)))
              .limit(3);
            if (matches.length !== 1) return { ok: false, message: matches.length ? 'More than one customer matches that name. Ask the owner to be more specific before saving a note.' : 'No active customer matches that name.' };
            if (!confirmed) return { ok: false, needsConfirmation: true, customerName: matches[0].name, proposedNote: note, card: card('Add a follow-up note for ' + matches[0].name, [`Note: “${note.trim()}”`], 'Save note', 'Saving the note…', { label: 'Open customer', href: `/dashboard/customers/${matches[0].id}` }), message: 'Ask the owner to confirm before saving this follow-up note.' };
            await db.insert(customerActivity).values({ id: randomUUID(), customerId: matches[0].id, activityType: 'assistant_follow_up', title: 'Pilot follow-up note added', detail: note.trim() });
            return { ok: true, customerName: matches[0].name, message: 'Follow-up note saved to the customer activity record.' };
          },
        }),
  };
}
