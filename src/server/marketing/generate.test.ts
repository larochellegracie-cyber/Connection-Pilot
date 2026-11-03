import { describe, expect, it, vi } from 'vitest';
import { briefText, evidenceMenu, generateIdeas, generatePiece, generatePlan, GenerationError, resolveEvidence, type MarketingInput } from './generate';
import type { BusinessBrief } from './store';

const brief: BusinessBrief = {
  businessName: 'Somerset Pool Service', businessType: 'Pool & outdoor services', location: 'Kitchener, Ontario', website: 'https://somersetpools.example.com', description: 'Family-run pool opening, closing and weekly cleaning.',
  services: ['Pool opening', 'Weekly pool cleaning', 'Pool closing'], pricing: 'Openings from $250', targetCustomers: 'Homeowners with in-ground pools', sellingPoints: ['Same-week openings'], promotions: '', hours: 'Mon–Fri 8–5',
  brandVoice: { tone: 'Friendly, local', description: 'Talks like a neighbour' }, learned: ['Pool opening — price: 250 CAD'], websiteNotes: [], setupAnswers: ['team size: 2–5 people'], hasBusinessInformation: true, confirmedProfile: true,
};
const input = (overrides: Partial<MarketingInput> = {}): MarketingInput => ({
  brief, now: new Date('2026-03-10T16:00:00Z'), timezone: 'America/Toronto', existing: [],
  signals: [{ id: 'top:pool opening', kind: 'top_service', label: 'Pool opening is your most active service', detail: '14 bookings in the last 90 days.', service: 'Pool opening', asOf: '2026-03-10' }, { id: 'season:spring', kind: 'season', label: 'Spring begins in 10 days', detail: 'The spring season starts on March 20. This comes from the calendar, not from your records.', asOf: '2026-03-10' }],
  trends: [{ id: 't1', statement: 'Checklist-style short videos are a common format for seasonal service tips.', sources: [{ title: 'Source', url: 'https://example.com/a', publishedAt: '2026-02-20' }], confidence: 'medium', asOf: '2026-03-10' }],
  insights: [{ title: 'Three quotes are waiting', recommendation: 'Follow up on open quotes.' }], ...overrides,
});
const reply = (value: unknown) => vi.fn(async () => JSON.stringify(value));
const post = { hook: 'Opening your pool this spring?', caption: 'Pool opening season is almost here in Kitchener. We check the pump, the cover and the chemistry before the first swim.', cta: 'Book your pool opening with us.', hashtags: ['poolopening', '#Kitchener'], suggestedVisual: 'The crew lifting the winter cover off a customer pool', postingFormat: 'Reel' };

describe('what Pilot is told about the business', () => {
  it('uses the real brief: services, place, voice, learned facts and setup answers', () => {
    const text = briefText(input());
    for (const fragment of ['Somerset Pool Service', 'Kitchener, Ontario', 'Pool opening; Weekly pool cleaning; Pool closing', 'Brand voice: Friendly, local', 'Pool opening — price: 250 CAD', 'team size: 2–5 people']) expect(text).toContain(fragment);
  });
  it('offers real signals, current trends and insights as citable evidence', () => {
    const menu = evidenceMenu(input());
    expect(menu).toContain('top:pool opening [top_service] Pool opening is your most active service. 14 bookings in the last 90 days.');
    expect(menu).toContain('t1 [current trend, medium confidence, as of 2026-03-10]');
    expect(menu).toContain('i1 [business insight] Three quotes are waiting.');
    expect(evidenceMenu(input({ signals: [], trends: [], insights: [] }))).toBe('No signals available.');
  });
  it('turns cited ids into evidence and drops ids it does not know', () => {
    const evidence = resolveEvidence(['top:pool opening', 't1', 'i1', 'made-up'], input());
    expect(evidence.map((row) => row.source)).toEqual(['insight', 'trend', 'insight']);
    expect(evidence[1]).toMatchObject({ confidence: 'medium', url: 'https://example.com/a', asOf: '2026-03-10' });
    expect(resolveEvidence(['season:spring'], input())[0].source).toBe('season');
  });
});

