import { describe, expect, it, vi } from 'vitest';

vi.mock('#airo/secrets', () => ({ getSecret: () => undefined }));
vi.mock('./standard-video/provider.js', () => ({ standardProvider: { id: 'standard', label: 'Standard Video', mode: 'standard', isConfigured: () => true } }));
import { imageGenerationStatus, providerMode, renderVideo, videoGenerationStatus, videoProviders, type VideoProvider } from './providers';
import type { ContentItem } from '@/lib/marketing-content';

const video: ContentItem = { id: 'v1', kind: 'video', platform: 'tiktok', status: 'approved', hook: 'h', caption: 'c', cta: 'a', hashtags: [], suggestedVisual: 'v', postingFormat: '', topic: 'Pool opening', goal: '', tone: '', why: '', evidence: [], scheduledFor: null, approvedAt: null, publishedAt: null, campaign: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  video: { durationSeconds: 15, scenes: [{ seconds: 3, visual: 'a', onScreenText: 'b' }, { seconds: 4, visual: 'c', onScreenText: 'd' }], transitions: '', audioDirection: '', render: { status: 'not_generated' } } };
const provider = (overrides: Partial<VideoProvider> = {}): VideoProvider => ({ id: 'acme', label: 'Acme Video', isConfigured: () => true, render: async () => ({ url: 'https://cdn.example.com/v.mp4' }), ...overrides });

describe('video provider layer', () => {
  it('lists Standard Video (low-cost, on our servers) and Runway (AI), and Runway without a key is not connected', () => {
    expect(videoProviders.map((entry) => [entry.label, providerMode(entry)])).toEqual([['Standard Video', 'standard'], ['Runway', 'ai']]);
    expect(videoProviders[1].isConfigured()).toBe(false);
    expect(videoGenerationStatus(videoProviders, 'ai')).toMatchObject({ configured: false, provider: null, message: expect.stringMatching(/AI video needs a video provider connection \(Runway\)/) });
  });

  it('with nothing connected, says that making the file needs a provider', () => {
    const status = videoGenerationStatus([]);
    expect(status).toMatchObject({ configured: false, provider: null });
    expect(status.message).toMatch(/needs a video provider connection, and none is connected yet/);
    expect(status.message).toMatch(/video plan/);
  });

  it('does not make a video, or pretend to, when no provider is connected', async () => {
    const outcome = await renderVideo(video);
    expect(outcome).toMatchObject({ ok: false, providerRequired: true });
  });

  it('only counts a video as made when a provider returns a real https file', async () => {
    expect(await renderVideo(video, [provider()])).toEqual({ ok: true, url: 'https://cdn.example.com/v.mp4', provider: 'Acme Video' });
    expect(await renderVideo(video, [provider({ render: async () => ({ url: 'http://insecure.example.com/v.mp4' }) })])).toMatchObject({ ok: false, providerRequired: false, message: expect.stringMatching(/did not return a video file/) });
    expect(await renderVideo(video, [provider({ render: async () => ({ url: '' }) })])).toMatchObject({ ok: false });
  });

  it('reports a provider failure as a failure, with its reason', async () => {
    const outcome = await renderVideo(video, [provider({ render: async () => { throw new Error('quota exceeded'); } })]);
    expect(outcome).toMatchObject({ ok: false, message: 'The video was NOT made. Acme Video said: quota exceeded' });
  });

  it('skips providers that are not configured, and only renders real video concepts', async () => {
    const render = vi.fn(async () => ({ url: 'https://cdn.example.com/v.mp4' }));
    expect(await renderVideo(video, [provider({ isConfigured: () => false, render })])).toMatchObject({ ok: false, providerRequired: true });
    expect(render).not.toHaveBeenCalled();
    expect(await renderVideo({ ...video, kind: 'post', video: null }, [provider()])).toMatchObject({ ok: false, message: 'Only a video concept can be turned into a video.' });
  });

  it('gives posts the owner’s photo or a branded graphic, and says it never makes realistic pictures', () => {
    expect(imageGenerationStatus.configured).toBe(true);
    expect(imageGenerationStatus.message).toMatch(/branded graphic/);
    expect(imageGenerationStatus.message).toMatch(/never makes realistic pictures/);
  });
});

