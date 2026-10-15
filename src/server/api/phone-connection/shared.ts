import { getSecret } from '#airo/secrets';

const twilioApiBase = 'https://api.twilio.com/2010-04-01';
const callbackBase = 'https://connectionpilot.net/api/webhooks/twilio';

export function normalizePhone(value: unknown): string {
  const source = typeof value === 'string' ? value.trim() : '';
  const digits = source.replace(/\D/g, '');
  if (!digits) return '';
  return source.startsWith('+') ? `+${digits}` : digits.length === 10 ? `+1${digits}` : `+${digits}`;
}

function credentials(): { accountSid: string; authToken: string } {
  const accountSid = getSecret('TWILIO_ACCOUNT_SID');
  const authToken = getSecret('TWILIO_AUTH_TOKEN');
  if (typeof accountSid !== 'string' || typeof authToken !== 'string' || !accountSid || !authToken) {
    throw new Error('Twilio credentials are not configured.');
  }
  return { accountSid, authToken };
}

function twilioHeaders(): HeadersInit {
  const { accountSid, authToken } = credentials();
  return { Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}` };
}

export type TwilioNumber = { sid: string; phoneNumber: string; friendlyName: string };

export async function findTwilioNumber(phoneNumber: string): Promise<TwilioNumber | null> {
  const { accountSid } = credentials();
  const response = await fetch(`${twilioApiBase}/Accounts/${accountSid}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(phoneNumber)}`, { headers: twilioHeaders() });
  if (!response.ok) throw new Error('Twilio could not check this number.');
  const payload = await response.json() as { incoming_phone_numbers?: Array<{ sid: string; phone_number: string; friendly_name: string }> };
  const found = payload.incoming_phone_numbers?.find((item) => normalizePhone(item.phone_number) === phoneNumber);
  return found ? { sid: found.sid, phoneNumber: normalizePhone(found.phone_number), friendlyName: found.friendly_name } : null;
}

export async function lookupPhoneNumber(phoneNumber: string): Promise<boolean> {
  const response = await fetch(`https://lookups.twilio.com/v2/PhoneNumbers/${encodeURIComponent(phoneNumber)}`, { headers: twilioHeaders() });
  if (response.status === 404) return false;
  if (!response.ok) throw new Error('Twilio could not verify this number.');
  const payload = await response.json() as { valid?: boolean };
  return payload.valid === true;
}

export async function sendTwilioSms(input: { from: string; to: string; body: string }): Promise<{ sid: string }> {
  const { accountSid } = credentials();
  const body = new URLSearchParams({ From: input.from, To: input.to, Body: input.body });
  const response = await fetch(`${twilioApiBase}/Accounts/${accountSid}/Messages.json`, {
    method: 'POST', headers: { ...twilioHeaders(), 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString(),
  });
  if (!response.ok) throw new Error(`Twilio could not send the SMS (${response.status}).`);
  const payload = await response.json() as { sid?: string };
  if (!payload.sid) throw new Error('Twilio did not return a message identifier.');
  return { sid: payload.sid };
}

export async function configureTwilioNumber(phoneSid: string): Promise<void> {
  const { accountSid } = credentials();
  const form = new URLSearchParams({
    SmsUrl: `${callbackBase}/sms`,
    SmsMethod: 'POST',
    VoiceUrl: `${callbackBase}/voice`,
    VoiceMethod: 'POST',
    StatusCallback: `${callbackBase}/call-status`,
    StatusCallbackMethod: 'POST',
  });
  const response = await fetch(`${twilioApiBase}/Accounts/${accountSid}/IncomingPhoneNumbers/${phoneSid}.json`, { method: 'POST', headers: { ...twilioHeaders(), 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString() });
  if (!response.ok) throw new Error('Twilio could not configure the number webhooks.');
}

