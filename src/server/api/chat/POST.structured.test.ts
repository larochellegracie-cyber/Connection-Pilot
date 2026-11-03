import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';

const state = vi.hoisted(() => ({ queue: [] as unknown[][], updates: [] as unknown[], inserts: [] as unknown[] }));
const script = vi.hoisted(() => ({ run: null as null | ((tools: Record<string, any>) => AsyncGenerator<Record<string, unknown>>), seenSystem: '', tools: {} as Record<string, any> }));
vi.mock('#airo/secrets', () => ({ getSecret: (name: string) => (name === 'BETTER_AUTH_SECRET' ? 'test-secret-value-1234567890' : name === 'OPENAI_API_KEY' ? 'sk-test' : undefined) }));
vi.mock('@/server/db/client.js', async () => ({ db: (await import('@/test/db-mock')).buildDb(state) }));
vi.mock('@/server/api/customers/tenant.js', () => ({ getTenant: vi.fn(async () => ({ id: 'biz-1', businessName: 'Somerset Pool', businessType: 'service' })), textValue: (v: unknown) => (typeof v === 'string' ? v : ''), normalizePhone: (v: string) => v }));
vi.mock('@/server/plan-access.js', () => ({ requirePlanFeature: vi.fn(async () => ({ allowed: true })) }));
vi.mock('@/lib/chatbot/chat-config', () => ({ getChatModel: () => ({}), isChatConfigured: () => true, SYSTEM_PROMPT: 'You are Pilot for {{businessName}}.' }));
vi.mock('@/server/api/calendar/shared.js', () => ({ getCalendarSettings: vi.fn(async () => ({ timezone: 'America/Toronto' })), assertSchedulingAvailability: vi.fn(), findNextAvailableSlots: vi.fn(async () => []) }));
vi.mock('@/server/appointment-notifications.js', () => ({ createAppointmentChangeNotification: vi.fn() }));
vi.mock('@/server/api/customers/activity.js', () => ({ logCustomerActivity: vi.fn() }));
vi.mock('@/server/pilot/business-context.js', () => ({ getPilotBusinessContext: vi.fn(async () => ({})) }));
vi.mock('@/server/pilot/learning.js', () => ({ searchPilotLearning: vi.fn(async () => []), learnFromOwnerMessage: vi.fn(), pilotFactKinds: ['observation'] }));
vi.mock('@/server/onboarding/guided.js', () => ({ onboardingContext: vi.fn(async () => '\n\nWhat the owner told Pilot when they set up their business:\n- team size: 2–5 people') }));
const jobs = vi.hoisted(() => ({ latest: vi.fn(), confirm: vi.fn() }));
const gen = vi.hoisted(() => ({ available: true, start: vi.fn() }));
vi.mock('@/server/marketing/video-generation.js', async () => {
  const { engineFor } = await import('@/server/marketing/video-engine.js');
  return { videoGenerationAvailable: () => gen.available, engineAvailable: () => gen.available, startVideoGeneration: (...a: unknown[]) => gen.start(...a), engineOf: (job: any) => (job?.storyboard ? (job.storyboard.engine ?? 'runway') : null), engineForJob: async (_t: string, job: any) => engineFor({ message: job.userMessage, style: job.brief.style }) };
});
vi.mock('@/server/marketing/marketing-jobs.js', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/server/marketing/marketing-jobs.js')>()), latestActiveJob: (...a: unknown[]) => jobs.latest(...a), confirmMarketingJob: (...a: unknown[]) => jobs.confirm(...a) }));
vi.mock('@/server/marketing/creative-context.js', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/server/marketing/creative-context.js')>()), loadCreativeContext: vi.fn(async (id: string) => ({ business: { businessName: 'Somerset Pool Service', businessType: 'Pool cleaning', location: 'Windsor-Essex', services: ['Pool closing'], promotions: '', brandVoice: { tone: '' }, websiteNotes: [] }, brand: { name: 'Somerset Pool Service' }, media: { all: [], photos: [{ label: 'Pouring salt into a pool' }], logos: [], videos: [] }, gaps: ['No logo has been added.'], tenantSeen: id })) }));
vi.mock('@/server/finance/send-invoice.js', () => ({ sendInvoiceEmail: vi.fn(), invoiceNumber: (id: string) => `INV-${id.slice(0, 8)}` }));
for (const route of ['@/server/api/schedules/copy-previous/POST.js', '@/server/api/schedules/pilot-draft/POST.js', '@/server/api/customers/POST.js', '@/server/api/jobs/POST.js', '@/server/api/finance/POST.js', '@/server/api/leads/POST.js', '@/server/api/finance/estimates/[estimateId]/send/POST.js', '@/server/api/schedules/[scheduleId]/PATCH.js', '@/server/api/schedules/[scheduleId]/email/POST.js']) vi.doMock(route, () => ({ default: vi.fn() }));
vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>();
  return { ...actual, streamText: (options: { tools: Record<string, any>; system: string }) => { script.seenSystem = options.system; script.tools = options.tools; return { fullStream: script.run!(options.tools), toTextStreamResponse: () => new Response('plain text reply') }; } };
});

