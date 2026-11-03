import { mkdtemp, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { cleanPalette, conceptPlan, type Concept } from './concept.js';
import { renderCodeVideo } from './index.js';
import { codeVideoSupport } from './sandbox.js';

/**
 * The live loop with a scripted stand-in for the model, through the REAL parts: the safety checker, the sandbox, the layout lint, the renderer and the finished-video check.
 * The model's first script has a flaw that only shows in the finished video (the last scene goes black); the second reply, to the check's complaint, fixes it.
 */
const kit = { name: 'Somerset Pool Service', primary: '#0B3C5D', secondary: '#4CC9F0', accent: '#2F6BFF', logoUrl: null } as never;
const scene = (role: 'hook' | 'closing', seconds: number, headline: string, subtext: string, items: string[]) => ({ role, seconds, headline, subtext, items, visual: 'cards and chips', photoId: null });
const concept: Concept = { title: 'Pool closing', mood: 'dark', palette: cleanPalette(null, 'pool closing dark premium'), seconds: 7, scenes: [scene('hook', 2, 'Close it right', 'Pool closing', ['Cover on', 'Water balanced']), scene('closing', 5, 'Somerset Pool Service', 'Closed for winter', [])] };
const plan = (() => { const base = conceptPlan(concept, kit, []); return { ...base, spec: { ...base.spec, size: '540x960' as const }, summary: { ...base.summary, size: '540x960' as const } }; })();

const script = (endsBlack: boolean) => `def build(video):
    p = video.palette
    b = video.brief["scenes"]
    def one(c, t, u):
        c.gradient("#071033", "#0E1B4D", 180)
        c.swarm(b[0]["items"], t, 540, 1000, 380, 240, 6, 30, 2, 1.0, progress(t, 0.1, 1.0, "linear"), 0.0)
        c.reveal_text(b[0]["headline"], 84, 420, 100, 800, "#FFFFFF", t, start=0.2, width=900)
        c.logo()
    video.add_scene(b[0]["seconds"], one, "whip", 0.6)
    def two(c, t, u):
        c.gradient("#FFFFFF", "#EEF2F9", 180)
        c.glow(c.W * (0.5 + 0.4 * math.sin(t)), 400, 1000, "#CFDDFF", 0.6)
        y = c.card(84, 500, 912, 600, b[1]["headline"], "Draft")
        c.mark("yes", 120, y + 20, 56, progress(t, 0.2, 0.6))
        c.rect(84, 1250, 912 * ((t % 2.0) / 2.0), 36, p.accent, radius=18)
        c.circle(c.W * (0.2 + 0.6 * ((t % 3.0) / 3.0)), 1400, 60, p.accent)
        c.text(b[1]["subtext"], 200, y + 26, 48, 700, "#0B1F44", width=700)
        c.logo()
${endsBlack ? '        if t > 2.5:\n            c.fill("#000000")\n' : ''}    video.add_scene(b[1]["seconds"], two, "fade")
`;

describe('Pilot writes, checks, renders, inspects and revises its own video code', () => {
  const run = async (replies: (prompt: string) => string) => {
    const support = await codeVideoSupport(); if (!support.ok) return null;
    const dir = await mkdtemp(path.join(os.tmpdir(), 'live-loop-')); const prompts: string[] = [];
    const complete = async (_system: string, prompt: string) => { prompts.push(prompt); return { text: replies(prompt) }; };
    try {
      const result = await renderCodeVideo({ tenantId: 't', plan, kit, logoId: null, storage: {} as never, workDir: dir, outPath: path.join(dir, 'out.mp4'), complete, style: 'custom', look: 'motion', subject: 'pool closing' });
      const size = result.ok ? (await stat(path.join(dir, 'out.mp4'))).size : 0;
      return { result, prompts, size };
    } finally { await rm(dir, { recursive: true, force: true }); }
  };

  it('sends a flaw that only shows in the finished video back to the writer, renders the revision and returns it', async () => {
    const out = await run((prompt) => (prompt.includes('Finished video check') ? script(false) : script(true)));
    if (!out) return;
    expect(out.result).toMatchObject({ ok: true, quality: { passed: true, revisions: 1 } });
    expect(out.size).toBeGreaterThan(10_000);
    expect(out.prompts.length).toBe(2); expect(out.prompts[1]).toMatch(/Finished video check: From [\d.]+s to [\d.]+s the video is a blank black frame/);
  }, 240_000);

  it('does not loop forever: a writer that never fixes it is refused after the retry limit, so the standard video is used', async () => {
    const out = await run(() => script(true));
    if (!out) return;
    expect(out.result.ok).toBe(false); expect(out.prompts.length).toBe(2); // one writing, one revision, then stop
    if (!out.result.ok) expect(out.result.reason).toMatch(/blank black frame/);
  }, 240_000);
});

describe('the repair loop keeps the best design, not the last', () => {
  it('returns the version that was reviewed best when later repairs score worse', async () => {
    const support = await codeVideoSupport(); if (!support.ok) return;
    const dir = await mkdtemp(path.join(os.tmpdir(), 'best-')); let reviews = 0;
    const complete = async (_s: string, prompt: string) => ({ text: prompt.includes('failed while') || prompt.includes('Design review') ? script(false).replace('#071033', '#102040') : script(false) });
    const completeWithImages = async () => { reviews += 1; return { text: JSON.stringify({ score: reviews > 9 ? 7 : reviews === 1 ? 6 : 4, findings: [{ scene: 1, kind: 'composition', problem: 'The type is small', fix: 'Make it bigger' }] }) }; };
    try {
      const result = await renderCodeVideo({ tenantId: 't', plan, kit, logoId: null, storage: {} as never, workDir: dir, outPath: path.join(dir, 'out.mp4'), complete, completeWithImages, style: 'custom', look: 'motion', subject: 'pool closing' });
      expect(reviews).toBeGreaterThan(2); // it kept repairing after the 6, and every repair scored worse
      expect(result).toMatchObject({ ok: true, score: 7 }); if (result.ok) expect(result.script).toContain('#071033'); // the first version, which scored best while drafting, not the last; the score reported is the finished video's own review
    } finally { await rm(dir, { recursive: true, force: true }); }
  }, 400_000);
});
