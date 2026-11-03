import { describe, expect, it } from 'vitest';
import { CONCEPT_BANK, cleanIdea, ideate, type IdeaInput } from './idea.js';
import { planVideo } from './plan.js';

const idea = (type: string, title: string, over: Record<string, unknown> = {}) => ({ type, title, logline: `${title} logline`, story: 'first this, then that, then the turn', scenes: 5, pacing: 'brisk', hook: 'a hook', payoff: 'a twist', cta: 'visit us', visual_style: 'stylised 3D', pictures: 'a cupcake', why: 'fits', vs_recent: 'different', ...over });
const input = (recent: string[] = []): IdeaInput => ({ request: 'Make me a Halloween video for my bakery', subject: 'Halloween', seconds: 15, business: { name: 'Maple & Rye', type: 'Bakery', location: '', services: [], description: '', tone: '' }, recent });
const DIRECTOR = /creative director who decides which idea ships/; const IDEATOR = /head of a top creative advertising agency/;

describe('the creative idea comes before the strategy', () => {
  it('keeps concept and style apart, offers a large expandable bank, and cleans what the model proposes', () => {
    expect(CONCEPT_BANK.length).toBeGreaterThan(35); expect(CONCEPT_BANK.map(([n]) => n)).toEqual(expect.arrayContaining(['mini story', 'fake movie trailer', 'stop-motion', 'match cut', 'wait for it']));
    expect(cleanIdea(idea('mystery', 'Who ate it?', { scenes: 99, pacing: 'frantic' }))).toMatchObject({ scenes: 14, pacing: 'measured' }); expect(cleanIdea({ type: 'x' })).toBeNull();
  });
  it('proposes several ideas, judges them against recent content, and picks the one that passes', async () => {
    const seen: string[] = [];
    const complete = async (system: string, prompt: string) => { seen.push(prompt); return IDEATOR.test(system) ? JSON.stringify({ ideas: [idea('product reveal', 'Reveal'), idea('mystery', 'Who ate it?'), idea('comedy', 'The cupcake that ran'), idea('countdown', 'Boo in 3')] }) : JSON.stringify({ verdicts: [1, 2, 3, 4].map((n) => ({ idea: n, different_from_recent: n !== 1, scroll_stop: n + 3, feasible: true, note: '' })), choice: 3, reason: 'the funniest' }); };
    const out = await ideate(input(['concept: product reveal "Spooky" | 6 scenes']), complete);
    expect(out.ideas).toHaveLength(4); expect(out.chosen?.title).toBe('The cupcake that ran'); expect(out.rounds).toBe(1); expect(seen[0]).toMatch(/RECENT CONTENT[\s\S]*product reveal "Spooky"/);
  });
  it('asks again, once, when nothing is different enough from what was made before', async () => {
    let proposals = 0;
    const complete = async (system: string) => { if (IDEATOR.test(system)) { proposals += 1; return JSON.stringify({ ideas: [idea(proposals === 1 ? 'product reveal' : 'fake movie trailer', `round ${proposals} a`), idea('comedy', `round ${proposals} b`)] }); } return JSON.stringify(proposals === 1 ? { verdicts: [], choice: 0, reason: 'all like the last video' } : { verdicts: [{ idea: 1, different_from_recent: true, scroll_stop: 9, feasible: true, note: '' }], choice: 1, reason: 'a trailer' }); };
    const out = await ideate(input(['concept: product reveal "x"']), complete);
    expect(proposals).toBe(2); expect(out.rounds).toBe(2); expect(out.chosen?.type).toBe('fake movie trailer'); expect(out.notes.join(' ')).toMatch(/none of the ideas passed the side-by-side test/);
  });
  it('hands the chosen idea to the strategy, which may be a single scene, and can stop there', async () => {
    const prompts: string[] = [];
    const strategy = { format: 'one continuous transformation', why: 'x', hook: 'h', narrative: 'n', beats: [{ purpose: 'it changes', share: 1, shows: 'one shot' }], visual: 'photo_led', visual_notes: 'x', visual_language: 'stylised 3D', pacing: 'slow', typography: { face: 'sans', treatment: 'x' }, colour_light: 'x', transitions: 'none', cta: 'none', ending: 'x', brand: 'end_card', assets: { coverage: 'sufficient', needed: 0, plan: [], generate: [], note: '' } };
    const complete = async (system: string, prompt: string) => { prompts.push(prompt); return IDEATOR.test(system) ? JSON.stringify({ ideas: [idea('transformation', 'Dough to ghost', { scenes: 1, pacing: 'slow' }), idea('comedy', 'b')] }) : DIRECTOR.test(system) ? JSON.stringify({ verdicts: [], choice: 1, reason: 'best' }) : JSON.stringify(strategy); };
    const plan = await planVideo({ ...input(), pictures: [], photos: [] } as never, complete, { stopAfter: 'strategy' });
    expect(plan.strategy?.beats).toHaveLength(1); expect(plan.strategy?.idea?.title).toBe('Dough to ghost'); expect(plan.concept).toBeNull();
    expect(prompts.some((p) => /THE CREATIVE IDEA \(authoritative[\s\S]*Dough to ghost/.test(p))).toBe(true);
  });
});