describe('background providers (start, then check)', () => {
  const ctx = { tenantId: 'biz-1', contentId: 'c1' };
  const background = (overrides: Partial<VideoProvider> = {}): VideoProvider => ({ id: 'bg', label: 'Background Co', mode: 'standard', isConfigured: () => true, start: async () => ({ taskId: 'task-123456', estimatedCredits: 5, note: 'Generated footage.' }), retrieve: async () => ({ status: 'processing' }), describeError: (error) => (error instanceof Error ? error.message : 'failed'), ...overrides });

  it('starts a video without marking anything as made, passing the business along', async () => {
    const { startVideo } = await import('./providers');
    const start = vi.fn(async (..._args: unknown[]) => ({ taskId: 'task-123456', estimatedCredits: 5, note: 'Generated footage.' }));
    expect(await startVideo(video, ctx, [background({ start })])).toEqual({ ok: true, taskId: 'task-123456', provider: 'Background Co', estimatedCredits: 5, note: 'Generated footage.' });
    expect(start.mock.calls[0][2]).toEqual(ctx);
    expect(start.mock.calls[0][0]).toMatchObject({ mode: 'standard' });
  });
  it('never uses an AI provider for a normal video, and never swaps one mode for the other', async () => {
    const { startVideo } = await import('./providers');
    const ai = vi.fn(async () => ({ taskId: 'ai-task-0001', estimatedCredits: 50 }));
    const aiOnly = background({ id: 'ai', label: 'Fancy AI', mode: 'ai', start: ai });
    expect(await startVideo(video, ctx, [aiOnly])).toMatchObject({ ok: false, providerRequired: true });
    expect(ai).not.toHaveBeenCalled();
    expect(await startVideo(video, ctx, [aiOnly], 'ai')).toMatchObject({ ok: true, provider: 'Fancy AI' });
    expect(ai).toHaveBeenCalledTimes(1);
    const standard = vi.fn(async () => ({ taskId: 'std-task-0001', estimatedCredits: null }));
    expect(await startVideo(video, ctx, [background({ start: standard })], 'ai')).toMatchObject({ ok: false, providerRequired: true });
    expect(standard).not.toHaveBeenCalled();
  });
  it('treats a provider with no declared mode as AI, so it is never used by accident', async () => {
    const { startVideo } = await import('./providers');
    const unlabeled = background({ mode: undefined });
    expect(providerMode(unlabeled)).toBe('ai');
    expect(await startVideo(video, ctx, [unlabeled])).toMatchObject({ ok: false, providerRequired: true });
  });
  it('says a provider is needed when none can start videos, and reports failures with the provider’s own explanation', async () => {
    const { startVideo } = await import('./providers');
    expect(await startVideo(video, ctx, [])).toMatchObject({ ok: false, providerRequired: true });
    expect(await startVideo(video, ctx, [background({ isConfigured: () => false })])).toMatchObject({ ok: false, providerRequired: true });
    expect(await startVideo(video, ctx, [background({ start: async () => { throw new Error('Out of credits'); } })])).toEqual({ ok: false, providerRequired: false, message: 'The video was NOT started. Out of credits' });
    expect(await startVideo({ ...video, kind: 'post', video: null }, ctx, [background()])).toMatchObject({ ok: false, message: 'Only a video concept can be turned into a video.' });
  });
  it('checks on a started video with the provider that started it', async () => {
    const { checkVideo } = await import('./providers');
    const retrieve = vi.fn(async () => ({ status: 'succeeded' as const, url: 'https://cdn.example.com/v.mp4' }));
    expect(await checkVideo('task-123456', 'Background Co', ctx, [background({ retrieve })])).toEqual({ ok: true, provider: 'Background Co', state: { status: 'succeeded', url: 'https://cdn.example.com/v.mp4' } });
    expect(retrieve).toHaveBeenCalledWith('task-123456', ctx);
    expect(await checkVideo('t', 'Someone Else', ctx, [background()])).toMatchObject({ ok: false });
    expect(await checkVideo('t', 'Background Co', ctx, [background({ isConfigured: () => false })])).toMatchObject({ ok: false, message: expect.stringMatching(/not connected/) });
    expect(await checkVideo('t', 'Background Co', ctx, [background({ retrieve: async () => { throw new Error('boom'); } })])).toEqual({ ok: false, message: 'Could not check the video. boom' });
  });
  it('a background-only provider cannot be used for one-shot rendering', async () => {
    expect(await renderVideo(video, [background()])).toMatchObject({ ok: false });
  });
});
