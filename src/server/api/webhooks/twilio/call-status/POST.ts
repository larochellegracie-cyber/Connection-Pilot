import type { Request, Response } from 'express';
import { processMissedCallTextBack, updateExistingCallStatus } from '../missed-call-text-back.js';
import { normalizePhone, requireTwilioSignature, textValue } from '../shared.js';

export default async function handler(req: Request, res: Response) {
  if (!requireTwilioSignature(req, res)) return;
  const callSid = textValue(req.body.CallSid, 255);
  if (!callSid) {
    res.status(400).json({ error: 'CallSid is required.' });
    return;
  }

  try {
    const callStatus = textValue(req.body.CallStatus, 60).toLowerCase();
    const direction = textValue(req.body.Direction, 60).toLowerCase();
    const from = normalizePhone(req.body.From);
    const to = normalizePhone(req.body.To);
    await updateExistingCallStatus(callSid, callStatus);
    const result = await processMissedCallTextBack({ callSid, callStatus, direction, from, to });
    console.info('twilio.missed-call-text.evaluated', { callSid, callStatus, direction, result: result.reason });
    res.status(200).send();
  } catch (error) {
    console.error('twilio.call-status.failed', { callSid, error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ error: 'Unable to process call status.' });
  }
}
