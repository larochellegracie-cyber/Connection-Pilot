import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { cleanShot, conceptPlan, sanitizeConcept, writeConcept, type Concept, type ConceptInput } from './concept.js';
import { creativeText, critique, writeScript, type CodeBrief } from './generate.js';
import { renderCodeVideo, strategyProblems } from './index.js';
import { planVideo } from './plan.js';
import { RUNTIME_DIR, codeVideoSupport } from './sandbox.js';
import { coverageIssue, cleanStrategy, conceptIssues, fingerprintOf, lookOf, strategyText, writeStrategy, type Strategy } from './strategy.js';

const run = promisify(execFile);
const python = path.join(process.cwd(), '.venv-codevideo/bin/python');
const fontDir = () => path.join(path.dirname(createRequire(path.join(process.cwd(), 'package.json')).resolve('@fontsource/inter/package.json')), 'files');

const pictures = [{ id: 'pic-aaaa', label: 'Cupcake tray', shows: 'three cupcakes', relevance: 9, quality: 8, best_use: 'hero', provenance: 'ai_image' }, { id: 'pic-bbbb', label: 'Cake', shows: 'a tiered cake', relevance: 6, quality: 8, best_use: 'support', provenance: 'ai_image' }];
const rawStrategy = (over: Record<string, unknown> = {}) => ({ format: 'fast product reveal', why: 'a reel', hook: 'a macro', narrative: 'tease, show, close', beats: [{ purpose: 'hook', share: 0.2 }, { purpose: 'show', share: 0.5 }, { purpose: 'close', share: 0.3 }], visual: 'photo_led', visual_notes: 'x', pacing: 'brisk', typography: { face: 'sans', treatment: 'big' }, colour_light: 'warm', transitions: 'whips', cta: 'none', ending: 'name', brand: 'end_card', assets: { coverage: 'sufficient', plan: [{ id: 'pic-aaaa', role: 'hero', max_uses: 2, why: 'the product' }, { id: 'nope', role: 'hero', max_uses: 9 }, { id: 'pic-bbbb', role: 'unused', max_uses: 1, why: 'wrong product' }], generate: [], note: '' }, ...over });
const strategy = (over: Record<string, unknown> = {}) => cleanStrategy(rawStrategy(over), pictures.map((p) => p.id))!;
const business = { name: 'Maple & Rye', type: 'Bakery', location: '', services: [], description: '', tone: '' };
const input = (over: Partial<ConceptInput> = {}): ConceptInput => ({ request: 'x', subject: 'cupcakes', seconds: 15, business, photos: pictures.map((p) => ({ id: p.id, label: p.label })), props: [], ...over });
const scene = (i: number, extra: Record<string, unknown> = {}) => ({ role: 'scene', seconds: 3, headline: `Line ${'abcdefghijklmn'[i]}`, subtext: '', items: [], visual: `v${i}`, photo: 'pic-aaaa', shot: { purpose: 'p', subject: 's', lighting: 'l', composition: 'full_frame_image', text: 'headline' }, ...extra });

describe('the creative strategy', () => {
  it('is cleaned: at least one beat, a known visual approach, shares normalised, unknown pictures dropped, uses capped', () => {
    const s = strategy();
    expect(s.beats.map((b) => b.share).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 2); expect(s.assets.plan.map((p) => p.id)).toEqual(['pic-aaaa', 'pic-bbbb']); expect(s.assets.plan[0]).toMatchObject({ role: 'hero', max_uses: 2 });
    expect(cleanStrategy(rawStrategy({ beats: [] }), ['pic-aaaa'])).toBeNull(); expect(cleanStrategy(rawStrategy({ beats: [{ purpose: 'one continuous shot', share: 1 }] }), ['pic-aaaa'])?.beats).toHaveLength(1); expect(cleanStrategy(rawStrategy({ visual: 'cinematic' }), [])).toBeNull(); expect(cleanStrategy('nope', [])).toBeNull();
    expect(cleanStrategy(rawStrategy({ assets: { plan: [{ id: 'pic-aaaa', role: 'hero', max_uses: 99 }] } }), ['pic-aaaa'])!.assets.plan[0].max_uses).toBe(8);
  });
  it('decides the look: graphics and type are motion graphics, pictures and mixed are picture-led', () => {
    expect([lookOf(strategy({ visual: 'graphic_led' })), lookOf(strategy({ visual: 'typographic' })), lookOf(strategy({ visual: 'photo_led' })), lookOf(strategy({ visual: 'mixed' }))]).toEqual(['motion', 'motion', 'photo', 'photo']);
  });
  it('is asked for with the pictures as they were looked at and the recent structures, and offers no menu of templates to choose from', async () => {
    let system = ''; let prompt = '';
    await writeStrategy({ request: 'Halloween cupcakes', subject: 'cupcakes', seconds: 15, platform: 'instagram', style: ['fun'], business, pictures, recent: ['fast product reveal | photo_led | 5 scenes'] }, async (s, p) => { system = s; prompt = p; return JSON.stringify(rawStrategy()); });
    expect(prompt).toMatch(/pic-aaaa: "Cupcake tray".*shows: three cupcakes.*suits this request 9\/10/); expect(prompt).toMatch(/RECENT VIDEOS/); expect(prompt).toMatch(/Platform: instagram/);
    expect(system).toMatch(/never a menu to pick from/); expect(system).toMatch(/Do not fall back on/); expect(system).toMatch(/Never fill scenes with a picture just because it exists/);
  });
});

describe('the storyboard follows the strategy, and the structure is the model’s', () => {
  it('accepts 2 scenes and 12 scenes, very short ones, and leaves the last scene’s words to its shot (no forced business-name sign-off)', () => {
    const s = strategy({ pacing: 'rapid' });
    const rapid = sanitizeConcept({ scenes: Array.from({ length: 12 }, (_, i) => scene(i, { seconds: 1.2 })) }, input({ strategy: s }))!;
    expect(rapid.scenes).toHaveLength(12); expect(rapid.scenes[0].role).toBe('hook'); expect(rapid.scenes.at(-1)!.role).toBe('closing'); expect(rapid.scenes.at(-1)!.headline).toBe('Line l'); expect(Math.min(...rapid.scenes.map((x) => x.seconds))).toBeGreaterThanOrEqual(0.6);
    const two = sanitizeConcept({ scenes: [scene(0, { seconds: 7 }), scene(1, { seconds: 8 })] }, input({ strategy: strategy({ pacing: 'slow' }) }))!;
    expect(two.scenes).toHaveLength(2);
  });
  it('never gives a scene the hero just to fill it: a scene with no picture, or one the plan marked unused, has none, and cannot be a picture composition', () => {
    const concept = sanitizeConcept({ scenes: [scene(0), scene(1, { photo: null, shot: { purpose: 'p', subject: 's', lighting: 'l', composition: 'detail_crop', camera: 'push_in', crop: 'tight', text: 'headline' } }), scene(2, { photo: 'pic-bbbb' }), scene(3, { photo: null, shot: { purpose: 'p', subject: 's', lighting: 'l', composition: 'typographic', text: 'type_only' } })] }, input({ strategy: strategy() }))!;
    expect(concept.scenes.map((x) => x.photoId)).toEqual(['pic-aaaa', null, null, null]);
    expect(concept.scenes[1].shot).toMatchObject({ composition: 'graphic_motion', camera: 'static' }); expect(concept.scenes[1].shot).not.toHaveProperty('crop'); expect(concept.scenes[3].shot!.composition).toBe('typographic');
  });
  it('carries the strategy with the storyboard, and the older path (no strategy) still works as before', () => {
    const s = strategy(); expect(sanitizeConcept({ scenes: [scene(0), scene(1)] }, input({ strategy: s }))!.strategy).toBe(s);
    const legacy = sanitizeConcept({ scenes: [scene(0), scene(1), scene(2)] }, input())!; expect(legacy.scenes.at(-1)).toMatchObject({ role: 'closing', headline: 'Maple & Rye' }); expect(legacy.strategy).toBeUndefined();
  });
  it('tells the storyboard writer the strategy is authoritative and gives it back what it got wrong', async () => {
    const seen: string[] = []; const s = strategy();
    await writeConcept(input({ strategy: s, feedback: ['The picture pic-aaaa is in 4 of 5 scenes but the asset plan allows it 2.'] }), async (system, prompt) => { seen.push(system, prompt); return JSON.stringify({ scenes: [scene(0), scene(1)] }); });
    expect(seen[0]).toMatch(/AUTHORITATIVE/); expect(seen[0]).not.toMatch(/4 to 7 scenes/); expect(seen[0]).not.toMatch(/business name as the headline/); expect(seen[1]).toMatch(/CREATIVE STRATEGY/); expect(seen[1]).toMatch(/YOUR LAST STORYBOARD DID NOT FOLLOW THIS STRATEGY[\s\S]*pic-aaaa is in 4 of 5/);
  });
});

