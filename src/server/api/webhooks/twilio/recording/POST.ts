import type { Request, Response } from 'express';
import { requireTwilioSignature, textValue, updateCallInteraction } from '../shared.js';

export default async function handler(req: Request, res: Response) {
  if (!requireTwilioSignature(req, res)) return;
  const callSid = textValue(req.body.CallSid, 255);
  if (!callSid) {
    res.status(400).json({ error: 'CallSid is required.' });
    return;
  }
  try {
    const recordingUrl = textValue(req.body.RecordingUrl, 10000);
    const recordingStatus = textValue(req.body.RecordingStatus, 60);
    const updated = await updateCallInteraction(callSid, {
      recordingUrl: recordingUrl || null,
      summary: recordingUrl ? 'Call recording received.' : undefined,
      status: recordingStatus || undefined,
    });
    res.status(updated ? 200 : 204).send();
  } catch (error) {
    res.status(500).json({ error: 'Unable to save call recording or transcript.', message: String(error) });
  }
}
