import type { Request, Response } from 'express';
import { extractConfirmedVoiceBooking, extractVoiceCustomerDetails } from '../voice-ai.js';
import {
  getVoiceReceptionistContext,
  requireTwilioSignature,
  saveReceptionistAppointment,
  saveVoiceReceptionistNote,
  textValue,
  updateCallInteraction,
  updateReceptionistCustomerDetails,
} from '../shared.js';

export default async function handler(req: Request, res: Response) {
  if (!requireTwilioSignature(req, res)) return;
  const callSid = textValue(req.body.CallSid, 255);
  const transcript = textValue(req.body.TranscriptionText, 50000);
  if (!callSid || !transcript) {
    res.status(400).json({ error: 'CallSid and TranscriptionText are required.' });
    return;
  }

  try {
    const updated = await updateCallInteraction(callSid, {
      transcript,
      conversation: transcript,
      summary: 'Call transcript received.',
    });
    if (!updated) {
      res.status(204).send();
      return;
    }

    const context = await getVoiceReceptionistContext(callSid);
    if (!context) {
      res.status(204).send();
      return;
    }

    const callerDetails = await extractVoiceCustomerDetails({ businessName: context.business.businessName, transcript });
    await updateReceptionistCustomerDetails(context.customer.id, callerDetails);
    if (callerDetails.customerNote) await saveVoiceReceptionistNote(context.customer.id, callSid, callerDetails.customerNote);

    const booking = await extractConfirmedVoiceBooking({
      businessName: context.business.businessName,
      transcript,
      timezone: context.timezone,
    });
    if (!booking) {
      res.status(200).send();
      return;
    }

    await updateReceptionistCustomerDetails(context.customer.id, {
      name: booking.name || callerDetails.name,
      email: booking.email || callerDetails.email,
      address: booking.address || callerDetails.address,
    });

    try {
      await saveReceptionistAppointment({
        customerId: context.customer.id,
        sourceExternalId: `appointment:call:${callSid}`,
        isRebooking: booking.appointmentIntent === 'reschedule',
        name: booking.name || context.customer.name,
        email: booking.email,
        address: booking.address,
        title: booking.title,
        scheduledAt: new Date(booking.scheduledAt),
        notes: booking.notes || `Confirmed during phone call ${callSid}.`,
      });
      await saveVoiceReceptionistNote(context.customer.id, callSid, booking.customerNote || `Confirmed ${booking.title} for ${booking.scheduledAt}.`);
    } catch (bookingError) {
      const detail = bookingError instanceof Error ? bookingError.message : 'The requested time could not be confirmed.';
      await saveVoiceReceptionistNote(context.customer.id, callSid, `Caller requested ${booking.title}, but the time was not booked: ${detail}`);
      console.warn('twilio.voice.appointment-not-saved', { callSid, customerId: context.customer.id, detail });
    }

    res.status(200).send();
  } catch (error) {
    res.status(500).json({ error: 'Unable to save call transcript.', message: String(error) });
  }
}
