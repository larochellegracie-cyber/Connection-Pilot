import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { sanitizeConcept, writeConcept, type ConceptInput } from './concept.js';
import { writeScript, type CodeBrief } from './generate.js';
import { missingHeroPhoto, missingHeroProp } from './index.js';
import { buildPhotoAdScript } from './photo-ad.js';
import { RUNTIME_DIR } from './sandbox.js';

const input: ConceptInput = { request: 'Make me a 15 second video about a chocolate cake for Somerset.', subject: 'chocolate cake', seconds: 15, business: { name: 'Somerset Pool Service', type: 'Pool service', location: 'Windsor', services: [], description: '', tone: '' }, photos: [{ id: 'gen-1', label: 'AI image – a chocolate cake' }, { id: 'other', label: 'Pool' }], props: ['cake'], heroPhoto: { id: 'gen-1', label: 'AI image – a chocolate cake' } };
const scene = (over: Record<string, unknown> = {}) => ({ role: 'scene', seconds: 3, headline: 'Pure chocolate', subtext: 'Rich and glossy', items: [], visual: 'slow push-in on the photograph with a light sweep', photo: null, ...over });

describe('a photographed subject is the main visual', () => {
  it('puts the photograph in every scene of the concept, even when the model leaves it out, and lets it repeat', () => {
    const c = sanitizeConcept({ scenes: [scene({ role: 'hook' }), scene({ photo: 'gen-1' }), scene({ photo: 'other' }), scene({ role: 'closing' })] }, input)!;
    expect(c.scenes.map((s) => s.photoId)).toEqual(['gen-1', 'gen-1', 'other', 'gen-1']);
  });
  it('tells the concept writer to move the photograph, not rebuild the subject from shapes', async () => {
    const prompts: string[] = []; await writeConcept(input, async (system) => { prompts.push(system); return 'x'; });
    expect(prompts[0]).toMatch(/HERO PHOTO: gen-1/); expect(prompts[0]).toMatch(/Do NOT describe the subject being built or drawn from shapes/);
  });
  it('tells the code writer the subject is a real photograph and must not be drawn with a prop', async () => {
    const brief = { width: 1080, height: 1920, fps: 30, ffmpeg: '', font_dir: '', out: '', brand: { name: 'Somerset' }, palette: {}, assets: { p1: 'x.jpg' }, scenes: [], total_seconds: 15, subject: 'chocolate cake', hero_photo: { name: 'p1', label: 'AI image' } } as CodeBrief;
    const prompts: string[] = []; await writeScript({ brief, style: 'custom', complete: async (_s, prompt) => { prompts.push(prompt); return { text: 'def build(video):\n    pass' }; }, check: async () => [] });
    expect(prompts[0]).toMatch(/REAL PHOTOGRAPH: "p1"/); expect(prompts[0]).not.toMatch(/choose the c\.prop that matches it/);
  });
  it('sends back a script that shows the photograph fewer than three times, or draws the subject with a prop', () => {
    const shown = 'c.photo("p1", 0, 0, 1080, 1920)\nc.backdrop("p1", u)\nc.photo("p1", 1, 2, 3, 4)';
    expect(missingHeroPhoto(shown, 'p1', 'chocolate cake')).toEqual([]);
    expect(missingHeroPhoto('c.photo("p1", 0, 0, 1080, 1920)', 'p1', 'chocolate cake')[0]).toMatch(/at least three scenes/);
    expect(missingHeroPhoto(`${shown}\nc.prop("cake", 540, 900, 700)`, 'p1', 'chocolate cake').join(' ')).toMatch(/Do not draw the cake with c\.prop/);
    expect(missingHeroProp('c.photo("p1")', 'chocolate cake')).toHaveLength(1); // with no photograph the prop is still required, as before
  });
});

describe('the photo-led advert written as code', () => {
  const concept = sanitizeConcept({ scenes: [scene({ role: 'hook' }), scene(), scene(), scene(), scene({ role: 'closing' })] }, input)!;
  it('shows the photograph in every scene and draws no stand-in for it', () => {
    const script = buildPhotoAdScript(concept, 'p1', { x: 0.5, y: 0.55 });
    expect(script).not.toMatch(/\.prop\(/); expect((script.match(/c\.(?:photo|backdrop)\(H/g) ?? []).length).toBeGreaterThanOrEqual(6); expect(script).toMatch(/c\.vignette/); expect(script).toMatch(/c\.rays/); expect(script).toMatch(/c\.logo\(\)/);
    expect(missingHeroPhoto(script.replace(/\(H,/g, '("p1",').replace(/\(H\b/g, '("p1"'), 'p1', 'chocolate cake')).toEqual([]);
    expect(buildPhotoAdScript(concept, 'p1', { x: 0.3, y: 0.3 })).toContain('SY = 0.300');
  });
  it('passes the sandbox safety check (the same check every model-written script goes through)', async () => {
    const python = ['.venv-codevideo/bin/python'].map((p) => path.join(process.cwd(), p)).find(existsSync); if (!python) return;
    const dir = await mkdtemp(path.join(os.tmpdir(), 'photo-ad-')); try {
      const file = path.join(dir, 's.py'); await writeFile(file, buildPhotoAdScript(concept, 'p1', { x: 0.5, y: 0.5 }));
      const words = concept.scenes.flatMap((sc) => [sc.headline, sc.subtext]).concat(['Somerset']);
      const code = `import sys, json\nsys.path.insert(0, ${JSON.stringify(RUNTIME_DIR)})\nimport validate_script\nprint(json.dumps(validate_script.validate(open(${JSON.stringify(file)}).read(), json.loads(sys.argv[1]))))`;
      const { stdout } = await promisify(execFile)(python, ['-I', '-c', code, JSON.stringify(words)]);
      expect(JSON.parse(stdout.trim().split('\n').pop()!)).toEqual([]); // no complaints from the checker
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