import handler from './POST';
import { createStreamParser, type StreamEvent } from '@/lib/pilot-chat-stream';

function respond() {
  const chunks: string[] = [];
  return { statusCode: 200, headers: {} as Record<string, string>, chunks, headersSent: false, body: undefined as unknown,
    status(code: number) { this.statusCode = code; return this; }, json(payload: unknown) { this.body = payload; return this; }, setHeader(name: string, value: string) { this.headers[name] = value; return this; },
    write(chunk: string | Uint8Array) { chunks.push(typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk)); return true; }, end() { return this; } };
}
const ask = (structured: boolean, text = 'Send Cooper his invoice') => ({ body: { messages: [{ role: 'user', content: text }], structured } }) as unknown as Request;
const parse = (chunks: string[]) => { const events: StreamEvent[] = []; const parser = createStreamParser((event) => events.push(event)); chunks.forEach((chunk) => parser.push(chunk)); return events; };
const cooper = { id: 'cust-1', name: 'Cooper Bulmer', email: 'cooper@example.com' };
const invoiceRows = [{ id: '11111111-aaaa-4aaa-8aaa-111111111111', status: 'draft', total: '450.00', createdAt: new Date('2026-10-18'), jobService: 'pool cleaning' }];
const lines = [{ invoiceId: invoiceRows[0].id, description: 'Weekly pool cleaning' }];

beforeEach(() => { state.queue.length = 0; script.seenSystem = ''; vi.spyOn(console, 'error').mockImplementation((...args) => { if (process.env.DEBUG_CHAT) console.log('ERR', ...args); }); vi.spyOn(console, 'info').mockImplementation(() => {}); });