describe('a storyboard is held to its own strategy, and to nothing else', () => {
  const concept = (n: number, seconds: number, photos: Array<string | null>, composition = 'full_frame_image'): Concept => ({ title: 't', mood: 'm', palette: {} as never, seconds, scenes: Array.from({ length: n }, (_, i) => ({ role: 'scene', seconds: seconds / n, headline: 'h', subtext: '', items: [], visual: 'v', photoId: photos[i % photos.length], shot: { purpose: 'p', subject: 's', lighting: 'l', composition: composition as never }, transition: 'fade' })) });
  it('flags a picture used more than planned, a pace that is not the pace chosen, and a visual approach the scenes do not follow', () => {
    const s = strategy({ pacing: 'brisk', visual: 'photo_led' });
    expect(conceptIssues(concept(5, 15, ['pic-aaaa']), s).join(' ')).toMatch(/pic-aaaa is in 5 of 5 scenes but the asset plan allows it 2/);
    expect(conceptIssues(concept(3, 15, ['pic-aaaa', null, null]), strategy({ pacing: 'brisk', visual: 'photo_led', assets: { plan: [{ id: 'pic-aaaa', role: 'hero', max_uses: 4 }] } })).join(' ')).toMatch(/pace is "brisk"/);
    expect(conceptIssues(concept(5, 15, [null]), strategy({ visual: 'photo_led', pacing: 'measured' })).join(' ')).toMatch(/photo_led.*only 0 of 5/);
    expect(conceptIssues(concept(5, 15, ['pic-aaaa', 'pic-bbbb']), strategy({ visual: 'graphic_led', pacing: 'measured', assets: { plan: [{ id: 'pic-aaaa', role: 'hero', max_uses: 4 }, { id: 'pic-bbbb', role: 'support', max_uses: 4 }] } })).join(' ')).toMatch(/graphic_led.*5 scenes are built on a picture/);
  });
  it('has no opinion about the number of scenes: 3 long ones for a slow film and 12 short ones for a rapid reel are both fine', () => {
    const open = { assets: { plan: [{ id: 'pic-aaaa', role: 'hero', max_uses: 8 }, { id: 'pic-bbbb', role: 'support', max_uses: 8 }] } };
    expect(conceptIssues(concept(3, 15, ['pic-aaaa', 'pic-bbbb']), strategy({ pacing: 'slow', visual: 'photo_led', ...open }))).toEqual([]);
    expect(conceptIssues(concept(12, 15, ['pic-aaaa', 'pic-bbbb']), strategy({ pacing: 'rapid', visual: 'photo_led', ...open }))).toEqual([]);
  });
});

