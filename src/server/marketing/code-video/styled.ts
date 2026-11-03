import type { Concept } from './concept.js';
import type { DesignBlueprint, SceneBlueprint } from '../reference/design.js';
import type { StyledScene, StyledSpec } from '../reference/styled.js';

/**
 * STYLE TRANSFER for video. The shots of a new video follow the reference shot by shot: how long each is, how the camera moves in it, how it joins the next (a hard cut, a
 * dissolve, a wipe, a zoom, a push), and how tightly it is framed; and what runs through the whole video follows the reference too: its colour grade (contrast, saturation,
 * warm or cool, teal-and-orange, faded blacks), film grain, vignette, letterbox bars, light leaks and flashes, a progress bar, a lower-third band, and the type of its
 * words and how they come in (static, fade, slide, kinetic, typed, pop, captions) with their box (pill, bar, highlight, underline). The pictures are the business's own
 * photos, moved by the code; the words are the business's own; the brand colour is the accent. Written as code and run in the same sandbox as every other code-drawn video.
 */
const q = (value: string) => JSON.stringify(value);
const n = (v: number) => Math.round(v * 1000) / 1000;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The reference's plan in the form the concept writer takes (scene count, lengths, camera), so the words are written for the shots that will carry them. */
export function styledDesign(design: DesignBlueprint, spec: StyledSpec): DesignBlueprint {
  const words = Math.min(7, Math.max(3, spec.scenes.length)); const scenes: SceneBlueprint[] = Array.from({ length: words }, (_, k) => { const from = Math.floor((k * spec.scenes.length) / words); const to = Math.max(from + 1, Math.floor(((k + 1) * spec.scenes.length) / words)); const group = spec.scenes.slice(from, to); const first = group[0]; return { seconds: group.reduce((s, x) => s + x.seconds, 0), role: k === 0 ? 'hook' : k === words - 1 ? 'closing' : 'scene', transition: first.transition, headline: spec.video.text.position === 'none' ? null : { position: spec.video.text.position, size: spec.video.text.size, align: spec.video.text.align }, product: null, camera: first.camera.move, objectMotion: '', textTiming: spec.video.text.effect }; });
  return { ...design, sceneCount: words, totalSeconds: spec.totalSeconds, pacing: spec.pacing, motion: { ...design.motion, scenes } };
}

export type StyledPhoto = { focus: { x: number; y: number }; quality: number };

/** The camera of a shot as numbers the script bakes in: zoom start and end, and pan start and end (-1..1) on each axis, aimed at the subject of the photo. */
export function cameraNumbers(scene: StyledScene, focus: { x: number; y: number }, close: boolean, index: number): { z0: number; z1: number; x0: number; x1: number; y0: number; y1: number; shake: number } {
  const a = clamp(scene.camera.amount, 0.15, 1); const base = (close ? 1.32 : scene.framing === 'wide' ? 1.06 : 1.16) + (index % 3) * 0.03; const aim = (t: number, z: number) => clamp((t - 0.5) / ((1 - 1 / z) / 2), -1, 1) * 0.75;
  const cx = (z: number) => aim(focus.x, z); const cy = (z: number) => aim(focus.y, z);
  switch (scene.camera.move) {
    case 'push_in': return { z0: base, z1: base + 0.1 + 0.3 * a, x0: cx(base), x1: cx(base + 0.3 * a), y0: cy(base), y1: cy(base + 0.3 * a), shake: 0 };
    case 'pull_out': return { z0: base + 0.1 + 0.3 * a, z1: base, x0: cx(base + 0.3 * a), x1: cx(base), y0: cy(base + 0.3 * a), y1: cy(base), shake: 0 };
    case 'pan_left': return { z0: base + 0.12, z1: base + 0.12, x0: 0.6 * a + 0.1, x1: -0.6 * a - 0.1, y0: cy(base), y1: cy(base), shake: 0 };
    case 'pan_right': return { z0: base + 0.12, z1: base + 0.12, x0: -0.6 * a - 0.1, x1: 0.6 * a + 0.1, y0: cy(base), y1: cy(base), shake: 0 };
    case 'tilt_up': return { z0: base + 0.12, z1: base + 0.12, x0: cx(base), x1: cx(base), y0: 0.6 * a + 0.1, y1: -0.6 * a - 0.1, shake: 0 };
    case 'tilt_down': return { z0: base + 0.12, z1: base + 0.12, x0: cx(base), x1: cx(base), y0: -0.6 * a - 0.1, y1: 0.6 * a + 0.1, shake: 0 };
    case 'handheld': return { z0: base + 0.1, z1: base + 0.1, x0: cx(base), x1: cx(base), y0: cy(base), y1: cy(base), shake: 0.05 + 0.08 * a };
    default: return { z0: base, z1: base + 0.04, x0: cx(base), x1: cx(base), y0: cy(base), y1: cy(base), shake: 0 };
  }
}

