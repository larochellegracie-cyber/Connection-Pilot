import { describe, expect, it } from 'vitest';
import { cleanImage, fitToPlatform, findUnsupportedClaims, itemToRow, rowToItem, stripUnsupportedClaims, type ContentItem } from './marketing-content';

const item: ContentItem = {
  id: 'p1', kind: 'video', platform: 'tiktok', status: 'approved', hook: 'Check these 5 things first', caption: 'Opening your pool this spring?', cta: 'Book your pool opening', hashtags: ['#poolopening'],
  suggestedVisual: 'Close-up of a pool cover coming off', postingFormat: 'Vertical video', topic: 'Pool opening', goal: 'Get more bookings', tone: 'Friendly', why: 'Pool opening is your most active service.',
  evidence: [{ label: 'Most active service', source: 'insight', detail: '14 pool opening bookings in the last 90 days' }], scheduledFor: '2026-10-24', scheduledTime: '10:30', image: null, approvedAt: '2026-10-21T12:00:00.000Z', publishedAt: null, campaign: 'week-1',
  video: { durationSeconds: 15, mode: 'standard', scenes: [{ seconds: 3, visual: 'Cover pulled back', onScreenText: '5 things to check' }], transitions: 'Quick cuts', audioDirection: 'Upbeat, no lyrics', render: { status: 'not_generated' } },
  createdAt: '2026-10-21T12:00:00.000Z', updatedAt: '2026-10-21T12:00:00.000Z',
};

describe('how content is kept in the existing table', () => {
  it('round-trips a video concept through the row columns and the envelope', () => {
    const row = itemToRow(item);
    expect(row).toMatchObject({ hook: 'Check these 5 things first', callToAction: 'Book your pool opening', platform: 'tiktok', planItemId: 'week-1' });
    const back = rowToItem({ id: 'p1', ...row, createdAt: new Date(item.createdAt), updatedAt: new Date(item.updatedAt) });
    expect(back).toEqual(item);
  });

  it('reads rows made before the envelope existed (a plain hashtag list) as drafts', () => {
    const old = rowToItem({ id: 'x', hook: 'h', caption: 'c', callToAction: 'a', suggestedVisual: 'v', platform: 'facebook', hashtagsJson: '["#a","#b"]', planItemId: null, createdAt: null, updatedAt: null });
    expect(old).toMatchObject({ kind: 'post', status: 'draft', hashtags: ['#a', '#b'], platform: 'facebook', video: null });
  });

  it('survives unreadable or hostile envelopes', () => {
    const odd = rowToItem({ id: 'x', hook: 'h', caption: 'c', callToAction: 'a', suggestedVisual: 'v', platform: 'myspace', hashtagsJson: '{"status":"deleted","scheduledFor":"tomorrow","kind":"video","video":{"render":{"status":"ready","url":"http://x"}}}', planItemId: null, createdAt: null, updatedAt: null });
    expect(odd).toMatchObject({ platform: 'instagram', status: 'draft', scheduledFor: null });
    expect(odd.video?.render).toEqual({ status: 'not_generated' }); // a "ready" video needs a real https file
    expect(rowToItem({ id: 'x', hook: 'h', caption: 'c', callToAction: 'a', suggestedVisual: 'v', platform: 'instagram', hashtagsJson: 'not json', planItemId: null, createdAt: null, updatedAt: null }).status).toBe('draft');
  });

  it('only counts a video as made when its render has a real https file', () => {
    const made = rowToItem({ id: 'x', hook: 'h', caption: 'c', callToAction: 'a', suggestedVisual: 'v', platform: 'instagram', hashtagsJson: JSON.stringify({ kind: 'video', video: { durationSeconds: 15, scenes: [], render: { status: 'ready', url: 'https://cdn.example.com/v.mp4', provider: 'acme' } } }), planItemId: null, createdAt: null, updatedAt: null });
    expect(made.video?.render).toEqual({ status: 'ready', url: 'https://cdn.example.com/v.mp4', provider: 'acme' });
  });
});

