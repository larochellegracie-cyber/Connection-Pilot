import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '@/server/db/client.js';
import { businessNotification, businessProfile } from '@/server/db/schema.js';
import { sendEmail } from '@/server/email';

type AppointmentSnapshot = {
  title: string;
  scheduledAt: Date;
  durationMinutes: number;
  notes: string | null;
  status: string;
};

type NotificationBase = {
  businessProfileId: string;
  customerId: string;
  customerName: string;
  appointmentId?: string;
};

type NotificationInput = NotificationBase & { before: AppointmentSnapshot; after: AppointmentSnapshot };

function formatAppointment(appointment: AppointmentSnapshot): string {
  return `${new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(appointment.scheduledAt)} — ${appointment.title}`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] || character);
}

async function deliverNotification(input: NotificationBase & { type: string; title: string; detail: string; beforeDetails: string | null; afterDetails: string | null; emailText: string }) {
  await db.insert(businessNotification).values({
    id: randomUUID(), businessProfileId: input.businessProfileId, customerId: input.customerId, appointmentId: input.appointmentId ?? null,
    type: input.type, title: input.title, detail: input.detail, beforeDetails: input.beforeDetails, afterDetails: input.afterDetails,
  });
  const business = await db.select({ email: businessProfile.businessEmail }).from(businessProfile).where(eq(businessProfile.id, input.businessProfileId)).limit(1);
  const recipient = business[0]?.email;
  if (!recipient) return;
  try {
    await sendEmail({
      fromName: 'Connection Pilot', to: recipient, subject: `${input.title}: ${input.customerName}`,
      text: `${input.title}\n${input.emailText}`,
      html: `<h1>${escapeHtml(input.title)}</h1><p>${escapeHtml(input.emailText)}</p>`,
    });
  } catch (error) {
    console.error('appointment-notification.email-failed', error);
  }
}

export async function createAppointmentBookedNotification(input: NotificationBase & { appointment: AppointmentSnapshot }): Promise<void> {
  const details = formatAppointment(input.appointment);
  await deliverNotification({
    ...input,
    type: 'appointment_booked',
    title: 'Appointment booked',
    detail: `${input.customerName}: A new appointment was booked for ${details}.`,
    beforeDetails: null,
    afterDetails: details,
    emailText: `${input.customerName} booked a new appointment for ${details}.`,
  });
}

export async function createInboundCommunicationNotification(input: NotificationBase & { channel: 'call' | 'sms'; preview?: string | null }): Promise<void> {
  const channelLabel = input.channel === 'call' ? 'Phone call' : 'SMS message';
  const preview = input.preview?.trim();
  await deliverNotification({
    ...input,
    type: input.channel === 'call' ? 'call_received' : 'sms_received',
    title: `${channelLabel} received`,
    detail: preview ? `${input.customerName}: ${preview}` : `${input.customerName} contacted your business by ${input.channel}.`,
    beforeDetails: null,
    afterDetails: null,
    emailText: preview ? `${input.customerName} sent: ${preview}` : `${input.customerName} contacted your business by ${input.channel}.`,
  });
}

function describeChange(before: AppointmentSnapshot, after: AppointmentSnapshot): { type: string; title: string; detail: string } | null {
  if (after.status === 'cancelled' && before.status !== 'cancelled') return { type: 'appointment_cancelled', title: 'Appointment cancelled', detail: `The appointment on ${formatAppointment(before)} was cancelled.` };
  if (before.scheduledAt.getTime() !== after.scheduledAt.getTime()) return { type: 'appointment_rescheduled', title: 'Appointment rescheduled', detail: `Original: ${formatAppointment(before)}. New: ${formatAppointment(after)}.` };
  if (before.title !== after.title || before.durationMinutes !== after.durationMinutes || before.notes !== after.notes || before.status !== after.status) return { type: 'appointment_updated', title: 'Appointment updated', detail: `Updated appointment: ${formatAppointment(after)}.` };
  return null;
}

export async function createAppointmentChangeNotification(input: NotificationInput): Promise<void> {
  const change = describeChange(input.before, input.after);
  if (!change) return;
  const beforeDetails = formatAppointment(input.before);
  const afterDetails = input.after.status === 'cancelled' ? null : formatAppointment(input.after);
  await deliverNotification({
    ...input,
    ...change,
    detail: `${input.customerName}: ${change.detail}`,
    beforeDetails,
    afterDetails,
    emailText: `${input.customerName} changed their appointment. ${change.detail}`,
  });
}
