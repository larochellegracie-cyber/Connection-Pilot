import { beforeEach, describe, expect, it, vi } from 'vitest';
import { APIConnectionError, AuthenticationError, BadRequestError, RateLimitError } from '@runwayml/sdk';

const secret = vi.hoisted(() => ({ value: 'rk_test_SECRET_VALUE_DO_NOT_LEAK' as string | undefined }));
vi.mock('#airo/secrets', () => ({ getSecret: (name: string) => (name === 'RUNWAYML_API_SECRET' ? secret.value : undefined) }));

import { buildRunwayPrompt, getRunwayVideo, isRunwayConfigured, runwayProblem, runwayProvider, runwayRequestFor, startRunwayVideo, type RunwayClientLike } from './runway';
import type { VideoConcept } from '@/lib/marketing-content';

const concept = (overrides: Partial<VideoConcept> = {}): VideoConcept => ({ durationSeconds: 15, transitions: 'Quick cuts', audioDirection: 'Upbeat', render: { status: 'not_generated' }, scenes: [
  { seconds: 2, visual: 'Close-up of a leaf-filled pool edge, then a technician arriving with a net.', onScreenText: 'Pool closing? We handle it.' },
  { seconds: 3, visual: 'Technician skimming leaves and removing debris with a net.', onScreenText: 'Remove leaves and debris.' },
  { seconds: 4, visual: 'Technician checking the pump on the equipment pad.', onScreenText: 'Check pool equipment.' },
], ...overrides });
const item = { topic: 'Pool Closing Checklist', platform: 'tiktok' as const };

function fakeClient(overrides: Partial<RunwayClientLike> = {}): RunwayClientLike & { create: ReturnType<typeof vi.fn>; retrieve: ReturnType<typeof vi.fn> } {
  const create = vi.fn(async () => ({ id: 'task-abc-123', estimatedCost: { credits: 50 } }));
  const retrieve = vi.fn(async () => ({ id: 'task-abc-123', status: 'RUNNING' }));
  return { textToVideo: { create }, tasks: { retrieve }, create, retrieve, ...overrides } as never;
}
beforeEach(() => { secret.value = 'rk_test_SECRET_VALUE_DO_NOT_LEAK'; });

describe('Runway connection', () => {
  it('is connected only when RUNWAYML_API_SECRET is set', () => {
    expect(isRunwayConfigured()).toBe(true);
    expect(runwayProvider.isConfigured()).toBe(true);
    secret.value = '   ';
    expect(isRunwayConfigured()).toBe(false);
    secret.value = undefined;
    expect(runwayProvider.isConfigured()).toBe(false);
  });

  it('is registered as a background provider with a start and a retrieve step', () => {
    expect(runwayProvider).toMatchObject({ id: 'runway', label: 'Runway' });
    expect(typeof runwayProvider.start).toBe('function');
    expect(typeof runwayProvider.retrieve).toBe('function');
  });

  it('refuses to start without a key, and says so without naming any secret', async () => {
    secret.value = undefined;
    await expect(runwayProvider.start!(concept(), { ...item, caption: '', hook: '', cta: '' }, { tenantId: 'biz-1' })).rejects.toThrow(/Runway is not connected/);
  });
});

describe('the request sent to Runway', () => {
  it('uses the visuals of the plan, in order, within the prompt limit, with no on-screen text asked for', () => {
    const prompt = buildRunwayPrompt(concept(), item);
    expect(prompt.indexOf('1. Close-up of a leaf-filled pool edge')).toBeGreaterThan(-1);
    expect(prompt.indexOf('2. Technician skimming')).toBeGreaterThan(prompt.indexOf('1. Close-up'));
    expect(prompt).toContain('about: Pool Closing Checklist');
    expect(prompt).toContain('Transitions: Quick cuts.');
    expect(prompt).toContain('No on-screen text, captions, logos or phone numbers.');
    expect(prompt).not.toContain('Pool closing? We handle it.'); // overlay text is added in editing, not generated
    expect(prompt.length).toBeLessThanOrEqual(1000);
  });

  it('keeps a long plan inside the limit by dropping the last shots, never cutting the instructions', () => {
    const long = concept({ scenes: Array.from({ length: 10 }, (_, index) => ({ seconds: 2, visual: `Shot number ${index + 1}: ${'a detailed description '.repeat(10)}`, onScreenText: '' })) });
    const prompt = buildRunwayPrompt(long, item);
    expect(prompt.length).toBeLessThanOrEqual(1000);
    expect(prompt).toContain('No on-screen text, captions, logos or phone numbers.');
    expect(prompt).toContain('1. Shot number 1');
  });

  it('chooses the shape from the platform and keeps the clip within Runway’s 2–10 seconds', () => {
    expect(runwayRequestFor(concept(), item)).toMatchObject({ model: 'gen4.5', ratio: '720:1280', duration: 10 });
    expect(runwayRequestFor(concept({ durationSeconds: 6 }), { ...item, platform: 'linkedin' })).toMatchObject({ ratio: '1280:720', duration: 6 });
    expect(runwayRequestFor(concept({ durationSeconds: 1 }), item).duration).toBe(2);
  });
});