describe('POST /api/chat (structured)', () => {
  it('streams real progress, then a confirmation card, then the reply, and keeps the ticket out of the text', async () => {
    state.queue.push([], [], [], [cooper], invoiceRows, lines); // knowledge, marketing profile and website lookups, then the invoice search
    script.run = async function* (tools) {
      yield { type: 'tool-call', toolName: 'sendInvoice', input: { customerName: 'Cooper', invoiceDescription: 'pool cleaning' } };
      const output = await tools.sendInvoice.execute({ customerName: 'Cooper', invoiceDescription: 'pool cleaning' }, { toolCallId: 't1', messages: [] });
      yield { type: 'tool-result', toolName: 'sendInvoice', input: {}, output };
      yield { type: 'text-delta', text: 'I found his $450 invoice. Confirm below to send it.' };
    };
    const res = respond();
    await handler(ask(true), res as unknown as Response);
    const events = parse(res.chunks);
    expect(events.map((event) => event.type)).toEqual(['status', 'card', 'status', 'text']);
    expect(events[0]).toEqual({ type: 'status', label: 'Looking up Cooper’s invoice…' });
    const card = events[1] as Extract<StreamEvent, { type: 'card' }>;
    expect(card.card).toMatchObject({ title: 'Email invoice to Cooper Bulmer', confirmLabel: 'Send invoice' });
    expect(card.token).toContain('.');
    expect(events[2]).toEqual({ type: 'status', label: '' });
    expect(events[3]).toEqual({ type: 'text', text: 'I found his $450 invoice. Confirm below to send it.' });
    expect(res.headers['X-Request-Id']).toBeTruthy();
  });

  it('adds links under replies about records, using existing pages', async () => {
    script.run = async function* () {
      yield { type: 'tool-call', toolName: 'getBusinessContext', input: { topic: 'tomorrow_schedule' } };
      yield { type: 'tool-result', toolName: 'getBusinessContext', input: { topic: 'tomorrow_schedule' }, output: { shifts: [] } };
      yield { type: 'text-delta', text: 'Nobody is scheduled tomorrow.' };
    };
    const res = respond();
    await handler(ask(true, 'Who is working tomorrow?'), res as unknown as Response);
    const events = parse(res.chunks);
    expect(events[0]).toEqual({ type: 'status', label: 'Checking your schedule…' });
    expect(events).toContainEqual({ type: 'links', links: [{ label: 'Open scheduling', href: '/scheduling' }] });
  });

  it('reports a streaming failure instead of going quiet', async () => {
    script.run = async function* () { yield { type: 'error', error: new Error('boom') }; };
    const res = respond();
    await handler(ask(true), res as unknown as Response);
    expect(parse(res.chunks)).toEqual([{ type: 'error', message: 'Pilot ran into a problem while working on that.' }]);
  });

  it('gives Pilot what the owner said at setup, and the rules for confirmations', async () => {
    script.run = async function* () { yield { type: 'text-delta', text: 'ok' }; };
    await handler(ask(true), respond() as unknown as Response);
    expect(script.seenSystem).toContain('team size: 2–5 people');
  });

  it('keeps plain-text windows working, but they cannot confirm actions', async () => {
    script.run = async function* () { /* not used in plain mode */ };
    const res = respond();
    await handler(ask(false), res as unknown as Response);
    expect(res.chunks.join('')).not.toContain('\u001e');
    state.queue.push([cooper], invoiceRows, lines);
    const result = await script.tools.sendInvoice.execute({ customerName: 'Cooper', invoiceDescription: 'pool cleaning' }, { toolCallId: 't1', messages: [] });
    expect(result.message).toMatch(/cannot show confirmation buttons, so nothing was done/);
  });

  it('a clear request to make a video starts the free animated video at once, with no question, and calls no chat model or tool', async () => {
    script.seenSystem = ''; script.run = async function* () { yield { type: 'text-delta', text: 'SHOULD NOT BE USED' }; }; gen.available = true; jobs.confirm.mockResolvedValue(undefined);
    for (const structured of [true, false]) {
      gen.start.mockReset().mockResolvedValue({ started: true }); state.inserts.length = 0;
      const res = respond();
      await handler(ask(structured, 'Pilot, make me a TikTok about pool closing'), res as unknown as Response);
      const text = res.chunks.join('');
      expect(text).toMatch(/Marketing Creative Mode is on/); expect(text).toMatch(/About: pool closing/); expect(text).toMatch(/1 photo/); expect(text).toMatch(/Creating a free animated video…/); expect(text).toMatch(/uses no Runway credits/);
      expect(text).not.toMatch(/SHOULD NOT BE USED|Does this look right|Say yes|Using Runway/); expect(res.headers['X-Pilot-Mode']).toBe('marketing-creative');
      expect(gen.start).toHaveBeenCalledTimes(1); // started without asking
      const job = state.inserts.find((row) => (row as { status?: string }).status === 'brief_ready') as { businessProfileId: string; userMessage: string; briefJson: string };
      expect(job).toMatchObject({ businessProfileId: 'biz-1', userMessage: 'Pilot, make me a TikTok about pool closing' }); expect(JSON.parse(job.briefJson)).toMatchObject({ platform: 'tiktok', content_type: 'video', main_subject: 'pool closing', iteration_of: null });
    }
    expect(script.seenSystem).toBe(''); // the chat model was never called
    const { loadCreativeContext } = await import('@/server/marketing/creative-context.js');
    expect(vi.mocked(loadCreativeContext)).toHaveBeenCalledWith('biz-1'); // the business came from the session
  });

  it('a request with no subject gets one question and starts nothing; the premium look shows its cost and waits', async () => {
    script.seenSystem = ''; gen.available = true; gen.start.mockReset().mockResolvedValue({ started: true });
    const asked = respond(); await handler(ask(true, 'Pilot, make me a video for Somerset'), asked as unknown as Response);
    expect(asked.chunks.join('')).toMatch(/What should the video be about\?/); expect(gen.start).not.toHaveBeenCalled();
    const premium = respond(); await handler(ask(true, 'Pilot, make me a cinematic AI video about pool closing'), premium as unknown as Response);
    expect(premium.chunks.join('')).toMatch(/Using Runway: this will cost about 144 Runway credits/); expect(premium.chunks.join('')).toMatch(/make it animated/); expect(gen.start).not.toHaveBeenCalled(); expect(script.seenSystem).toBe('');
  });

  it('leaves ordinary questions to the normal Pilot chat', async () => {
    state.queue.push([], []);
    script.run = async function* () { yield { type: 'text-delta', text: 'Nobody is scheduled tomorrow.' }; };
    const res = respond();
    await handler(ask(true, 'Who is working tomorrow?'), res as unknown as Response);
    expect(res.headers['X-Pilot-Mode']).toBeUndefined(); expect(script.seenSystem).toMatch(/You are Pilot/);
    expect(parse(res.chunks).some((event) => event.type === 'text' && /Nobody is scheduled/.test(event.text))).toBe(true);
  });

  describe('Marketing Creative Mode follow-ups', () => {
    const brief = { platform: 'tiktok', content_type: 'video', main_subject: 'pool closing', style: ['dark', 'cinematic'], length_seconds: 15, key_instructions: ['use our real photos'], iteration_of: null };
    const job = (status: string) => ({ id: '9ffa3f34-0ba7-49ab-9808-0afdceb36948', status, userMessage: 'Make me a 15 second TikTok about pool closing', brief, createdAt: 'a', updatedAt: 'a' });
    const shown = '**Marketing Creative Mode is on.** Here’s what I understood:\n\n• Platform: TikTok\n\nI haven’t made anything yet. Does this look right? Tell me what to confirm or change.';
    const conversation = (reply: string, ...rest: string[]) => ({ body: { messages: [{ role: 'user', content: 'Make me a 15 second TikTok about pool closing' }, { role: 'assistant', content: shown }, { role: 'user', content: reply }, ...rest.map((content) => ({ role: 'assistant', content }))], structured: true } }) as unknown as Request;
    beforeEach(() => { gen.available = true; gen.start.mockReset().mockResolvedValue({ started: true }); jobs.latest.mockReset().mockResolvedValue(job('brief_ready')); jobs.confirm.mockReset().mockResolvedValue(job('confirmed')); script.seenSystem = ''; script.run = async function* () { yield { type: 'text-delta', text: 'NORMAL CHAT' }; }; });

    it('“yes” after the brief confirms the job, stays in the mode, and calls no model', async () => {
      const res = respond(); await handler(conversation('yes'), res as unknown as Response);
      const text = res.chunks.join('');
      expect(text).toMatch(/Marketing Creative Mode: confirmed/); expect(text).toMatch(/Using Runway: this will cost about 144 Runway credits/); expect(gen.start).toHaveBeenCalledTimes(1);
      expect(jobs.confirm).toHaveBeenCalledWith('biz-1', '9ffa3f34-0ba7-49ab-9808-0afdceb36948');
      expect(text).toMatch(/Your media for this:/); expect(state.updates.some((update) => 'selectionJson' in (update as object))).toBe(true); // the selection was saved on the job
      expect(res.headers['X-Pilot-Mode']).toBe('marketing-creative'); expect(script.seenSystem).toBe(''); expect(text).not.toMatch(/NORMAL CHAT/);
    });

    it('says plainly, and makes nothing, when video making is not connected', async () => {
      gen.available = false;
      const res = respond(); await handler(conversation('yes'), res as unknown as Response);
      expect(res.chunks.join('')).toMatch(/Runway isn’t connected on this server/); expect(res.chunks.join('')).toMatch(/make it animated/); expect(gen.start).not.toHaveBeenCalled();
    });

    it('“make it 20 seconds” after the brief saves a new brief_ready job that points at the old one, and shows the updated brief', async () => {
      state.inserts.length = 0;
      const res = respond(); await handler(conversation('make it 20 seconds'), res as unknown as Response);
      const text = res.chunks.join('');
      expect(text).toMatch(/Marketing Creative Mode is on\.\*\* Here’s the updated brief/); expect(text).toMatch(/What changed:\*\* length: 15s → 20s/); expect(text).toMatch(/about 20 seconds/); expect(text).toMatch(/Does this look right\?/);
      expect(jobs.confirm).not.toHaveBeenCalled(); expect(script.seenSystem).toBe('');
      const saved = state.inserts.find((row) => (row as { status?: string }).status === 'brief_ready') as { businessProfileId: string; userMessage: string; briefJson: string };
      expect(saved).toMatchObject({ businessProfileId: 'biz-1', userMessage: 'make it 20 seconds' });
      expect(JSON.parse(saved.briefJson)).toEqual({ ...brief, length_seconds: 20, iteration_of: '9ffa3f34-0ba7-49ab-9808-0afdceb36948' });
    });

    it('stays in the mode after a confirmation too: a later change revises the confirmed job', async () => {
      jobs.latest.mockResolvedValue(job('confirmed')); state.inserts.length = 0;
      const confirmed = '**Marketing Creative Mode: confirmed.** This brief is locked in:\n\n• Platform: TikTok';
      const res = respond(); await handler({ body: { messages: [{ role: 'user', content: 'yes' }, { role: 'assistant', content: confirmed }, { role: 'user', content: 'actually make it darker' }], structured: true } } as unknown as Request, res as unknown as Response);
      expect(res.chunks.join('')).toMatch(/updated brief/); expect(jobs.confirm).not.toHaveBeenCalled();
      expect(state.inserts.some((row) => (row as { status?: string }).status === 'brief_ready')).toBe(true);
    });

    it('does not hijack “yes” when Pilot’s last message was not about the brief', async () => {
      state.queue.push([], []);
      const res = respond(); await handler({ body: { messages: [{ role: 'user', content: 'Send Cooper his invoice' }, { role: 'assistant', content: 'Shall I send it?' }, { role: 'user', content: 'yes' }], structured: true } } as unknown as Request, res as unknown as Response);
      expect(jobs.confirm).not.toHaveBeenCalled(); expect(jobs.latest).not.toHaveBeenCalled(); expect(script.seenSystem).toMatch(/You are Pilot/); expect(res.headers['X-Pilot-Mode']).toBeUndefined();
    });

    it('leaves an unrelated question to the normal chat even while in the mode', async () => {
      state.queue.push([], []);
      const res = respond(); await handler(conversation('Who is working tomorrow?'), res as unknown as Response);
      expect(script.seenSystem).toMatch(/You are Pilot/); expect(jobs.confirm).not.toHaveBeenCalled(); expect(res.headers['X-Pilot-Mode']).toBeUndefined();
    });

    it('treats a different request as a new job, not a change to the old one', async () => {
      state.inserts.length = 0;
      const res = respond(); await handler(conversation('Make me an Instagram post for our cupcakes'), res as unknown as Response);
      expect(res.chunks.join('')).toMatch(/Here’s what I understood/); expect(res.chunks.join('')).toMatch(/Creating a free animated video…/);
      expect(jobs.confirm).not.toHaveBeenCalledWith('biz-1', '9ffa3f34-0ba7-49ab-9808-0afdceb36948'); // the old job is left alone; the new one is its own
      const saved = state.inserts.find((row) => (row as { status?: string }).status === 'brief_ready') as { briefJson: string };
      expect(JSON.parse(saved.briefJson).iteration_of).toBeNull();
    });
  });
});