const SIZE = { s: 74, m: 94, l: 114, xl: 140 } as const;
const WEIGHT = { light: 400, regular: 400, bold: 700, black: 800 } as const;
const YPOS = { top: 'c.safe_top + 40', upper: 'c.H * 0.2', middle: 'c.H * 0.42', lower: 'c.H * 0.64', bottom: 'c.safe_bottom - 360', none: 'c.H * 0.64' } as const;

/**
 * The script for a styled video. `photos[i]` is the picture name for shot i (p1, p2...), `focus[i]` where its subject is. `wordsAt[i]` says which concept scene's words are on shot i (or -1 for none).
 * Shots with no words are pure picture, as in a montage. `accent` is the brand colour, `ink` the text colour on picture.
 */
export function buildStyledScript({ concept, spec, photos, focus, accent, wordsAt }: { concept: Concept; spec: StyledSpec; photos: string[]; focus: Array<{ x: number; y: number }>; accent: string; wordsAt: number[] }): string {
  const { look, video } = spec; const shots = spec.scenes; const total = shots.reduce((s, x) => s + x.seconds, 0); let acc = 0; const offs = shots.map((s) => { const o = acc; acc += s.seconds; return n(o); });
  const cams = shots.map((s, i) => cameraNumbers(s, focus[i % focus.length], s.framing === 'close', i)); const text = video.text; const has = (o: string) => (video.overlays as string[]).includes(o);
  // the grade: contrast, saturation, brightness, warmth, split-tone and faded blacks, from what was measured in the reference
  const contrast = clamp(0.9 + (look.contrast - 0.45) * 0.9, 0.85, 1.4); const saturation = clamp(look.saturation / 0.38, 0.55, 1.45); const brightness = clamp(1 + (look.brightness - 0.45) * 0.5, 0.82, 1.2); const warm = clamp(look.warmth * 4, -1, 1); const teal = look.tint === 'teal_orange' ? 0.75 : 0; const fade = look.fade;
  const vignette = Math.max(has('vignette') ? 0.4 : 0, look.vignette * 0.9); const grain = Math.max(has('film_grain') ? 0.05 : 0, look.grain * 0.09); const bars = look.letterbox > 0.02 || has('letterbox') ? clamp(look.letterbox || 0.1, 0.06, 0.2) : 0;
  const ink = text.colour === 'dark' ? '#111111' : text.colour === 'accent' ? accent : '#FFFFFF'; const ys = YPOS[text.position]; const size = SIZE[text.size]; const wt = WEIGHT[text.weight]; const align = text.align;
  const scrim = has('scrim_bottom') || text.position === 'lower' || text.position === 'bottom'; const scrimTop = has('scrim_top') || text.position === 'top' || text.position === 'upper';
  const ends = shots.map((s) => s.transition); const tsec = shots.map((s) => (s.transition === 'cut' ? 0.08 : s.transition === 'zoom' ? 0.35 : s.transition === 'push' ? 0.3 : 0.55));
  return `def build(video):
    p = video.palette
    b = video.brief["scenes"]
    PH = ${JSON.stringify(shots.map((_, i) => photos[i % photos.length]))}
    WORDS = ${JSON.stringify(wordsAt.slice(0, shots.length))}
    DUR = ${JSON.stringify(shots.map((s) => n(s.seconds)))}
    OFFS = ${JSON.stringify(offs)}
    TOTAL = ${n(total)}
    CAM = ${JSON.stringify(cams.map((c) => [n(c.z0), n(c.z1), n(c.x0), n(c.x1), n(c.y0), n(c.y1), n(c.shake)]))}
    TRAN = ${JSON.stringify(ends.map((e) => (e === 'cut' ? 'fade' : e)))}
    TSEC = ${JSON.stringify(tsec)}
    ACCENT = ${q(accent)}
    INK = ${q(ink)}

    def words(c, t, i, k, dur):
        head = b[k]["headline"]
        sub = b[k]["subtext"]
        ${text.case === 'upper' ? 'head = head.upper()' : text.case === 'title' ? 'head = head.title()' : 'head = head'}
        ${text.case === 'upper' ? 'sub = sub.upper()' : 'sub = sub'}
        if not head:
            return
        y = ${ys}
        x = ${align === 'left' ? 84 : align === 'right' ? 'c.W - 84' : 'c.W / 2'}
        size = ${size}
        wt = ${wt}
        wdt = 880
        hh = c.text_height(head, size, wt, wdt)
        start = 0.2
        k1 = progress(t, start, 0.7)
        ${text.box === 'pill' || text.box === 'highlight' ? `tw = min(wdt, c.text_width(head, size, wt)) + 56
        bx = ${align === 'left' ? 84 - 28 : align === 'right' ? 'c.W - 84 - tw + 28' : '(c.W - tw) / 2'}
        c.rect(bx, y - 16, tw, hh + 30, ACCENT, radius=${text.box === 'pill' ? 40 : 10}, alpha=0.95 * k1)` : text.box === 'bar' ? `c.rect(0, y - 30, c.W, hh + 60 + (60 if sub else 0), "#000000", alpha=0.55 * k1)` : ''}
        ${has('lower_third') ? 'c.rect(60, y - 8, 12, hh + 16, ACCENT, radius=6, alpha=k1)' : ''}
        tx = x + ${has('lower_third') ? 28 : 0}
        col = ${text.box === 'pill' || text.box === 'highlight' ? 'p.on_accent' : 'INK'}
        ${text.effect === 'kinetic' ? 'c.reveal_text(head, tx, y, size, wt, col, t, start=start, step=0.09, align="' + align + '", width=wdt, line_height=1.06, shadow=0.45)' : text.effect === 'typed' ? `n = int(len(head) * progress(t, start, min(1.4, dur * 0.6), "linear"))
        c.text(head[:n], tx, y, size, wt, col, align="${align}", width=wdt, shadow=0.4)` : text.effect === 'pop' ? `c.push(0, y - 20, c.W, hh + 40, alpha=k1, scale=lerp(0.88, 1.0, k1))
        c.text(head, tx, 20, size, wt, col, align="${align}", width=wdt, shadow=0.4)
        c.pop()` : text.effect === 'slide' ? `c.text(head, tx + (1 - k1) * ${align === 'right' ? 90 : -90}, y, size, wt, col, align="${align}", alpha=k1, width=wdt, shadow=0.4)` : text.effect === 'static' ? `c.text(head, tx, y, size, wt, col, align="${align}", width=wdt, shadow=0.4)` : `c.text(head, tx, y, size, wt, col, align="${align}", alpha=k1, width=wdt, shadow=0.4)`}
        ${text.box === 'underline' ? 'c.rect(tx if "' + align + '" == "left" else (c.W / 2 - 80), y + hh + 10, 160 * k1, 10, ACCENT, radius=5)' : ''}
        if sub:
            k2 = progress(t, start + 0.5, 0.7)
            c.text(sub, tx, y + hh + ${text.box === 'underline' ? 40 : 22} + (1 - k2) * 20, 42, 400, INK, align="${align}", alpha=0.92 * k2, width=wdt, shadow=0.4)

    def aim(target, z):
        return clamp((target - 0.5) / ((1 - 1.0 / z) / 2), -1, 1)

    def shot(i):
        def draw(c, t, u):
            z0 = CAM[i][0]
            z1 = CAM[i][1]
            e = ease("ease_in_out", u)
            sh = CAM[i][6]
            c.photo(PH[i], 0, 0, c.W, c.H, zoom=lerp(z0, z1, e) + sh * 0.4 * wobble(i + 3, t, 1.5), pan_x=lerp(CAM[i][2], CAM[i][3], e) + sh * wobble(i + 5, t, 2.4), pan_y=lerp(CAM[i][4], CAM[i][5], e) + sh * wobble(i + 9, t, 2.1))
            c.grade(contrast=${n(contrast)}, saturation=${n(saturation)}, brightness=${n(brightness)}, warm=${n(warm)}, teal_orange=${n(teal)}, fade=${n(fade)})
            ${has('light_leak') ? 'c.glow(lerp(-250, 1330, u), c.H * 0.3, 900, "#FFB86B", 0.16)' : ''}
            ${scrim ? 'c.fade(c.H * 0.45, c.H * 0.55, "#000000", 0.0, 0.7)' : ''}
            ${scrimTop ? 'c.fade(0, c.H * 0.35, "#000000", 0.55, 0.0)' : ''}
            ${vignette > 0.02 ? `c.vignette(${n(clamp(vignette, 0.1, 0.9))})` : ''}
            ${grain > 0.004 ? `c.grain(${n(grain)}, int(t * 30) + i * 101)` : ''}
            ${bars ? `c.rect(0, 0, c.W, c.H * ${n(bars)}, "#000000")
            c.rect(0, c.H - c.H * ${n(bars)}, c.W, c.H * ${n(bars)}, "#000000")` : ''}
            if WORDS[i] >= 0:
                words(c, t, i, WORDS[i], DUR[i])
            c.logo()
            ${has('flash') ? 'if t < 0.14 and i > 0:\n                c.rect(0, 0, c.W, c.H, "#FFFFFF", alpha=0.55 * (1 - t / 0.14))' : ''}
            ${has('progress_bar') ? 'c.rect(0, c.H - 12, c.W * (OFFS[i] + t) / TOTAL, 12, ACCENT)' : ''}
            ${has('frame') ? 'c.rect(0, 0, c.W, 22, INK, alpha=0.9)\n            c.rect(0, c.H - 22, c.W, 22, INK, alpha=0.9)\n            c.rect(0, 0, 22, c.H, INK, alpha=0.9)\n            c.rect(c.W - 22, 0, 22, c.H, INK, alpha=0.9)' : ''}
        return draw

    for i in range(len(DUR)):
        video.add_scene(DUR[i], shot(i), TRAN[i], TSEC[i])
`.replace(/\n\s*\n(?=\s)/g, '\n');
}