describe('video modes and links', () => {
  const row = (video: unknown) => rowToItem({ id: 'x', hook: 'h', caption: 'c', callToAction: 'a', suggestedVisual: 'v', platform: 'instagram', hashtagsJson: JSON.stringify({ kind: 'video', video }), planItemId: null, createdAt: null, updatedAt: null });
  it('defaults to Standard Video and only keeps AI when it was chosen', () => {
    expect(row({ scenes: [], render: {} })!.video?.mode).toBe('standard');
    expect(row({ mode: 'ai', scenes: [], render: {} })!.video?.mode).toBe('ai');
    expect(row({ mode: 'whatever', scenes: [], render: {} })!.video?.mode).toBe('standard');
  });
  it('accepts a Standard Video stored on this app, and nothing that only looks like one', () => {
    expect(row({ render: { status: 'ready', url: '/api/marketing/media/videos/3f8af353-c4f8-467b-b5ea-d703f92e7e66.mp4', provider: 'Standard Video' } })!.video?.render.status).toBe('ready');
    for (const url of ['/api/marketing/media/videos/../../secret.mp4', '/api/other/x.mp4', 'http://insecure.example.com/v.mp4', 'javascript:alert(1)', '//evil.example.com/v.mp4']) expect(row({ render: { status: 'ready', url } })!.video?.render.status).toBe('not_generated');
  });
});

describe('platform rules', () => {
  it('limits hashtags per platform and cleans them', () => {
    const fitted = fitToPlatform('facebook', { caption: 'Hello', hashtags: ['#pool', 'pool', 'Pool Opening!', '#spring', '#local', '#extra'] });
    expect(fitted.hashtags).toEqual(['#pool', '#PoolOpening', '#spring']);
  });
  it('keeps captions within the limit without cutting a word', () => {
    const long = 'word '.repeat(600);
    const fitted = fitToPlatform('instagram', { caption: long, hashtags: ['#a'] });
    expect(fitted.trimmed).toBe(true);
    expect(fitted.caption.length + fitted.hashtags.join(' ').length + 2).toBeLessThanOrEqual(2200);
    expect(fitted.caption.endsWith('…')).toBe(true);
  });
});

describe('no unsupported promises', () => {
  it('finds and removes claims about going viral or guaranteed results', () => {
    const copy = 'Your pool deserves care. This will go viral! We guarantee more bookings. Book your opening today.';
    expect(findUnsupportedClaims(copy)).toHaveLength(2);
    expect(stripUnsupportedClaims(copy)).toBe('Your pool deserves care. Book your opening today.');
    expect(findUnsupportedClaims('Book your pool opening this week.')).toEqual([]);
  });
});

import { applyAction, needsReviewAfterEdit } from './marketing-content';
const NOW = '2026-10-21T12:00:00.000Z';