describe('starting a video', () => {
  it('sends the request, returns the task id straight away, and says the clip is AI-generated and shorter than the plan', async () => {
    const client = fakeClient();
    const started = await startRunwayVideo(concept(), item, client);
    expect(started).toMatchObject({ taskId: 'task-abc-123', estimatedCredits: 50 });
    expect(started.note).toMatch(/AI-generated footage, not your real work/);
    expect(started.note).toMatch(/up to 10 seconds, so this clip is 10 seconds, shorter than the 15-second plan/);
    expect(client.create).toHaveBeenCalledTimes(1);
    expect(client.create.mock.calls[0][0]).toMatchObject({ model: 'gen4.5', ratio: '720:1280', duration: 10 });
    expect(client.retrieve).not.toHaveBeenCalled(); // starting does not wait around
  });

  it('will not start a plan with nothing to film', async () => {
    const client = fakeClient();
    await expect(startRunwayVideo(concept({ scenes: [{ seconds: 3, visual: '   ', onScreenText: 'hi' }] }), item, client)).rejects.toThrow(/no scenes to film/);
    expect(client.create).not.toHaveBeenCalled();
  });

  it('fails if Runway returns no task id', async () => {
    const client = fakeClient({ textToVideo: { create: async () => ({ id: '' }) } as never });
    await expect(startRunwayVideo(concept(), item, client)).rejects.toThrow(/did not return a task id/);
  });
});

describe('retrieving a video', () => {
  const reply = (task: Record<string, unknown>) => fakeClient({ tasks: { retrieve: async () => ({ id: 't', ...task }) } as never });

  it('reports a running or queued video as still being made, with no link', async () => {
    expect(await getRunwayVideo('t', reply({ status: 'RUNNING', progress: 0.5 }))).toEqual({ status: 'processing', message: 'Runway is making the video.', progress: 0.5 });
    expect(await getRunwayVideo('t', reply({ status: 'PENDING' }))).toMatchObject({ status: 'processing', message: 'Waiting in Runway’s queue.' });
    expect(await getRunwayVideo('t', reply({ status: 'THROTTLED' }))).toMatchObject({ status: 'processing' });
  });

  it('returns the real video link when the task succeeded', async () => {
    expect(await getRunwayVideo('t', reply({ status: 'SUCCEEDED', output: ['https://dnznrvs05pmza.cloudfront.net/v.mp4?sig=abc'] }))).toEqual({ status: 'succeeded', url: 'https://dnznrvs05pmza.cloudfront.net/v.mp4?sig=abc' });
  });

  it('does not call it done when there is no usable https link', async () => {
    for (const output of [[], undefined, ['http://insecure.example.com/v.mp4'], ['not a url']]) {
      expect(await getRunwayVideo('t', reply({ status: 'SUCCEEDED', output }))).toMatchObject({ status: 'failed', message: expect.stringMatching(/did not give a link/) });
    }
  });

  it('reports failures and cancellations as no video, with the reason', async () => {
    expect(await getRunwayVideo('t', reply({ status: 'FAILED', failure: 'Content moderation' }))).toEqual({ status: 'failed', message: 'Runway could not make the video: Content moderation' });
    expect(await getRunwayVideo('t', reply({ status: 'CANCELLED' }))).toMatchObject({ status: 'failed', message: expect.stringMatching(/cancelled/) });
  });
});

describe('errors never expose the key', () => {
  const sdkError = (Class: new (...args: any[]) => Error, status: number, body: Record<string, unknown> = {}) => new Class(status, body, 'raw message containing rk_test_SECRET_VALUE_DO_NOT_LEAK', new Headers());
  it('turns Runway’s errors into plain sentences', () => {
    expect(runwayProblem(sdkError(AuthenticationError, 401))).toMatch(/did not accept the API key/);
    expect(runwayProblem(sdkError(RateLimitError, 429))).toMatch(/busy or the account has reached its limit/);
    expect(runwayProblem(sdkError(BadRequestError, 400, { error: 'promptText is too long' }))).toBe('Runway could not accept that video request: promptText is too long');
    expect(runwayProblem(new APIConnectionError({ message: 'ECONNRESET rk_test_SECRET_VALUE_DO_NOT_LEAK' }))).toMatch(/could not reach Runway/);
    expect(runwayProblem(new Error('boom'))).toBe('Something went wrong talking to Runway, and no video was made.');
  });
  it('never includes the secret in any message', () => {
    const all = [sdkError(AuthenticationError, 401), sdkError(RateLimitError, 429), sdkError(BadRequestError, 400, { error: 'bad' }), new APIConnectionError({ message: 'x rk_test_SECRET_VALUE_DO_NOT_LEAK' }), new Error('rk_test_SECRET_VALUE_DO_NOT_LEAK')].map(runwayProblem).join(' ');
    expect(all).not.toContain('rk_test_SECRET_VALUE_DO_NOT_LEAK');
  });
});
