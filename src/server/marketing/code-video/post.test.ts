import { afterEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { renderCodePost, wantsCodePost } from './post.js';
import { RUNTIME_DIR } from './sandbox.js';

afterEach(() => { delete process.env.PILOT_CODE_VIDEO; });

describe('which posts are drawn as code', () => {
  it('a styled, creative or reference-based post is; a plain one keeps the designed-post engine', () => {
    expect(wantsCodePost('Make a cinematic post about pool openings')).toBe(true);
    expect(wantsCodePost('Make a creative, original post')).toBe(true);
    expect(wantsCodePost('Make a post about pool closing')).toBe(false);
    expect(wantsCodePost('Make a post about pool closing', true)).toBe(true);
  });
  it('never when code is off or only on request', () => {
    process.env.PILOT_CODE_VIDEO = 'off'; expect(wantsCodePost('Make a cinematic post')).toBe(false);
    process.env.PILOT_CODE_VIDEO = 'request'; expect(wantsCodePost('Make a cinematic post')).toBe(false);
  });
});

describe('when the code post cannot be made', () => {
  it('says so instead of throwing, so the caller can use the designed post', async () => {
    const kit = { name: 'Somerset', primary: '#0B3C5D', secondary: '#4CC9F0', accent: '#4CC9F0', logoUrl: null } as never;
    const render = (async () => ({ ok: false, reason: 'No design passed the checks.' })) as never;
    const result = await renderCodePost({ tenantId: 't', message: 'cinematic post', subject: 'pool openings', hook: 'Pool season', cta: 'Book now', kit, photo: null, logoId: null, storage: { listAssets: async () => [] } as never, workDir: '/tmp/none', complete: async () => ({ text: '' }), render });
    expect(result).toEqual({ ok: false, reason: 'No design passed the checks.' });
  });
});

describe('the Somerset example script', () => {
  it('passes the same safety check every model-written script goes through', async () => {
    const python = path.join(process.cwd(), '.venv-codevideo/bin/python'); if (!existsSync(python)) return;
    const file = path.join(__dirname, 'examples/somerset-pool-opening.py');
    const words = ['Somerset Pool Service', 'Pool season starts here', 'Pool openings in Windsor-Essex', 'Opened right', 'Clean, balanced and ready to swim', 'Done by hand', 'Cover off and cleaned', 'Water balanced', 'Equipment checked', 'Book your pool opening'];
    const code = `import sys, json\nsys.path.insert(0, ${JSON.stringify(RUNTIME_DIR)})\nimport validate_script\nprint(json.dumps(validate_script.validate(open(${JSON.stringify(file)}).read(), json.loads(sys.argv[1]))))`;
    const { stdout } = await promisify(execFile)(python, ['-I', '-c', code, JSON.stringify(words)]);
    expect(JSON.parse(stdout.trim().split('\n').pop()!)).toEqual([]); expect((await readFile(file, 'utf8')).includes('def build(video)')).toBe(true);
  });
});

describe('a custom photographed video must read as film, not slides', () => {
  const good = `def build(video):
    def a(c, t, u):
        c.camera("p1", u, "push", 1.0, t)
    def b(c, t, u):
        c.camera("p1", u, "orbit", 1.0, t)
    def d(c, t, u):
        c.camera("p1", u, "handheld", 1.0, t)
    video.add_scene(4, a, "whip", 0.7)
    video.add_scene(4, b, "crosszoom", 0.7)
    video.add_scene(4, d, "fade")`;
  it('accepts full-frame camera shots joined by live transitions', async () => {
    const { cinematicProblems } = await import('./index.js'); expect(cinematicProblems(good)).toEqual([]);
  });
  it('sends back a floating photo card, still photos, one repeated camera move and plain fades', async () => {
    const { cinematicProblems } = await import('./index.js');
    const slides = `def build(video):
    def a(c, t, u):
        c.photo("p1", 84, 200, 912, 800, shape="round", radius=48, shadow=0.5)
    video.add_scene(4, a, "fade")
    video.add_scene(4, a, "fade")
    video.add_scene(4, a, "push")`;
    const found = cinematicProblems(slides).join(' ');
    expect(found).toMatch(/rounded or shadowed card/); expect(found).toMatch(/c\.camera/); expect(found).toMatch(/live transitions/);
    expect(cinematicProblems(good.replace('"orbit"', '"push"').replace('"handheld"', '"push"')).join(' ')).toMatch(/at least three different moves/);
  });
  it('counts a c.camera shot as showing the hero photograph', async () => {
    const { missingHeroPhoto } = await import('./index.js');
    expect(missingHeroPhoto(good, 'p1', 'pool opening')).toEqual([]);
  });
});