describe('social posts', () => {
  it('writes a complete post for the chosen platform with the evidence behind it', async () => {
    const complete = reply(post);
    const piece = await generatePiece({ kind: 'post', platform: 'instagram', topic: 'Spring pool opening', tone: 'Friendly', goal: 'Get more bookings', evidenceIds: ['top:pool opening', 'season:spring'] }, input(), complete);
    expect(piece).toMatchObject({ kind: 'post', platform: 'instagram', hook: 'Opening your pool this spring?', cta: 'Book your pool opening with us.', tone: 'Friendly', goal: 'Get more bookings', video: null });
    expect(piece.hashtags).toEqual(['#poolopening', '#Kitchener']);
    expect(piece.evidence.map((row) => row.label)).toEqual(['Pool opening is your most active service', 'Spring begins in 10 days']);
    const [system, prompt] = complete.mock.calls[0] as unknown as [string, string];
    expect(system).toMatch(/Never call anything "trending" or "viral"/);
    expect(prompt).toContain('Create a Instagram POST');
    expect(prompt).toContain('Somerset Pool Service');
  });

  it('applies the platform’s limits and removes promises Pilot cannot keep', async () => {
    const wild = { ...post, caption: 'This will go viral! We guarantee more bookings. ' + 'Pool opening details. '.repeat(200), hashtags: ['a', 'b', 'c', 'd', 'e', 'f'] };
    const piece = await generatePiece({ kind: 'post', platform: 'facebook', topic: 'Opening' }, input(), reply(wild));
    expect(piece.caption).not.toMatch(/viral|guarantee/i);
    expect(piece.hashtags).toHaveLength(3);
    expect(piece.caption.length + piece.hashtags.join(' ').length).toBeLessThanOrEqual(2000);
  });

  it('falls back to what the business really is when no evidence was cited', async () => {
    const piece = await generatePiece({ kind: 'post', platform: 'linkedin', topic: 'About us' }, input({ signals: [], trends: [], insights: [] }), reply(post));
    expect(piece.evidence).toEqual([{ label: 'About your business', source: 'business', detail: 'Your services include Pool opening, Weekly pool cleaning, Pool closing.' }]);
  });

  it('refuses incomplete or unreadable answers instead of saving empty content', async () => {
    await expect(generatePiece({ kind: 'post', platform: 'instagram', topic: 'x' }, input(), reply({ hook: 'Only a hook' }))).rejects.toBeInstanceOf(GenerationError);
    await expect(generatePiece({ kind: 'post', platform: 'instagram', topic: 'x' }, input(), async () => 'I cannot help with that')).rejects.toBeInstanceOf(GenerationError);
  });
});

describe('video concepts', () => {
  const video = { ...post, video: { durationSeconds: 15, scenes: [{ seconds: 3, visual: 'Winter cover being pulled back', onScreenText: '5 things to check first', voiceover: 'Before you open your pool…' }, { seconds: 4, visual: 'Testing the pump', onScreenText: '1. The pump' }, { seconds: 8, visual: 'Crew with the clean pool', onScreenText: 'Book your opening' }], transitions: 'Quick cuts on the beat', audioDirection: 'Upbeat, no lyrics' } };

  it('writes a storyboard with hook, scenes, on-screen text, audio, caption and call to action, and says no video exists yet', async () => {
    const piece = await generatePiece({ kind: 'video', platform: 'tiktok', topic: '5 pool opening checks' }, input(), reply(video));
    expect(piece.kind).toBe('video');
    expect(piece.video).toMatchObject({ durationSeconds: 15, transitions: 'Quick cuts on the beat', audioDirection: 'Upbeat, no lyrics', render: { status: 'not_generated' } });
    expect(piece.video!.scenes).toHaveLength(3);
    expect(piece.video!.scenes[0]).toMatchObject({ seconds: 3, onScreenText: '5 things to check first' });
    expect(piece).toMatchObject({ hook: 'Opening your pool this spring?', cta: 'Book your pool opening with us.' });
    expect(piece.caption).toBeTruthy();
  });

  it('needs a usable video plan', async () => {
    await expect(generatePiece({ kind: 'video', platform: 'tiktok', topic: 'x' }, input(), reply({ ...post, video: { scenes: [{ seconds: 3, visual: 'one scene' }] } }))).rejects.toThrow(/usable video plan/);
  });
});

