import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ queue: [] as unknown[][], updates: [] as unknown[], inserts: [] as unknown[] }));
vi.mock('@/server/db/client.js', async () => ({ db: (await import('@/test/db-mock')).buildDb(state) }));

import { createGuidedBusiness, guidedAnswersFrom, onboardingContext, onboardingFacts } from './guided';

const good = { businessName: 'Somerset Pool', answers: { businessType: 'pool', channels: ['phone', 'referrals'], timeConsumers: ['scheduling', 'finance'], helpWanted: ['schedule', 'calls'], teamSize: '2-5', existingData: 'files' } };
const ok = (body: unknown) => { const result = guidedAnswersFrom(body); if ('error' in result) throw new Error(result.error); return result; };

describe('guided setup answers', () => {
  it('turns ids into readable answers, and records the voice feature only as a wish', () => {
    const answers = ok(good);
    expect(answers).toMatchObject({ businessName: 'Somerset Pool', businessType: 'Pool & outdoor services', channels: ['Phone calls', 'Referrals'], timeConsumers: ['Scheduling', 'Quotes & invoices'], teamSize: '2–5 people', existingData: 'Yes, I have files' });
    expect(answers.helpWanted[0]).toBe('Schedule my team');
    expect(answers.helpWanted[1]).toMatch(/^Answer missed calls \(not active yet/);
  });

  it('needs a business name and a business type, and the typed type when it is Other', () => {
    expect(guidedAnswersFrom({ ...good, businessName: '  ' })).toEqual({ error: 'Tell Pilot what your business is called to continue.' });
    expect(guidedAnswersFrom({ ...good, answers: { ...good.answers, businessType: '' } })).toMatchObject({ error: expect.stringMatching(/type of business/) });
    expect(guidedAnswersFrom({ ...good, answers: { ...good.answers, businessType: 'other', otherType: '' } })).toMatchObject({ error: expect.stringMatching(/what kind of business/) });
    expect(ok({ ...good, answers: { ...good.answers, businessType: 'other', otherType: 'Drone photography' } })).toMatchObject({ businessType: 'Drone photography', businessTypeDetail: 'Other (typed by the owner)' });
  });

  it('rejects anything that is not on the question lists', () => {
    expect(guidedAnswersFrom({ ...good, answers: { ...good.answers, channels: ['carrier pigeon'] } })).toMatchObject({ error: expect.stringMatching(/not recognised/) });
    expect(guidedAnswersFrom({ ...good, answers: { ...good.answers, teamSize: '9000' } })).toMatchObject({ error: expect.stringMatching(/team size/) });
    expect(guidedAnswersFrom({ ...good, answers: { ...good.answers, helpWanted: 'schedule' } })).toMatchObject({ error: expect.stringMatching(/not recognised/) });
    expect(guidedAnswersFrom(null)).toMatchObject({ error: expect.any(String) });
  });

  it('lets optional questions be skipped', () => {
    const answers = ok({ businessName: 'Bake Shop', answers: { businessType: 'food' } });
    expect(answers).toMatchObject({ businessType: 'Bakery / Food', channels: [], teamSize: '', existingData: '' });
    expect(onboardingFacts(answers).map((fact) => fact.predicate)).toEqual(['business type']);
  });
});

describe('creating the business', () => {
  beforeEach(() => { state.queue = []; state.inserts = []; });

  it('creates the profile, trial, knowledge and one fact per answer, all for the new business', async () => {
    state.queue = [[]]; // no existing profile
    const result = await createGuidedBusiness({ userId: 'user-1', email: 'owner@example.com' }, ok(good));
    expect(result.created).toBe(true);
    const rows = (state.inserts as unknown[]).flat() as Array<Record<string, any>>;
    const profile = rows.find((row) => row.userId === 'user-1')!;
    expect(profile).toMatchObject({ businessName: 'Somerset Pool', businessType: 'Pool & outdoor services', businessEmail: 'owner@example.com' });
    expect(JSON.parse(profile.customerChannels)).toEqual(['Phone calls', 'Referrals']);
    expect(JSON.parse(profile.communicationNeeds)[0]).toBe('Schedule my team');
    expect(rows.find((row) => row.planKey === 'trial')).toMatchObject({ businessProfileId: profile.id, status: 'trial' });
    const facts = rows.filter((row) => row.sourceType === 'onboarding');
    expect(facts.map((fact) => fact.predicate)).toEqual(['business type', 'team size', 'how new customers find the business', 'what takes the most time', 'wants Pilot to help with', 'existing business information']);
    expect(facts.every((fact) => fact.businessProfileId === profile.id && fact.status === 'accepted')).toBe(true);
  });

  it('never creates a second business for the same user', async () => {
    state.queue = [[{ id: 'existing-profile' }]];
    expect(await createGuidedBusiness({ userId: 'user-1', email: null }, ok(good))).toEqual({ id: 'existing-profile', created: false });
    expect(state.inserts).toEqual([]);
  });
});

describe('what Pilot can read', () => {
  beforeEach(() => { state.queue = []; });
  it('turns the saved answers into a note for Pilot, and says nothing when there are none', async () => {
    state.queue = [[{ predicate: 'team size', value: '2–5 people', details: null }, { predicate: 'what takes the most time', value: 'Scheduling', details: null }]];
    const context = await onboardingContext('biz-1');
    expect(context).toContain('team size: 2–5 people');
    expect(context).toContain('what takes the most time: Scheduling');
    state.queue = [[]];
    expect(await onboardingContext('biz-1')).toBe('');
  });
});
