import type { Concept } from './concept.js';
import { measureImage } from '../reference-image/analyze.js';

/** Where the subject is in the photograph (0..1 from the left and the top), from where the detail is, so close-ups aim at it and not at the backdrop. */
export async function heroFocus(bytes: Buffer): Promise<{ x: number; y: number }> {
  try { const { measures } = await measureImage(bytes); return { x: Math.min(0.8, Math.max(0.2, measures.subject.x)), y: Math.min(0.8, Math.max(0.25, measures.subject.y)) }; } catch { return { x: 0.5, y: 0.5 }; }
}

/**
 * A photo-led advert, written as code: the realistic picture of the subject (the business's own photo, or one generated for this request) is the main
 * visual of every scene, and Pilot's code adds what a film editor and colourist would: a slow push-in, close-up crops that show different parts of the
 * picture, a pan, a floating frame over a blurred backdrop of the same picture, a light sweep and drifting highlights, a vignette, a brand-coloured grade,
 * kinetic words and the logo. Nothing is drawn from shapes to stand in for the subject. This is the dependable version; the model-written version
 * (the same idea, designed by the model) is tried first and this one is the way back if that cannot be made.
 */
const q = (value: string) => JSON.stringify(value);

/** The scene styles in the order they are used; the first scene is always the full-frame opening and the last the sign-off. */
const MIDDLE = ['macro_top', 'floating', 'macro_low', 'pan'] as const;
const TRANSITIONS = ['wipe', 'zoom', 'iris', 'push'] as const;