describe('content ideas', () => {
  it('explains what, why, format, hook and call to action, grounded in real evidence', async () => {
    const complete = reply({ ideas: [
      { title: 'Spring Pool Opening Checklist', why: 'Pool opening is your most active service and spring begins soon.', format: 'video', platform: 'tiktok', hook: 'Don’t open your pool until you check these 5 things.', cta: 'Book your pool opening with us.', goal: 'Seasonal content', evidenceIds: ['top:pool opening', 'season:spring', 'nope'] },
      { title: 'Our crew at work', why: 'Shows who you are.', format: 'post', platform: 'facebook', hook: 'Meet the crew', cta: 'Call us', goal: 'Build trust', evidenceIds: [] },
      { title: '', why: 'missing title' },
    ] });
    const ideas = await generateIdeas(input(), complete);
    expect(ideas).toHaveLength(2);
    expect(ideas[0]).toMatchObject({ title: 'Spring Pool Opening Checklist', format: 'video', platform: 'tiktok', goal: 'Seasonal content' });
    expect(ideas[0].evidence.map((row) => row.detail)).toEqual(['14 bookings in the last 90 days.', 'The spring season starts on March 20. This comes from the calendar, not from your records.']);
    expect(ideas[1].evidence[0].source).toBe('business');
  });
  it('does not return ideas when nothing usable came back', async () => {
    await expect(generateIdeas(input(), reply({ ideas: [] }))).rejects.toBeInstanceOf(GenerationError);
  });
});

describe('the weekly content plan', () => {
  const item = (date: string, extra: Record<string, unknown> = {}) => ({ date, kind: 'post', platform: 'instagram', topic: 'Pool opening', goal: 'Seasonal content', why: 'Spring begins soon.', evidenceIds: ['season:spring'], ...post, ...extra });
  it('proposes pieces on real upcoming dates, each with its reason, and drops invalid ones', async () => {
    const complete = reply({ items: [item('2026-03-11'), item('2026-03-13', { kind: 'video', platform: 'tiktok', video: { scenes: [{ seconds: 3, visual: 'a', onScreenText: 'b' }, { seconds: 4, visual: 'c', onScreenText: 'd' }] } }), item('2026-02-01'), item('2026-06-01'), item('not a date'), item('2026-03-12', { caption: '' })] });
    const plan = await generatePlan(input(), complete);
    expect(plan.map((row) => [row.date, row.kind, row.platform])).toEqual([['2026-03-11', 'post', 'instagram'], ['2026-03-13', 'video', 'tiktok']]);
    expect(plan[0].why).toBe('Spring begins soon.');
    expect(plan[0].evidence[0].label).toBe('Spring begins in 10 days');
  });
  it('tells Pilot what content already exists so it does not repeat it', async () => {
    const complete = reply({ items: [item('2026-03-11')] });
    await generatePlan(input({ existing: [{ id: 'x', kind: 'post', platform: 'instagram', status: 'draft', hook: 'Old hook', caption: 'c', cta: 'a', hashtags: [], suggestedVisual: 'v', postingFormat: '', topic: 'Winter closing tips', goal: '', tone: '', why: '', evidence: [], scheduledFor: null, approvedAt: null, publishedAt: null, campaign: null, video: null, createdAt: '2026-03-05T00:00:00.000Z', updatedAt: '2026-03-05T00:00:00.000Z' }] }), complete);
    expect((complete.mock.calls[0] as unknown as [string, string])[1]).toContain('1 in the last 14 days');
    expect((complete.mock.calls[0] as unknown as [string, string])[1]).toContain('Winter closing tips');
  });
  it('fails clearly when no valid plan comes back', async () => {
    await expect(generatePlan(input(), reply({ items: [] }))).rejects.toBeInstanceOf(GenerationError);
  });
});