describe('planning a video: strategy, then storyboard, then at most one correction', () => {
  const answer = (calls: Array<{ system: string; prompt: string }>, scenes: unknown[], strategyReply: unknown = rawStrategy({ pacing: 'measured' })) => async (system: string, prompt: string) => { if (/check the on-screen words/.test(system)) return JSON.stringify({ problems: [] }); if (/art director checking a storyboard/.test(system)) return JSON.stringify({ scenes: [] }); if (/head of a top creative advertising agency/.test(system)) return JSON.stringify({ ideas: [] }); calls.push({ system, prompt }); return /creative director\. Before any scene/.test(system) ? JSON.stringify(strategyReply) : JSON.stringify({ scenes }); };
  const base = () => ({ ...input(), pictures });
  it('makes the strategy first, then a storyboard from it', async () => {
    const calls: Array<{ system: string; prompt: string }> = [];
    const plan = await planVideo(base(), answer(calls, [scene(0, { seconds: 4 }), scene(1, { seconds: 4, photo: null, shot: { purpose: 'p', subject: 's', lighting: 'l', composition: 'typographic', text: 'type_only' } }), scene(2, { seconds: 4, photo: 'pic-aaaa' }), scene(3, { seconds: 3, photo: null, shot: { purpose: 'p', subject: 's', lighting: 'l', composition: 'typographic', text: 'type_only' } })], rawStrategy({ pacing: 'measured', visual: 'mixed' })));
    expect(plan.strategy?.format).toBe('fast product reveal'); expect(plan.concept?.scenes).toHaveLength(4); expect(plan.concept?.strategy).toBe(plan.strategy);
    expect(calls).toHaveLength(2); expect(calls[1].prompt).toMatch(/CREATIVE STRATEGY/); expect(calls[1].prompt).toMatch(/pic-aaaa: Cupcake tray/); expect(calls[1].prompt).not.toMatch(/pic-bbbb: Cake/); // the picture the plan marked unused is not offered
  });
  it('sends a storyboard that breaks its strategy back once, with what was wrong, and uses the corrected one', async () => {
    const calls: Array<{ system: string; prompt: string }> = []; let storyboards = 0;
    const complete = async (system: string, prompt: string) => { if (/check the on-screen words/.test(system)) return JSON.stringify({ problems: [] }); if (/art director checking a storyboard/.test(system)) return JSON.stringify({ scenes: [] }); if (/head of a top creative advertising agency/.test(system)) return JSON.stringify({ ideas: [] }); calls.push({ system, prompt }); if (/creative director\. Before any scene/.test(system)) return JSON.stringify(rawStrategy({ pacing: 'measured', visual: 'mixed' })); storyboards += 1; return JSON.stringify({ scenes: storyboards === 1 ? [0, 1, 2, 3, 4].map((i) => scene(i, { seconds: 3 })) : [scene(0, { seconds: 4 }), scene(1, { seconds: 4, photo: null, shot: { purpose: 'p', subject: 's', lighting: 'l', composition: 'typographic', text: 'type_only' } }), scene(2, { seconds: 4 }), scene(3, { seconds: 3, photo: null, shot: { purpose: 'p', subject: 's', lighting: 'l', composition: 'typographic', text: 'type_only' } })] }); };
    const plan = await planVideo(base(), complete);
    expect(calls).toHaveLength(3); expect(calls[2].prompt).toMatch(/DID NOT FOLLOW THIS STRATEGY[\s\S]*pic-aaaa is in 5 of 5 scenes/); expect(plan.concept?.scenes).toHaveLength(4); expect(plan.notes.join(' ')).toMatch(/one correction fixed it/);
  });
  it('plans without a strategy, rather than failing, when the model cannot make one', async () => {
    const calls: string[] = [];
    const plan = await planVideo(base(), async (system) => { calls.push(system); return /creative director\. Before any scene/.test(system) ? 'not json' : JSON.stringify({ scenes: [scene(0), scene(1), scene(2)] }); });
    expect(plan.strategy).toBeNull(); expect(plan.concept?.scenes).toHaveLength(4); expect(plan.notes.join(' ')).toMatch(/without one/);
  });
  it('describes a finished structure in one line for the next plan', () => {
    const line = fingerprintOf(strategy(), { ...sanitizeConcept({ scenes: [scene(0), scene(1)] }, input({ strategy: strategy() }))! });
    expect(line).toMatch(/fast product reveal \| language: unspecified \| photo_led, pace brisk \| 2 scenes of about \d/); expect(strategyText(strategy())).toMatch(/Pictures: sufficient.*pic-aaaa as hero \(at most 2 scenes/);
  });
});

describe('the code writer is told the strategy, and nothing contradicts it', () => {
  const mk = (strat: Strategy | undefined, look?: 'photo' | 'motion'): CodeBrief => ({ width: 1080, height: 1920, fps: 30, ffmpeg: '', font_dir: '', out: '', brand: { name: 'Maple & Rye' }, palette: {}, assets: { p1: 'x' }, scenes: [{ role: 'hook', seconds: 3, headline: 'Hi', subtext: '', items: [], photo: 'p1', visual: 'v' }], total_seconds: 3, ...(strat ? { strategy: strat } : {}), ...(look ? { look } : {}) });
  const ask = async (brief: CodeBrief) => { const seen = { system: '', prompt: '' }; await writeScript({ brief, style: 'custom', complete: async (system, prompt) => { seen.system = system; seen.prompt = prompt; return { text: 'def build(video):\n    pass' }; }, check: async () => [], direction: 'DIRECTION-TEXT' }); return seen; };
  it('uses neutral rules, with no house look, when there is a strategy, and states the visual approach as authority', async () => {
    const graphic = await ask(mk(strategy({ visual: 'graphic_led' })));
    expect(graphic.system).toMatch(/You do NOT impose a house look/); expect(graphic.system).not.toMatch(/start every scene with c\.studio/); expect(graphic.system).not.toMatch(/No cards of service lists/); expect(graphic.system).toMatch(/READABILITY/);
    expect(graphic.prompt).toMatch(/CREATIVE STRATEGY \(decided first, authoritative/); expect(graphic.prompt).toMatch(/THIS IS A MOTION-GRAPHICS VIDEO/);
    expect((await ask(mk(strategy({ visual: 'photo_led' })))).prompt).toMatch(/THIS IS A PICTURE-LED VIDEO/); expect((await ask(mk(strategy({ visual: 'mixed' })))).prompt).toMatch(/THIS IS A MIXED VIDEO/); expect((await ask(mk(strategy({ visual: 'typographic' })))).prompt).toMatch(/THIS IS A TYPE-LED VIDEO/);
  });
  it('still uses the older rules when there is no strategy', async () => { expect((await ask(mk(undefined))).system).toMatch(/must NOT look like a business template/); });
});

describe('the checks follow the strategy’s visual approach and have no other taste', () => {
  const kit = 'def build(video):\n    def a(c, t, u):\n        c.card(0, 0, 9, 9)\n        c.chip("x", 1, 1)\n        c.mark("yes", 1, 1)\n    video.add_scene(3, a, "fade")';
  const pics = 'def build(video):\n    def a(c, t, u):\n        c.camera("p1", u, "push", 1.0, t)\n    video.add_scene(3, a, "fade")';
  it('graphic-led needs the kit, photo-led needs pictures, mixed needs both, serif needs a serif face', () => {
    expect(strategyProblems(kit, strategy({ visual: 'graphic_led' }))).toEqual([]); expect(strategyProblems(pics, strategy({ visual: 'graphic_led' })).join(' ')).toMatch(/at least three kinds of piece/);
    expect(strategyProblems(pics, strategy({ visual: 'photo_led' }))).toEqual([]); expect(strategyProblems(kit, strategy({ visual: 'photo_led' })).join(' ')).toMatch(/never shows one/);
    expect(strategyProblems(kit, strategy({ visual: 'mixed' })).join(' ')).toMatch(/shows no picture/); expect(strategyProblems(`${kit}\n${pics}`, strategy({ visual: 'mixed' }))).toEqual([]);
    expect(strategyProblems(pics, strategy({ visual: 'photo_led', typography: { face: 'serif', treatment: 'x' } })).join(' ')).toMatch(/face="serif"/); expect(strategyProblems(`${pics}\n# c.text(x, face="serif")`, strategy({ visual: 'photo_led', typography: { face: 'serif', treatment: 'x' } }))).toEqual([]);
  });
  it('no longer demands two live transitions, three camera moves or the picture in three scenes', () => {
    const plain = 'def build(video):\n    def a(c, t, u):\n        c.camera("p1", u, "push", 1.0, t)\n    video.add_scene(3, a, "fade")\n    video.add_scene(3, a, "fade")\n    video.add_scene(3, a, "fade")';
    expect(strategyProblems(plain, strategy({ visual: 'photo_led' }))).toEqual([]);
  });
});

describe('the design review judges creative quality too', () => {
  const brief = { width: 1080, height: 1920, fps: 30, ffmpeg: '', font_dir: '', out: '', brand: { name: 'S' }, palette: {}, assets: {}, scenes: [0, 1, 2].map((i) => ({ role: 'scene', seconds: 3, headline: `H${i}`, subtext: '', items: [], photo: 'p1', visual: 'v' })), total_seconds: 9, platform: 'instagram', recent: ['luxury film | photo_led'], strategy: strategy() } as CodeBrief;
  it('is given the platform, strategy, recent structures and exact picture use, and returns scored aspects with what is wrong and the fix', async () => {
    let prompt = ''; let system = '';
    const result = await critique({ sheet: Buffer.from('x'), brief, complete: async (s, p) => { system = s; prompt = p; return { text: JSON.stringify({ score: 5, creative: [{ aspect: 'hook', score: 3, note: 'the opening is a slow dark photo', fix: 'open on the macro' }, { aspect: 'variety', score: 8, note: '', fix: '' }, { aspect: '', score: 5 }], findings: [] }) }; } });
    expect(prompt).toMatch(/Platform: instagram/); expect(prompt).toMatch(/PICTURE USE\np1 in 3 of 3 scenes/); expect(prompt).toMatch(/RECENT VIDEOS[\s\S]*luxury film/); expect(prompt).toMatch(/THE CREATIVE STRATEGY/);
    expect(system).toMatch(/CREATIVE QUALITY/); expect(system).toMatch(/real marketing asset/); expect(system).toMatch(/differ from the RECENT VIDEOS/);
    expect(result?.creative?.map((c) => c.aspect)).toEqual(['hook', 'variety']); expect(result?.creative_overall).toBe(5.5);
    expect(creativeText(result!.creative![0])).toBe('Creative review (hook, 3/10): the opening is a slow dark photo. Fix: open on the macro');
  });
});

describe('a runtime API mistake comes back with what the method really takes', () => {
  it('names the real signature when an argument does not exist, and suggests close names for a method that does not', async () => {
    if (!existsSync(python)) return;
    const dir = await mkdtemp(path.join(os.tmpdir(), 'hint-')); try {
      const go = async (body: string) => { const brief = { width: 270, height: 480, fps: 30, ffmpeg: 'x', font_dir: fontDir(), out: path.join(dir, 'o.mp4'), brand: { name: 'S' }, assets: {}, palette: { dark: true, bg_a: '#071033', bg_b: '#0E1B4D', text: '#FFFFFF', accent: '#2F6BFF', on_accent: '#FFFFFF', glow: '#3D6BFF', glow2: '#80B0FF', scrim: '#071033' }, preview_dir: dir, preview_times: [1], scenes: [{ role: 'scene', seconds: 3, headline: 'x', subtext: '', items: [], photo: null, visual: null }], total_seconds: 3 };
        await writeFile(path.join(dir, 'b.json'), JSON.stringify(brief)); await writeFile(path.join(dir, 's.py'), body);
        const { stdout } = await run(python, ['-I', path.join(RUNTIME_DIR, 'runner.py'), path.join(dir, 'b.json'), path.join(dir, 's.py'), '--preview'], { env: {}, timeout: 60_000 }).catch((e) => ({ stdout: String(e.stdout ?? '') })); return JSON.parse(stdout.trim().split('\n').pop() || '{}') as { errors?: string[] }; };
      const wrong = await go('def build(video):\n    def a(c, t, u):\n        c.icon("tick", 10, 10, 40, "#FFFFFF", None, delay=0.5)\n    video.add_scene(3, a, "fade")');
      expect(wrong.errors?.[0]).toMatch(/unexpected keyword argument 'delay'.*Check the toolkit reference: c\.icon\(kind, x, y, size, color='#FFFFFF', disc=None, alpha=1\.0\)\. It has no argument called delay/);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

describe('the brand logo rule follows the strategy', () => {
  it('requires the logo in the last scene only for an end card, and in every scene for a corner mark', async () => {
    if (!existsSync(python)) return;
    const dir = await mkdtemp(path.join(os.tmpdir(), 'logo-rule-')); try {
      const go = async (rule: string) => { const brief = { width: 540, height: 960, fps: 30, ffmpeg: 'x', font_dir: fontDir(), out: path.join(dir, 'o.mp4'), brand: { name: 'Somerset' }, assets: {}, palette: { dark: true, bg_a: '#071033', bg_b: '#0E1B4D', text: '#FFFFFF', accent: '#2F6BFF', on_accent: '#FFFFFF', glow: '#3D6BFF', glow2: '#80B0FF', scrim: '#071033' }, require_motion: true, logo_rule: rule, scenes: [{ role: 'hook', seconds: 3, headline: 'Alpha', subtext: '', items: [], photo: null, visual: null }, { role: 'closing', seconds: 3, headline: 'Beta', subtext: '', items: [], photo: null, visual: null }], total_seconds: 6 };
        await writeFile(path.join(dir, 'b.json'), JSON.stringify(brief)); await writeFile(path.join(dir, 's.py'), 'def build(video):\n    b = video.brief["scenes"]\n    def a(c, t, u):\n        c.gradient("#071033", "#0E1B4D", 180)\n        c.rect(84, 300, 900 * ((t % 2.0) / 2.0), 30, "#2F6BFF")\n        c.text(b[0]["headline"], 84, 700, 100, 800, "#FFFFFF")\n    def d(c, t, u):\n        c.gradient("#0E1B4D", "#071033", 180)\n        c.rect(84, 300, 900 * ((t % 2.0) / 2.0), 30, "#2F6BFF")\n        c.text(b[1]["headline"], 84, 900, 100, 800, "#FFFFFF")\n        c.logo()\n    video.add_scene(3, a, "fade")\n    video.add_scene(3, d, "fade")\n');
        const { stdout } = await run(python, ['-I', path.join(RUNTIME_DIR, 'runner.py'), path.join(dir, 'b.json'), path.join(dir, 's.py'), '--lint'], { env: {}, timeout: 60_000 }).catch((e) => ({ stdout: String(e.stdout ?? '') })); return ((JSON.parse(stdout.trim().split('\n').pop() || '{}') as { errors?: string[] }).errors ?? []).join(' '); };
      expect(await go('last')).not.toMatch(/never calls c\.logo/); expect(await go('every')).toMatch(/Scene 1 never calls c\.logo/);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

describe('a refused first draft is repaired, not the end', () => {
  it('goes into the repair loop with what was wrong, and the corrected script is then rendered', async () => {
    const support = await codeVideoSupport(); if (!support.ok) return;
    const kit = { name: 'Maple & Rye', primary: '#6B2D3C', secondary: '#F2C6A0', accent: '#D9486A', logoUrl: null } as never;
    const strat = strategy({ visual: 'graphic_led', pacing: 'measured' });
    const concept: Concept = { title: 't', mood: 'm', palette: { bgA: '#071033', bgB: '#0E1B4D', glow: '#3D6BFF', glow2: '#80B0FF', toneA: '#fff', toneB: '#fff', light: false }, seconds: 6, strategy: strat, scenes: [{ role: 'hook', seconds: 3, headline: 'Alpha one', subtext: '', items: ['A thing', 'Another', 'Third'], visual: 'v', photoId: null }, { role: 'closing', seconds: 3, headline: 'Beta two', subtext: '', items: [], visual: 'v', photoId: null }] };
    const base = conceptPlan(concept, kit, []); const plan = { ...base, spec: { ...base.spec, size: '540x960' as const }, summary: { ...base.summary, size: '540x960' as const } };
    const good = 'def build(video):\n    b = video.brief["scenes"]\n    def a(c, t, u):\n        c.gradient("#071033", "#0E1B4D", 180)\n        y = c.card(84, 400, 900, 500, "Draft", "Plan")\n        c.chip(b[0]["items"][0], 400, y + 40)\n        c.mark("yes", 120, y + 120, 56, progress(t, 0.2, 0.6))\n        c.reveal_text(b[0]["headline"], 84, 1100, 100, 800, "#FFFFFF", t, width=900)\n        c.rect(84, 300, 900 * ((t % 2.0) / 2.0), 30, "#2F6BFF")\n    def d(c, t, u):\n        c.gradient("#0E1B4D", "#071033", 180)\n        c.text(b[1]["headline"], 540, 800, 120, 800, "#FFFFFF", align="center", width=900)\n        c.rect(84, 300, 900 * ((t % 2.0) / 2.0), 30, "#2F6BFF")\n        c.logo()\n    video.add_scene(3, a, "whip", 0.6)\n    video.add_scene(3, d, "fade")\n';
    const dir = await mkdtemp(path.join(os.tmpdir(), 'refused-')); const prompts: string[] = [];
    try {
      const result = await renderCodeVideo({ tenantId: 't', plan, kit, logoId: null, storage: {} as never, workDir: dir, outPath: path.join(dir, 'out.mp4'), complete: async (_s, p) => { prompts.push(p); return { text: /failed while the video was being drawn/.test(p) ? good : 'import os\ndef build(video):\n    pass' }; }, style: 'custom', strategy: strat });
      expect(prompts.length).toBeGreaterThanOrEqual(3); // the draft, its one retry, then the repair
      expect(prompts.at(-1)).toMatch(/Not allowed: Import/); expect(result).toMatchObject({ ok: true });
    } finally { await rm(dir, { recursive: true, force: true }); }
  }, 300_000);
});

describe('a correction that is itself refused does not end the run', () => {
  it('is told why and tried again while repair rounds remain, and the script that finally passes is rendered', async () => {
    const support = await codeVideoSupport(); if (!support.ok) return;
    const kit = { name: 'Maple & Rye', primary: '#6B2D3C', secondary: '#F2C6A0', accent: '#D9486A', logoUrl: null } as never;
    const strat = strategy({ visual: 'graphic_led', pacing: 'measured' });
    const concept: Concept = { title: 't', mood: 'm', palette: { bgA: '#071033', bgB: '#0E1B4D', glow: '#3D6BFF', glow2: '#80B0FF', toneA: '#fff', toneB: '#fff', light: false }, seconds: 6, strategy: strat, scenes: [{ role: 'hook', seconds: 3, headline: 'Alpha one', subtext: '', items: ['A thing', 'Another', 'Third'], visual: 'v', photoId: null }, { role: 'closing', seconds: 3, headline: 'Beta two', subtext: '', items: [], visual: 'v', photoId: null }] };
    const base = conceptPlan(concept, kit, []); const plan = { ...base, spec: { ...base.spec, size: '540x960' as const }, summary: { ...base.summary, size: '540x960' as const } };
    const good = 'def build(video):\n    b = video.brief["scenes"]\n    def a(c, t, u):\n        c.gradient("#071033", "#0E1B4D", 180)\n        y = c.card(84, 400, 900, 500, "Draft", "Plan")\n        c.chip(b[0]["items"][0], 400, y + 40)\n        c.mark("yes", 120, y + 120, 56, progress(t, 0.2, 0.6))\n        c.reveal_text(b[0]["headline"], 84, 1100, 100, 800, "#FFFFFF", t, width=900)\n        c.rect(84, 300, 900 * ((t % 2.0) / 2.0), 30, "#2F6BFF")\n    def d(c, t, u):\n        c.gradient("#0E1B4D", "#071033", 180)\n        c.text(b[1]["headline"], 540, 800, 120, 800, "#FFFFFF", align="center", width=900)\n        c.rect(84, 300, 900 * ((t % 2.0) / 2.0), 30, "#2F6BFF")\n        c.logo()\n    video.add_scene(3, a, "whip", 0.6)\n    video.add_scene(3, d, "fade")\n';
    const dir = await mkdtemp(path.join(os.tmpdir(), 'refused-')); const prompts: string[] = [];
    try {
      const result = await renderCodeVideo({ tenantId: 't', plan, kit, logoId: null, storage: {} as never, workDir: dir, outPath: path.join(dir, 'out.mp4'), complete: async (_s, p) => { prompts.push(p); const repairs = prompts.filter((q) => /failed while the video was being drawn/.test(q)).length; return { text: /failed while the video was being drawn/.test(p) && repairs >= 3 ? good : 'import os\ndef build(video):\n    pass' }; }, style: 'custom', strategy: strat });
      expect(prompts.filter((p) => /failed while the video was being drawn/.test(p)).length).toBeGreaterThanOrEqual(3); // the first correction and its retry were both refused; the loop went on
      expect(prompts.at(-1)).toMatch(/Not allowed: Import/); expect(result).toMatchObject({ ok: true });
    } finally { await rm(dir, { recursive: true, force: true }); }
  }, 300_000);
});

describe('the shot vocabulary is unchanged for scenes that carry it', () => { it('keeps cleanShot behaviour', () => { expect(cleanShot({ purpose: 'p', subject: 's', lighting: 'l', camera: 'push_in' })?.camera).toBe('push_in'); }); });

describe('the older layout rules no longer overrule a storyboard', () => {
  it('lets scene 1 open on a graphic when the storyboard gave it no picture, and does not call a one-second card a still', async () => {
    if (!existsSync(python)) return;
    const dir = await mkdtemp(path.join(os.tmpdir(), 'legacy-')); try {
      const png = path.join(dir, 'p1.png'); const { createCanvas } = await import('@napi-rs/canvas'); const c = createCanvas(100, 100); await writeFile(png, c.toBuffer('image/png'));
      const go = async (firstPhoto: string | null) => { const brief = { width: 540, height: 960, fps: 30, ffmpeg: 'x', font_dir: fontDir(), out: path.join(dir, 'o.mp4'), brand: { name: 'Somerset' }, assets: { p1: png }, palette: { dark: true, bg_a: '#071033', bg_b: '#0E1B4D', text: '#FFFFFF', accent: '#2F6BFF', on_accent: '#FFFFFF', glow: '#3D6BFF', glow2: '#80B0FF', scrim: '#071033' }, require_motion: true, logo_rule: 'last', strategy: { visual: 'mixed' }, scenes: [{ role: 'hook', seconds: 3, headline: 'Alpha', subtext: '', items: [], photo: firstPhoto, visual: null, shot: { purpose: 'p', subject: 's', lighting: 'l', composition: 'graphic_motion', text: 'headline' } }, { role: 'closing', seconds: 1, headline: 'Beta', subtext: '', items: [], photo: null, visual: null }], total_seconds: 4 };
        await writeFile(path.join(dir, 'b.json'), JSON.stringify(brief)); await writeFile(path.join(dir, 's.py'), 'def build(video):\n    b = video.brief["scenes"]\n    def a(c, t, u):\n        c.gradient("#071033", "#0E1B4D", 180)\n        c.rect(84, 300, 900 * ((t % 2.0) / 2.0), 30, "#2F6BFF")\n        c.text(b[0]["headline"], 84, 700, 100, 800, "#FFFFFF")\n    def d(c, t, u):\n        c.gradient("#0E1B4D", "#071033", 180)\n        c.text(b[1]["headline"], 84, 900, 100, 800, "#FFFFFF")\n        c.logo()\n    video.add_scene(3, a, "fade")\n    video.add_scene(1, d, "fade")\n');
        const { stdout } = await run(python, ['-I', path.join(RUNTIME_DIR, 'runner.py'), path.join(dir, 'b.json'), path.join(dir, 's.py'), '--lint'], { env: {}, timeout: 60_000 }).catch((e) => ({ stdout: String(e.stdout ?? '') })); return ((JSON.parse(stdout.trim().split('\n').pop() || '{}') as { errors?: string[] }).errors ?? []).join(' '); };
      const withoutPicture = await go(null); expect(withoutPicture).not.toMatch(/shows no photo/); expect(withoutPicture).not.toMatch(/Scene 2 is almost a still/);
      expect(await go('p1')).toMatch(/Scene 1 shows no photo/); // when the storyboard DID give scene 1 a picture, it is still held to it
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

describe('pictures the strategy asks for are really made and used', () => {
  const asks = rawStrategy({ visual: 'mixed', pacing: 'measured', assets: { coverage: 'thin', needed: 3, plan: [{ id: 'pic-aaaa', role: 'hero', max_uses: 2 }], generate: [{ subject: 'a service van parked at dusk in a quiet street', role: 'hero', why: 'no picture of the van exists' }, 'a tidy workbench with tools'], note: '' } });
  const base = () => ({ ...input(), pictures });
  const storyboard = [scene(0, { seconds: 4 }), scene(1, { seconds: 4, photo: 'gen-0001' }), scene(2, { seconds: 4, photo: null, shot: { purpose: 'p', subject: 's', lighting: 'l', composition: 'typographic', text: 'type_only' } }), scene(3, { seconds: 3, photo: null, shot: { purpose: 'p', subject: 's', lighting: 'l', composition: 'typographic', text: 'type_only' } })];
  it('generates each requested picture before the storyboard, offers it to the storyboard with its role, and returns what was made', async () => {
    const asked: string[] = []; let storyboardPrompt = '';
    const complete = async (system: string, prompt: string) => { if (/check the on-screen words/.test(system)) return JSON.stringify({ problems: [] }); if (/art director checking a storyboard/.test(system)) return JSON.stringify({ scenes: [] }); if (/creative director\. Before any scene/.test(system)) return JSON.stringify(asks); storyboardPrompt = prompt; return JSON.stringify({ scenes: storyboard }); };
    const plan = await planVideo(base(), complete, { generate: async (subject) => { asked.push(subject); return { id: `gen-000${asked.length}`, label: `AI image – ${subject.slice(0, 20)}` }; } });
    expect(asked).toEqual(['a service van parked at dusk in a quiet street', 'a tidy workbench with tools']);
    expect(plan.generated.map((g) => [g.id, g.role])).toEqual([['gen-0001', 'hero'], ['gen-0002', 'support']]);
    expect(storyboardPrompt).toMatch(/gen-0001: AI image – a service van/); expect(storyboardPrompt).toMatch(/best use: hero/); expect(plan.concept?.scenes.some((s) => s.photoId === 'gen-0001')).toBe(true);
    expect(plan.strategy?.assets.plan.map((p) => p.id)).toContain('gen-0001');
  });
  it('says plainly when a picture could not be made, and carries on with graphics and type', async () => {
    const complete = async (system: string, prompt: string) => (/check the on-screen words/.test(system) ? JSON.stringify({ problems: [] }) : /creative director\. Before any scene/.test(system) ? JSON.stringify(asks) : (prompt.includes('gen-0001') ? 'x' : JSON.stringify({ scenes: storyboard.map((s) => ({ ...s, photo: s.photo === 'gen-0001' ? null : s.photo })) })));
    const off = await planVideo(base(), complete, { generate: async () => null }); expect(off.generated).toEqual([]); expect(off.notes.join(' ')).toMatch(/could not generate/); expect(off.concept).not.toBeNull();
    const none = await planVideo(base(), complete); expect(none.notes.join(' ')).toMatch(/picture generation is not available here/);
  });
  it('cleans a requested picture: a plain string still works, and it can never be asked for as "unused"', () => {
    const s = cleanStrategy(rawStrategy({ assets: { plan: [], generate: ['a tidy workbench', { subject: 'a van', role: 'unused' }, { subject: '' }] } }), [])!;
    expect(s.assets.generate).toEqual([{ subject: 'a tidy workbench', role: 'support', why: '', style: '' }, { subject: 'a van', role: 'support', why: '', style: '' }]);
  });
});

describe('what a picture is decides what it can be', () => {
  it('keeps a logo to an end card or unused, and abstract art to a background or unused, whatever the model asked', () => {
    const ids = ['logo-0001', 'art-00001', 'real-0001'];
    const s = cleanStrategy(rawStrategy({ assets: { plan: [{ id: 'logo-0001', role: 'hero' }, { id: 'art-00001', role: 'hero' }, { id: 'real-0001', role: 'hero' }] } }), ids, { 'logo-0001': 'logo', 'art-00001': 'abstract', 'real-0001': 'real_photo' })!;
    expect(s.assets.plan.map((p) => [p.id, p.role])).toEqual([['logo-0001', 'unused'], ['art-00001', 'background'], ['real-0001', 'hero']]);
    expect(cleanStrategy(rawStrategy({ assets: { plan: [{ id: 'logo-0001', role: 'end_visual' }] } }), ids, { 'logo-0001': 'logo' })!.assets.plan[0].role).toBe('end_visual');
  });
});

describe('the same treatment three scenes running is named, and nothing else about structure is judged', () => {
  const c = (shots: Array<Record<string, unknown>>): Concept => ({ title: 't', mood: 'm', palette: {} as never, seconds: shots.length * 3, scenes: shots.map((shot, i) => ({ role: 'scene', seconds: 3, headline: 'h', subtext: '', items: [], visual: 'v', photoId: i % 2 ? 'pic-bbbb' : 'pic-aaaa', shot: { purpose: 'p', subject: 's', lighting: 'l', composition: 'full_frame_image', ...shot } as never })) });
  const open = { pacing: 'measured', visual: 'photo_led', assets: { plan: [{ id: 'pic-aaaa', role: 'hero', max_uses: 8 }, { id: 'pic-bbbb', role: 'support', max_uses: 8 }] } };
  it('flags three scenes in a row with the same text place and size, or the same camera move and crop', () => {
    const same = { text: 'headline', text_position: 'bottom_left', text_scale: 'large', camera: 'push_in', crop: 'wide' };
    const found = conceptIssues(c([same, same, same, { ...same, text: 'none' }]), strategy(open)).join(' ');
    expect(found).toMatch(/Scenes 1 to 3 all have the same text placement \(bottom_left, large type\)/); expect(found).toMatch(/Scenes 1 to 4 all have the same camera move and crop \(push_in, wide crop\)/);
    expect(conceptIssues(c([same, { ...same, text_position: 'middle_center', camera: 'pan_left' }, same, { ...same, text: 'none', camera: 'orbit', crop: 'tight' }]), strategy(open))).toEqual([]);
  });
});

describe('a finishing effect on every scene is a decision, not a habit', () => {
  const grainEverywhere = [0, 1, 2].map((i) => `    def s${i}(c, t, u):\n        c.camera("p1", u, "push", 1.0, t)\n        c.grain(0.04, 1)\n        c.vignette(0.4)\n`).join('') + '    video.add_scene(3, s0, "fade")\n';
  it('is refused when the strategy asks for a clean look, and allowed when its colour and light ask for film', () => {
    expect(strategyProblems(`def build(video):\n${grainEverywhere}`, strategy({ visual: 'photo_led', colour_light: 'bright, clean daylight, flat and crisp' })).join(' ')).toMatch(/Every scene applies film grain/);
    expect(strategyProblems(`def build(video):\n${grainEverywhere}`, strategy({ visual: 'photo_led', colour_light: 'warm filmic light with film grain' }))).toEqual([]);
  });
});

describe('alignment of a wide block that is centred on the frame', () => {
  it('reads a headline spanning nearly the whole width, centred on the frame, as centred', async () => {
    if (!existsSync(python)) return;
    const dir = await mkdtemp(path.join(os.tmpdir(), 'wide-')); try {
      const brief = { width: 540, height: 960, fps: 30, ffmpeg: 'x', font_dir: fontDir(), out: path.join(dir, 'o.mp4'), brand: { name: 'Somerset' }, assets: {}, palette: { dark: true, bg_a: '#071033', bg_b: '#0E1B4D', text: '#FFFFFF', accent: '#2F6BFF', on_accent: '#FFFFFF', glow: '#3D6BFF', glow2: '#80B0FF', scrim: '#071033' }, require_motion: true, scenes: [{ role: 'hook', seconds: 3, headline: 'Book Somerset Pool Service now', subtext: '', items: [], photo: null, visual: null, shot: { purpose: 'p', subject: 's', lighting: 'l', composition: 'typographic', text: 'headline', text_position: 'bottom_center', text_scale: 'large' } }], total_seconds: 3 };
      await writeFile(path.join(dir, 'b.json'), JSON.stringify(brief)); await writeFile(path.join(dir, 's.py'), 'def build(video):\n    b = video.brief["scenes"]\n    def a(c, t, u):\n        c.gradient("#071033", "#0E1B4D", 180)\n        c.text(b[0]["headline"], 540, 1400, 104, 800, "#FFFFFF", align="center", width=900)\n        c.logo()\n    video.add_scene(3, a, "fade")\n');
      const { stdout } = await run(python, ['-I', path.join(RUNTIME_DIR, 'runner.py'), path.join(dir, 'b.json'), path.join(dir, 's.py'), '--measure'], { env: {}, timeout: 60_000 });
      const block = (JSON.parse(stdout.trim().split('\n').pop()!) as { measured: Array<{ text: { align: string; width: number } }> }).measured[0].text;
      expect(block.width).toBeGreaterThan(0.7); expect(block.align).toBe('center');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});


describe('a business with too few pictures gets the missing ones made', () => {
  const lone = [{ id: 'pic-aaaa', label: 'Photo – a cake', provenance: 'own_upload', kind: 'product_photo', shows: 'a birthday cake', relevance: 8, quality: 8, best_use: 'hero' }];
  const wants = (needed: number, generate: unknown[]) => rawStrategy({ visual: 'mixed', assets: { coverage: 'thin', needed, plan: [{ id: 'pic-aaaa', role: 'hero', max_uses: 2 }], generate, note: '' } });
  const system = (s: string) => /creative director\. Before any scene/.test(s);

  it('tells the model that generation is available (or not) and how many it may ask for', async () => {
    const seen: string[] = [];
    const complete = async (_s: string, prompt: string) => { seen.push(prompt); return JSON.stringify(wants(1, [])); };
    await writeStrategy({ ...input(), pictures: lone, generation: { available: true, max: 3 } }, complete);
    await writeStrategy({ ...input(), pictures: lone }, complete);
    expect(seen[0]).toMatch(/PICTURE GENERATION IS AVAILABLE: up to 3/); expect(seen[1]).toMatch(/GENERATION IS NOT AVAILABLE/);
  });
  it('sends the strategy back once when it needs more photographs than the business has and asked for none, then generates what the model then asks for', async () => {
    let calls = 0; const prompts: string[] = [];
    const complete = async (s: string, prompt: string) => { if (!system(s)) return JSON.stringify({ scenes: [scene(0, { seconds: 8 }), scene(1, { seconds: 7, photo: 'gen-0001' })] }); calls += 1; prompts.push(prompt); return JSON.stringify(calls === 1 ? wants(4, []) : wants(3, [{ subject: 'a rack of fresh loaves in a bakery window', role: 'support', why: 'the shop has only one photograph' }, { subject: 'flour dusted on a wooden counter', role: 'macro', why: 'texture' }])); };
    const asked: string[] = [];
    const plan = await planVideo({ ...input(), pictures: lone }, complete, { generate: async (subject) => { asked.push(subject); return { id: `gen-000${asked.length}`, label: `AI image – ${subject.slice(0, 18)}` }; } });
    expect(calls).toBe(2); expect(prompts[1]).toMatch(/needs 4 different photographs but only 1/);
    expect(asked).toHaveLength(2); expect(plan.generated.map((g) => g.role)).toEqual(['support', 'macro']);
  });
  it('does not generate more than is missing, and does not generate when the business has enough', () => {
    const enough = cleanStrategy(wants(1, [{ subject: 'an extra picture nobody needs', role: 'support', why: '' }]), ['pic-aaaa'], { 'pic-aaaa': 'product_photo' })!;
    expect(coverageIssue(enough, lone, { available: true, max: 3 })).toMatch(/Ask for no more than the idea needs/);
    const fine = cleanStrategy(wants(1, []), ['pic-aaaa'], { 'pic-aaaa': 'product_photo' })!;
    expect(coverageIssue(fine, lone, { available: true, max: 3 })).toBeNull();
  });
  it('a logo or abstract artwork never counts as a photograph the business has', () => {
    const pics = [...lone, { id: 'pic-logo', label: 'Logo', kind: 'logo' }, { id: 'pic-art', label: 'Made by Pilot', kind: 'abstract' }];
    const s = cleanStrategy(rawStrategy({ visual: 'mixed', assets: { coverage: 'sufficient', needed: 3, plan: [{ id: 'pic-aaaa', role: 'hero', max_uses: 1 }, { id: 'pic-logo', role: 'support', max_uses: 1 }, { id: 'pic-art', role: 'support', max_uses: 1 }], generate: [] } }), pics.map((p) => p.id), Object.fromEntries(pics.map((p) => [p.id, p.kind])))!;
    expect(coverageIssue(s, pics, { available: true, max: 3 })).toMatch(/only 1 of the business's pictures/);
    expect(coverageIssue(s, pics, { available: false, max: 0 })).toBeNull();
  });
  it('never lets a generated picture show a person unless the request is about people', async () => {
    const withPerson = [{ subject: 'a uniformed technician opening a front door', role: 'support', why: 'reassurance' }];
    const st = cleanStrategy(wants(2, withPerson), ['pic-aaaa'], { 'pic-aaaa': 'product_photo' })!;
    expect(coverageIssue(st, lone, { available: true, max: 3 }, 'Make a video about our cakes')).toMatch(/never contain people/);
    expect(coverageIssue(st, lone, { available: true, max: 3 }, 'Make a video introducing our team of bakers')).toBeNull();
    const asked: string[] = [];
    const complete = async (s: string) => (system(s) ? JSON.stringify(wants(2, withPerson)) : JSON.stringify({ scenes: [scene(0, { seconds: 8 }), scene(1, { seconds: 7 })] }));
    const plan = await planVideo({ ...input(), pictures: lone }, complete, { generate: async (subject) => { asked.push(subject); return { id: 'gen-0001', label: 'x' }; } });
    expect(asked).toEqual([]); expect(plan.notes.join(' ')).toMatch(/would show a person/);
  });
  it('passes the strategy\'s own visual treatment (and shared art direction) to the picture maker, so pictures need not be photographs', async () => {
    const seen: Array<[string, string | undefined, string | undefined]> = [];
    const styled = wants(2, [{ subject: 'a tiered cupcake under floating pumpkins', role: 'hero', why: 'no cupcake photo', style: 'glossy 3D render' }]); (styled.assets as Record<string, unknown>).art = 'cinematic 3D Halloween diorama, deep purple and orange light';
    const complete = async (s: string) => (system(s) ? JSON.stringify(styled) : JSON.stringify({ scenes: [scene(0, { seconds: 8 }), scene(1, { seconds: 7 })] }));
    await planVideo({ ...input(), pictures: lone }, complete, { generate: async (subject, look, style) => { seen.push([subject, look, style]); return { id: 'gen-0001', label: 'x' }; } });
    expect(seen[0][2]).toMatch(/glossy 3D render/); expect(seen[0][2]).toMatch(/Halloween diorama/);
  });
});

describe('trust and duration', () => {
  const facts = 'Make a 20 second video promoting Brightline Plumbing\'s 24-hour emergency plumbing service . Plumbing contractor';
  const story = (lines: Array<[string, string]>): Concept => ({ title: 't', mood: 'm', palette: {} as Concept["palette"], seconds: 20, scenes: lines.map(([headline, subtext], i) => ({ ...scene(i, { seconds: 4 }), headline, subtext })) } as unknown as Concept);
  it('lets the 24-hour claim through when the request makes it, and catches claims nobody made', async () => {
    const { unsupportedClaims, dropUnsupportedClaims } = await import('./strategy.js');
    const c = story([['24-hour emergency plumbing', ''], ['Trusted and licensed', 'insured technicians, clear work'], ['Twenty four seven', ''], ['Call now', 'free estimates']]);
    const bad = unsupportedClaims(c, facts); expect(bad.map((b) => b.scene)).toEqual([2, 2, 3, 4]); expect(bad[0].claims).toContain('licensed'); expect(bad.some((b) => b.scene === 1)).toBe(false);
    expect(unsupportedClaims(c, `${facts} . fully licensed and insured, free estimates, available twenty four seven`)).toEqual([]);
    expect(dropUnsupportedClaims(c, facts)).toBe(4); expect(unsupportedClaims(c, facts)).toEqual([]);
  });
  it('sizes the scenes so a video with live transitions still runs the length asked', () => {
    const raw = { title: 'x', mood: 'm', scenes: [0, 1, 2, 3, 4, 5].map((i) => ({ role: 'scene', seconds: 3.3, headline: `H${i}`, subtext: '', visual: 'a scene', transition: ['whip', 'crosszoom', 'slice', 'whip', 'lightleak', 'fade'][i], photo: null, shot: { composition: 'typographic', text: 'headline' } })) };
    const c = sanitizeConcept(raw, { ...input(), seconds: 20, strategy: cleanStrategy(rawStrategy(), [])! } as unknown as ConceptInput)!;
    const overlap = c.scenes.slice(0, -1).reduce((sum, s) => sum + (['whip', 'crosszoom', 'lightleak', 'slice'].includes(s.transition ?? '') ? Math.min(0.6, s.seconds / 2) : 0), 0);
    const played = c.scenes.reduce((sum, s) => sum + s.seconds, 0) - overlap;
    expect(Math.abs(played - 20)).toBeLessThan(0.3); expect(c.seconds).toBeGreaterThan(19.6); expect(c.scenes.reduce((sum, s) => sum + s.seconds, 0)).toBeGreaterThan(21.5);
  });
});


describe('the finished length is checked against the length asked for', () => {
  it('catches a video that asks for 20 seconds and would run 17, and accepts one sized for its overlaps', async () => {
    if (!existsSync(python)) return;
    const dir = await mkdtemp(path.join(os.tmpdir(), 'length-')); try {
      const go = async (secs: number[]) => {
        const brief = { width: 270, height: 480, fps: 30, ffmpeg: 'x', font_dir: fontDir(), out: path.join(dir, 'o.mp4'), brand: { name: 'Somerset' }, assets: {}, palette: { dark: true, bg_a: '#071033', bg_b: '#0E1B4D', text: '#FFFFFF', accent: '#2F6BFF', on_accent: '#FFFFFF', glow: '#3D6BFF', glow2: '#80B0FF', scrim: '#071033' }, scenes: secs.map((seconds, i) => ({ role: 'scene', seconds, headline: `H${i}`, subtext: '', items: [], photo: null, visual: null })), total_seconds: 20 };
        await writeFile(path.join(dir, 'b.json'), JSON.stringify(brief));
        const scenes = secs.map((_, i) => `    def s${i}(c, t, u):\n        c.gradient("#071033", "#0E1B4D", 180)\n        c.rect(40, 200, 400 * ((t % 2.0) / 2.0), 30, "#2F6BFF")\n        c.text(b[${i}]["headline"], 40, 300, 100, 800, "#FFFFFF")\n    video.add_scene(b[${i}]["seconds"], s${i}, ${i < secs.length - 1 ? '"whip"' : '"fade"'})\n`).join('');
        await writeFile(path.join(dir, 's.py'), `def build(video):\n    b = video.brief["scenes"]\n${scenes}`);
        const { stdout } = await run(python, ['-I', path.join(RUNTIME_DIR, 'runner.py'), path.join(dir, 'b.json'), path.join(dir, 's.py'), '--lint'], { env: {}, timeout: 60_000 }).catch((e) => ({ stdout: String(e.stdout ?? '') }));
        return ((JSON.parse(stdout.trim().split('\n').pop() || '{}') as { errors?: string[] }).errors ?? []).join(' | ');
      };
      expect(await go([4, 4, 4, 4, 4])).toMatch(/runs 17\.6 seconds but 20 were asked for/); // 5 scenes of 4 s with four 0.6 s overlaps
      expect(await go([4.6, 4.6, 4.6, 4.6, 4.6])).not.toMatch(/were asked for/);
    } finally { await rm(dir, { recursive: true, force: true }); }
  }, 60_000);
  it('does not mistake "no people" in a picture description for a person in the picture', async () => {
    const { showsPeople } = await import('./strategy.js');
    for (const ok of ['a metal pipe with water spray, no people', 'a van under a streetlight, no logos or people', 'a brass valve and wrench, no hands', 'an empty kitchen without people']) expect(showsPeople(ok), ok).toBe(false);
    for (const bad of ['a uniformed technician at a door', 'hands pouring flour', 'a smiling family at the table, no logos']) expect(showsPeople(bad), bad).toBe(true);
  });
});


describe('a video that is a creative decision, not a template', () => {
  const strat = () => cleanStrategy(rawStrategy({ pacing: 'brisk', visual_language: 'stylised 3D animation, warm light' }), [])!;
  const shot = (position: string) => ({ text: 'headline', text_position: position, text_scale: 'medium' });
  const six = (secs: number[], places: string[]) => ({ title: 't', mood: 'm', palette: {}, seconds: secs.reduce((a, b) => a + b, 0), scenes: secs.map((seconds, i) => ({ ...scene(i, { seconds }), shot: { purpose: 'p', subject: 's', lighting: 'l', ...shot(places[i]) } })) }) as unknown as Concept;
  it('keeps the strategy\'s visual language and each scene\'s own treatment', () => {
    expect(strat().visual_language).toMatch(/3D animation/);
    expect(cleanShot({ purpose: 'p', subject: 's', lighting: 'l', style: 'glossy 3D render of a cupcake', composition: 'centered_subject' })?.style).toBe('glossy 3D render of a cupcake');
    expect(strategyText(strat())).toMatch(/Visual language: stylised 3D animation/);
  });
  it('flags a "brisk" scene that sits for six seconds, and text that always sits in the same place', () => {
    const issues = conceptIssues(six([2, 6, 3, 3, 3, 3], ['top_left', 'bottom_left', 'bottom_left', 'bottom_left', 'bottom_left', 'middle_center']), strat());
    expect(issues.join(' ')).toMatch(/Scene 2 lasts 6 seconds/); expect(issues.join(' ')).toMatch(/4 of 6 scenes put their words at bottom left/);
    expect(conceptIssues(six([2, 3, 3, 3, 3, 3], ['top_left', 'bottom_left', 'middle_center', 'bottom_center', 'bottom_left', 'top_center']), strat()).join(' ')).not.toMatch(/lasts|put their words/);
  });
  it('shows the business name only where the strategy puts it', async () => {
    if (!existsSync(python)) return;
    const dir = await mkdtemp(path.join(os.tmpdir(), 'brand-')); try {
      const go = async (rule: string) => {
        const brief = { width: 270, height: 480, fps: 30, ffmpeg: 'x', font_dir: fontDir(), out: path.join(dir, 'o.mp4'), brand: { name: 'Somerset' }, assets: {}, palette: { dark: true, bg_a: '#071033', bg_b: '#0E1B4D', text: '#FFFFFF', accent: '#2F6BFF', on_accent: '#FFFFFF', glow: '#3D6BFF', glow2: '#80B0FF', scrim: '#071033' }, logo_rule: rule, scenes: [0, 1, 2].map((i) => ({ role: 'scene', seconds: 3, headline: `H${i}`, subtext: '', items: [], photo: null, visual: null })), total_seconds: 9 };
        await writeFile(path.join(dir, 'b.json'), JSON.stringify(brief));
        await writeFile(path.join(dir, 's.py'), 'def build(video):\n    b = video.brief["scenes"]\n' + [0, 1, 2].map((i) => `    def s${i}(c, t, u):\n        c.gradient("#071033", "#0E1B4D", 180)\n        c.rect(40, 200, 400 * ((t % 2.0) / 2.0), 30, "#2F6BFF")\n        c.text(b[${i}]["headline"], 40, 300, 100, 800, "#FFFFFF")\n        c.logo()\n    video.add_scene(3, s${i}, "fade")\n`).join(''));
        const { stdout } = await run(python, ['-I', path.join(RUNTIME_DIR, 'runner.py'), path.join(dir, 'b.json'), path.join(dir, 's.py'), '--lint'], { env: {}, timeout: 60_000 }).catch((e) => ({ stdout: String(e.stdout ?? '') }));
        return ((JSON.parse(stdout.trim().split('\n').pop() || '{}') as { errors?: string[] }).errors ?? []).join(' | ');
      };
      expect(await go('last')).toMatch(/Scene 1 calls c\.logo\(\).*only on the last scene/); expect(await go('last')).toMatch(/Scene 2 calls c\.logo/); expect(await go('last')).not.toMatch(/Scene 3 calls c\.logo/);
      expect(await go('ends')).toMatch(/Scene 2 calls c\.logo\(\).*first and last/); expect(await go('ends')).not.toMatch(/Scene (1|3) calls/); expect(await go('every')).not.toMatch(/calls c\.logo/);
    } finally { await rm(dir, { recursive: true, force: true }); }
  }, 60_000);
});

describe('what is left when a number is removed from a line', () => {
  it('never leaves a dangling slash or dash on screen', async () => {
    const { cleanLine } = await import('../explainer/storyboard.js');
    expect(cleanLine('Call now - available 24/7', 60, '')).toBe('Call now - available'); expect(cleanLine('24-hour emergency service', 60, 'promoting our 24-hour emergency plumbing')).toBe('24-hour emergency service'); expect(cleanLine('Open 7 days', 60, 'promoting our 24-hour service')).toBe('Open days'); expect(cleanLine('24/7 emergency plumbing', 60, '')).toBe('emergency plumbing'); expect(cleanLine('Open late - 9 to 5', 60, '')).not.toMatch(/[-/]\s*$/);
  });
});

describe('an agency-grade video: nothing empty, nothing invented, no clip-art', () => {
  it('has the model read every line against the business facts, and drops what is still unsupported', async () => {
    const { reviewClaims, dropUnsupportedClaims } = await import('./strategy.js');
    const c = { title: 't', mood: 'm', palette: {}, seconds: 12, scenes: [{ ...scene(0, { seconds: 4 }), headline: 'Spooky treats', subtext: 'Baked fresh this weekend' }, { ...scene(1, { seconds: 4 }), headline: 'Visit Maple & Rye', subtext: '' }] } as unknown as Concept;
    const seen: string[] = [];
    const complete = async (_s: string, prompt: string) => { seen.push(prompt); return JSON.stringify({ problems: [{ line: 2, why: 'a time the request never gave' }] }); };
    const found = await reviewClaims(c, 'Make a fun Halloween video for my bakery', complete);
    expect(found).toEqual([{ scene: 1, line: 'Baked fresh this weekend', why: 'a time the request never gave' }]);
    expect(seen[0]).toMatch(/FACTS[\s\S]*Halloween video for my bakery/); expect(seen[0]).toMatch(/2\. \(scene 1\) Baked fresh this weekend/);
    expect(dropUnsupportedClaims(c, 'Make a fun Halloween video for my bakery', found)).toBe(1); expect(c.scenes[0].subtext).toBe('');
    expect(await reviewClaims(c, 'x', async () => 'not json')).toEqual([]);
  });
  it('sends back a scene that shows nothing, and a closing that is a plain type card', () => {
    const s = cleanStrategy(rawStrategy({ cta: 'call now', pacing: 'measured' }), [])!;
    const empty = { title: 't', mood: 'm', palette: {}, seconds: 9, scenes: [{ ...scene(0, { seconds: 4 }), headline: '', subtext: '', photoId: null, shot: { purpose: 'p', subject: 's', lighting: 'l', composition: 'graphic_motion', text: 'none' } }, { ...scene(1, { seconds: 5 }), headline: 'Call now', photoId: null, shot: { purpose: 'p', subject: 's', lighting: 'l', composition: 'typographic', text: 'headline' } }] } as unknown as Concept;
    const issues = conceptIssues(empty, s).join(' | ');
    expect(issues).toMatch(/Scene 1 \(4 seconds\) has no picture and no words/); expect(issues).toMatch(/closing scene is a plain type card/);
  });
  it('allows flat clip-art props only when the video\'s own visual language is flat or illustrated', () => {
    const photo = cleanStrategy(rawStrategy({ visual: 'mixed', visual_language: 'stylised 3D render with warm light' }), [])!;
    const flat = cleanStrategy(rawStrategy({ visual: 'mixed', visual_language: 'flat hand-drawn illustration with bold icons' }), [])!;
    const script = 'def build(video):\n    def a(c, t, u):\n        c.prop("cake", 500, 900, 300)\n    video.add_scene(3, a, "fade")\n';
    expect(strategyProblems(script, photo).join(' ')).toMatch(/Do not use c\.prop \(flat clip-art\)/); expect(strategyProblems(script, flat).join(' ')).not.toMatch(/flat clip-art/);
  });
  it('does not read "no hands or people visible" as people in the picture', async () => {
    const { showsPeople } = await import('./strategy.js');
    for (const ok of ['a wrench on a pipe joint, no hands or people visible', 'a van at dusk, no people or logos visible, premium lighting']) expect(showsPeople(ok), ok).toBe(false);
    expect(showsPeople('a plumber holding a wrench')).toBe(true);
  });
});

describe('nothing renders as empty seconds', () => {
  it('removes a scene with no picture and no words and gives its time to its neighbours', async () => {
    const { dropEmptyScenes } = await import('./strategy.js');
    const c = { title: 't', mood: 'm', palette: {}, seconds: 12, scenes: [{ ...scene(0, { seconds: 4 }), photoId: 'p' }, { ...scene(1, { seconds: 4 }), headline: '', subtext: '', photoId: null, shot: { purpose: 'p', subject: 's', lighting: 'l', text: 'none' } }, { ...scene(2, { seconds: 4 }), headline: 'Call us', photoId: null }] } as unknown as Concept;
    expect(dropEmptyScenes(c)).toBe(1); expect(c.scenes).toHaveLength(2); expect(c.scenes.reduce((sum, s) => sum + s.seconds, 0)).toBe(12);
  });
});