export function buildPhotoAdScript(concept: Concept, hero: string, focus: { x: number; y: number } = { x: 0.5, y: 0.5 }): string {
  const last = concept.scenes.length - 1;
  const styles = concept.scenes.map((_, i) => (i === 0 ? 'opening' : i === last ? 'signoff' : MIDDLE[(i - 1) % MIDDLE.length]));
  const transitions = concept.scenes.map((_, i) => (i === last ? 'fade' : i === 0 ? 'wipe' : TRANSITIONS[i % TRANSITIONS.length]));
  return `def build(video):
    p = video.palette
    b = video.brief["scenes"]
    H = ${q(hero)}
    SX = ${focus.x.toFixed(3)}
    SY = ${focus.y.toFixed(3)}

    def aim(target, z):
        return clamp((target - 0.5) / ((1 - 1.0 / z) / 2), -1, 1)

    def words(c, i, t, top, size, x=84, align="left", width=900, bottom=False):
        head = b[i]["headline"]
        sub = b[i]["subtext"]
        hh = c.text_height(head, size, 800, width) if head else 0
        sh = c.text_height(sub, 44, 400, width) + 24 if sub else 0
        y = (c.safe_bottom - hh - sh - 20) if bottom else top
        used = 0
        if head:
            used = c.reveal_text(head, x, y, size, 800, "#FFFFFF", t, start=0.3, step=0.09, align=align, width=width, line_height=1.06, shadow=0.5)
        if sub:
            k = progress(t, 0.9, 0.8)
            c.text(sub, x, y + used + 22 + (1 - k) * 24, 44, 400, "#FFFFFF", align=align, alpha=0.92 * k, width=width, shadow=0.4)

    def finish(c, t, u, scrim_from=0.5):
        c.glow(lerp(-250, 1330, u), c.H * (0.34 + 0.1 * wobble(5, t, 0.6)), 760, "#FFFFFF", 0.1)
        c.rays(t, 0.76, p.glow, strength=0.09)
        c.bokeh(t, 7, p.glow2, seed=4, strength=0.2, region=(0.0, 0.0, 1.0, 0.8))
        c.vignette(0.5)
        c.fade(c.H * scrim_from, c.H * (1 - scrim_from), p.bg_a, 0.0, 0.9)

    def opening(i):
        def draw(c, t, u):
            c.photo(H, 0, 0, c.W, c.H, zoom=lerp(1.04, 1.26, u), pan_x=lerp(-0.45, 0.45, u), pan_y=0.1, tint=p.bg_a, tint_alpha=0.1)
            finish(c, t, u, 0.5)
            c.rect(84, c.safe_bottom - 372, 8 * progress(t, 0.2, 0.9), 250 * progress(t, 0.2, 0.9), p.accent, radius=4)
            words(c, i, t, 0, 104, x=124, width=860, bottom=True)
            c.logo()
        return draw

    def macro_top(i):
        def draw(c, t, u):
            c.photo(H, 0, 0, c.W, c.H, zoom=lerp(1.9, 2.4, u), pan_x=lerp(0.3, -0.2, u), pan_y=aim(SY - 0.06, 2.1), tint=p.bg_a, tint_alpha=0.08, bright=lerp(0.85, 1.05, progress(t, 0.0, 1.0)))
            finish(c, t, u, 0.52)
            words(c, i, t, 0, 100, bottom=True)
            c.logo()
        return draw

    def floating(i):
        def draw(c, t, u):
            c.backdrop(H, u, dim=0.6, blur=26, tint=p.bg_a, tint_alpha=0.35)
            k = progress(t, 0.1, 1.2)
            top = c.safe_top + 100
            c.photo(H, 84, top + (1 - k) * 90 + 10 * wobble(2, t, 0.8), 912, 840, shape="round", radius=44, zoom=lerp(1.08, 1.22, u), alpha=k, shadow=0.55)
            c.glow(lerp(1200, -100, u), top + 300, 600, "#FFFFFF", 0.1)
            c.bokeh(t, 6, p.glow, seed=9, strength=0.16, region=(0.0, 0.0, 1.0, 1.0))
            c.vignette(0.35)
            c.rect(84, top + 840 + 60, 110 * progress(t, 0.7, 0.7), 10, p.accent, radius=5)
            words(c, i, t, top + 840 + 96, 88)
            c.logo()
        return draw

    def macro_low(i):
        def draw(c, t, u):
            c.photo(H, 0, 0, c.W, c.H, zoom=lerp(1.7, 2.2, u), pan_x=lerp(-0.4, 0.4, u), pan_y=aim(SY + 0.14, 1.9), tint=p.bg_b, tint_alpha=0.1)
            finish(c, t, u, 0.5)
            words(c, i, t, 0, 100, bottom=True)
            c.logo()
        return draw

    def pan(i):
        def draw(c, t, u):
            c.photo(H, 0, 0, c.W, c.H, zoom=lerp(1.45, 1.6, u), pan_x=lerp(0.8, -0.8, u), pan_y=aim(SY, 1.5), tint=p.accent, tint_alpha=0.07)
            finish(c, t, u, 0.52)
            c.rect(84, c.safe_top + 40, 110 * progress(t, 0.2, 0.7), 10, p.accent, radius=5)
            words(c, i, t, c.safe_top + 76, 96)
            c.logo()
        return draw

    def signoff(i):
        def draw(c, t, u):
            c.backdrop(H, u, dim=0.7, blur=30, tint=p.bg_a, tint_alpha=0.4)
            k = progress(t, 0.1, 1.0)
            c.glow(540, 700, 1100, p.glow, 0.22 * k)
            c.ring(540, 700, 330 * (0.9 + 0.1 * k), progress(t, 0.2, 1.4), p.accent, 16, "#FFFFFF", 0.15)
            c.photo(H, 230, 390, 620, 620, shape="circle", zoom=lerp(1.1, 1.3, u), alpha=k, shadow=0.4)
            c.vignette(0.4)
            words(c, i, t, 1090, 100, x=540, align="center", width=860)
            c.logo()
        return draw

    makers = {"opening": opening, "macro_top": macro_top, "floating": floating, "macro_low": macro_low, "pan": pan, "signoff": signoff}
    order = ${JSON.stringify(styles)}
    moves = ${JSON.stringify(transitions)}
    for i in range(len(b)):
        video.add_scene(b[i]["seconds"], makers[order[i]](i), moves[i])
`;
}