describe('the approval flow', () => {
  const draft: ContentItem = { ...item, status: 'draft', approvedAt: null, publishedAt: null, scheduledFor: null };
  const ok = (result: ReturnType<typeof applyAction>) => { if ('error' in result) throw new Error(result.error); return result.item; };

  it('goes draft → approved → scheduled → published, and every step is the owner’s', () => {
    const approved = ok(applyAction(draft, { type: 'approve' }, NOW));
    expect(approved).toMatchObject({ status: 'approved', approvedAt: NOW });
    const scheduled = ok(applyAction(approved, { type: 'schedule', date: '2026-10-25' }, NOW));
    expect(scheduled).toMatchObject({ status: 'scheduled', scheduledFor: '2026-10-25' });
    const timed = applyAction({ ...draft, status: 'approved' }, { type: 'schedule', date: '2026-10-25', time: '09:15' }, 'now');
    expect((timed as { item: ContentItem }).item).toMatchObject({ scheduledFor: '2026-10-25', scheduledTime: '09:15' });
    expect(applyAction({ ...draft, status: 'approved' }, { type: 'schedule', date: '2026-10-25', time: '25:99' }, 'now')).toHaveProperty('error');
    const moved = applyAction((timed as { item: ContentItem }).item, { type: 'move', date: '2026-10-27' }, 'now');
    expect((moved as { item: ContentItem }).item).toMatchObject({ scheduledFor: '2026-10-27', scheduledTime: '09:15' }); // moving a day keeps the time
    const unscheduled = applyAction((timed as { item: ContentItem }).item, { type: 'move', date: null }, 'now');
    expect((unscheduled as { item: ContentItem }).item).toMatchObject({ scheduledFor: null, scheduledTime: null, status: 'approved' });
    const published = ok(applyAction(scheduled, { type: 'mark_published' }, NOW));
    expect(published).toMatchObject({ status: 'published', publishedAt: NOW });
  });

  it('will not schedule or publish content that was never approved', () => {
    expect(applyAction(draft, { type: 'schedule', date: '2026-10-25' }, NOW)).toEqual({ error: 'Approve this content before scheduling it.' });
    expect(applyAction(draft, { type: 'mark_published' }, NOW)).toEqual({ error: 'Approve this content before marking it as published.' });
  });

  it('approving content that already has a date puts it on the calendar', () => {
    expect(ok(applyAction({ ...draft, scheduledFor: '2026-10-24' }, { type: 'approve' }, NOW)).status).toBe('scheduled');
  });

  it('moves content to another day without changing its approval, and unscheduling returns it to approved', () => {
    const scheduled = { ...draft, status: 'scheduled' as const, scheduledFor: '2026-10-24' };
    expect(ok(applyAction(scheduled, { type: 'move', date: '2026-10-27' }, NOW))).toMatchObject({ status: 'scheduled', scheduledFor: '2026-10-27' });
    expect(ok(applyAction(scheduled, { type: 'move', date: null }, NOW))).toMatchObject({ status: 'approved', scheduledFor: null });
    expect(applyAction(scheduled, { type: 'move', date: 'next week' }, NOW)).toEqual({ error: 'Choose a valid date.' });
  });

  it('can send content back to draft, which clears approval', () => {
    expect(ok(applyAction({ ...draft, status: 'approved', approvedAt: NOW }, { type: 'back_to_draft' }, NOW))).toMatchObject({ status: 'draft', approvedAt: null });
  });

  it('asks for review again after the words of reviewed content are edited', () => {
    expect(['approved', 'scheduled', 'published'].every((status) => needsReviewAfterEdit(status as ContentItem['status']))).toBe(true);
    expect(needsReviewAfterEdit('draft')).toBe(false);
  });
});

describe('the picture kept with a post', () => {
  const post = { id: 'p', kind: 'post', platform: 'instagram', status: 'draft', hook: 'h', caption: 'c', cta: 'a', hashtags: [], suggestedVisual: 'v', postingFormat: '', topic: 't', goal: '', tone: '', why: '', evidence: [], scheduledFor: null, approvedAt: null, publishedAt: null, campaign: null, video: null, createdAt: '2026-10-21T12:00:00.000Z', updatedAt: '2026-10-21T12:00:00.000Z' } as ContentItem;
  it('is kept with the post and comes back', () => {
    const image = { url: '/api/marketing/media/images/abcdef12-3456.jpg', prompt: 'A calm pool at dusk' };
    const row = itemToRow({ ...post, image });
    expect(rowToItem({ id: 'p', ...row, createdAt: post.createdAt, updatedAt: post.updatedAt }).image).toEqual({ ...image, source: 'generated' });
  });
  it('only ever points at the business’s own picture files', () => {
    for (const url of ['https://evil.example.com/x.jpg', '/api/marketing/media/images/../../secret.jpg', 'javascript:alert(1)', '/api/marketing/media/images/abcdef12.png']) expect(cleanImage({ url, prompt: 'x' })).toBeNull();
    const row = itemToRow({ ...post, image: { url: 'https://evil.example.com/x.jpg', prompt: 'x' } });
    expect(rowToItem({ id: 'p', ...row, createdAt: post.createdAt, updatedAt: post.updatedAt }).image).toBeNull();
  });
});
