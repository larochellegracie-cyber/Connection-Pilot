import { getSecret } from '#airo/secrets';

export type ConfirmedVoiceBooking = {
  appointmentIntent: 'new' | 'reschedule';
  name: string | null;
  email: string | null;
  address: string | null;
  title: string;
  scheduledAt: string;
  notes: string | null;
  customerNote: string | null;
};

export type VoiceCustomerDetails = {
  name: string | null;
  email: string | null;
  address: string | null;
  customerNote: string | null;
};

type OpenAiResponse = {
  output_text?: unknown;
  output?: Array<{ content?: Array<{ text?: unknown }> }>;
  error?: { message?: unknown };
};

function responseText(payload: OpenAiResponse): string {
  if (typeof payload.output_text === 'string') return payload.output_text;
  return Array.isArray(payload.output)
    ? payload.output.flatMap((item) => Array.isArray(item.content) ? item.content.map((part) => typeof part.text === 'string' ? part.text : '') : []).join('')
    : '';
}

function optionalText(value: unknown, maxLength: number): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, maxLength) : null;
}

function parseCustomerDetails(value: string): VoiceCustomerDetails {
  try {
    const json = value.match(/\{[\s\S]*\}/)?.[0] ?? value;
    const parsed = JSON.parse(json) as Partial<VoiceCustomerDetails>;
    const email = optionalText(parsed.email, 255);
    return {
      name: optionalText(parsed.name, 255),
      email: email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null,
      address: optionalText(parsed.address, 1000),
      customerNote: optionalText(parsed.customerNote, 5000),
    };
  } catch {
    return { name: null, email: null, address: null, customerNote: null };
  }
}

function parseBooking(value: string): ConfirmedVoiceBooking | null {
  try {
    const json = value.match(/\{[\s\S]*\}/)?.[0] ?? value;
    const parsed = JSON.parse(json) as Partial<ConfirmedVoiceBooking>;
    if (typeof parsed.title !== 'string' || !parsed.title.trim() || typeof parsed.scheduledAt !== 'string') return null;
    const scheduledAt = new Date(parsed.scheduledAt);
    if (Number.isNaN(scheduledAt.getTime()) || scheduledAt.getTime() <= Date.now()) return null;
    const details = parseCustomerDetails(value);
    return {
      ...details,
      appointmentIntent: parsed.appointmentIntent === 'reschedule' ? 'reschedule' : 'new',
      title: parsed.title.trim().slice(0, 255),
      scheduledAt: scheduledAt.toISOString(),
      notes: optionalText(parsed.notes, 5000),
    };
  } catch {
    return null;
  }
}

async function requestExtraction(instructions: string, input: string, maxOutputTokens: number): Promise<string> {
  const apiKey = getSecret('OPENAI_API_KEY');
  if (!apiKey || typeof apiKey !== 'string') return '';
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-5-mini', reasoning: { effort: 'minimal' }, max_output_tokens: maxOutputTokens, instructions, input }),
  });
  const payload = await response.json() as OpenAiResponse;
  if (!response.ok) {
    const message = typeof payload.error?.message === 'string' ? payload.error.message : `HTTP ${response.status}`;
    throw new Error(`Voice receptionist extraction failed: ${message}`);
  }
  return responseText(payload).trim();
}

export async function extractVoiceCustomerDetails(input: { businessName: string; transcript: string }): Promise<VoiceCustomerDetails> {
  const result = await requestExtraction(
    `Extract customer contact details stated by the caller in this ${input.businessName} phone transcript. Return ONLY JSON with this shape: {"name":null,"email":null,"address":null,"customerNote":null}. Include a value only when the caller stated it clearly. Do not guess. customerNote should contain only a concise relevant preference or request that is useful to the business, otherwise null.`,
    input.transcript,
    200,
  );
  return result ? parseCustomerDetails(result) : { name: null, email: null, address: null, customerNote: null };
}

export async function extractConfirmedVoiceBooking(input: { businessName: string; transcript: string; timezone: string }): Promise<ConfirmedVoiceBooking | null> {
  const result = await requestExtraction(
    `You extract a confirmed voice appointment for ${input.businessName}. Return ONLY one JSON object or the exact word NONE. Create a JSON object only when the caller explicitly confirmed a specific future service appointment, date, and time. A request, a tentative time, or a receptionist suggestion is not a confirmed appointment. Set appointmentIntent to "reschedule" only when the caller clearly says they are changing an existing appointment; otherwise set it to "new". Never guess missing details. Treat the caller phone number as already known. Use ISO 8601 with an explicit offset for scheduledAt in the business timezone (${input.timezone}). JSON shape: {"appointmentIntent":"new","name":null,"email":null,"address":null,"title":"","scheduledAt":"","notes":null,"customerNote":null}. customerNote is a concise relevant detail from the call, if any.`,
    `Current time: ${new Date().toISOString()}\n\nVoice call transcript:\n${input.transcript}`,
    350,
  );
  return result === 'NONE' || !result ? null : parseBooking(result);
}
