import { mkdir, stat, writeFile } from 'node:fs/promises';
import * as nodeModule from 'node:module';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { exportAssets } from './index.js';
import { codeVideoSupport, runSandboxed } from './sandbox.js';
import type { CodeBrief } from './generate.js';
import { ffmpegPath } from '../standard-video/ffmpeg.js';
import type { MediaStorage } from '../standard-video/storage.js';
import type { BrandKit } from '../standard-video/templates.js';
import type { Idea } from './idea.js';
import type { MethodId } from './production.js';
import { reviewClaims, unsupportedClaims } from './strategy.js';
import type { Concept } from './concept.js';
import { cleanBeats, compileBeats, ICON_NAMES, iconFor } from './presets.js';

/**
 * The TIMELINE producer: motion-graphics, product-showcase, character/icon and diagrammatic ads. The model writes a TIMELINE SPEC (plain data: elements with a start,
 * an end, an entrance, tweens), plain code checks and tidies it (captions always on, nothing in the area platforms cover, no overlapping words, a business end card),
 * and Pilot's trusted timeline renderer draws it as one continuous piece of motion. There is no model-written Python, so there is no lint deadlock, and nothing hard-cuts.
 */
export type TimelineSpec = { seconds: number; theme?: 'dark' | 'light'; background?: Record<string, unknown>; camera?: Array<Record<string, unknown>>; elements: Array<Record<string, unknown> & { type: string; id?: string; at: number }> };
type Complete = (system: string, prompt: string) => Promise<string>;

const TYPES = ['text', 'card', 'phone', 'chip', 'button', 'icon', 'character', 'node', 'connector', 'counter', 'ring', 'shape', 'logo', 'glow', 'pool'] as const;
const INS = ['pop', 'rise', 'fade', 'slide_left', 'slide_right', 'zoom', 'type', 'draw', 'none'];
const OUTS = ['fade', 'drop', 'shrink', 'none'];
const EASES = ['linear', 'ease_out', 'ease_in_out', 'back_out', 'expo_out'];
const PROPS = ['x', 'y', 'scale', 'alpha', 'rotate', 'color', 'fill', 'cover', 'clear'];
const KEYS = ['id', 'type', 'at', 'until', 'x', 'y', 'in', 'in_dur', 'out', 'out_dur', 'tweens', 'scale', 'rotate', 'float', 'text', 'size', 'weight', 'color', 'align', 'width', 'stagger', 'step', 'highlight', 'highlight_color', 'case', 'line_height', 'shadow', 'title', 'tag', 'rows', 'row_step', 'dark', 'w', 'h', 'children', 'screen_light', 'tone', 'pulse', 'name', 'disc', 'kind', 'r', 'talk', 'radar', 'icon', 'label', 'label_color', 'value', 'count_dur', 'shape', 'radius', 'from', 'to', 'style', 'strength', 'steps', 'fill', 'cover', 'leaves', 'clear'];
const num = (v: unknown, lo: number, hi: number, d: number) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\u2010-\u2015\u2212]/g, '-').replace(/\s+/g, ' ').trim().slice(0, max) : '');

/** Tidies one element: unknown keys and values are dropped, numbers clamped, positions kept on screen. */
function cleanElement(raw: unknown, total: number, nested = false): (Record<string, unknown> & { type: string; at: number }) | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>; if (!(TYPES as readonly string[]).includes(String(r.type))) return null;
  const e: Record<string, unknown> = {}; for (const k of KEYS) if (r[k] !== undefined) e[k] = r[k];
  e.type = String(r.type); if (r.id) e.id = str(r.id, 24);
  e.at = num(r.at, 0, total - 0.3, 0); if (r.until !== undefined && r.until !== null) e.until = num(r.until, Number(e.at) + 0.3, total, total);
  e.x = num(r.x, nested ? -0.5 : 0.04, nested ? 1.5 : 0.96, 0.5); e.y = num(r.y, nested ? -0.5 : 0.04, nested ? 1.5 : 0.96, 0.5);
  if (!INS.includes(String(e.in))) e.in = e.type === 'connector' ? 'draw' : 'fade'; if (e.out !== undefined && !OUTS.includes(String(e.out))) e.out = 'fade';
  if (e.in_dur !== undefined) e.in_dur = num(e.in_dur, 0.15, 2.5, 0.55); if (e.out_dur !== undefined) e.out_dur = num(e.out_dur, 0.15, 1.5, 0.4);
  if (e.scale !== undefined) e.scale = num(e.scale, 0.2, 3, 1); if (e.rotate !== undefined) e.rotate = num(e.rotate, -45, 45, 0); if (e.float !== undefined) e.float = num(e.float, 0, 2, 0);
  for (const k of ['text', 'title', 'tag', 'label']) if (e[k] !== undefined) e[k] = str(e[k], k === 'text' ? 90 : 50);
  if (e.size !== undefined) e.size = num(e.size, 20, 220, 72); if (e.width !== undefined) e.width = num(e.width, 200, 960, 912); if (e.w !== undefined) e.w = num(e.w, 120, 980, 700); if (e.h !== undefined) e.h = num(e.h, 80, 1500, 400); if (e.r !== undefined) e.r = num(e.r, 40, 260, 100);
  if (e.name !== undefined) { const n = iconFor(e.name); if (n) e.name = n; else return null; } if (e.icon !== undefined) { const n = iconFor(e.icon); if (n) e.icon = n; else return null; }
  if (e.kind !== undefined) e.kind = e.kind === 'logo' ? 'logo' : 'pilot'; if (e.highlight !== undefined) e.highlight = (Array.isArray(e.highlight) ? e.highlight : []).map((w) => str(w, 24)).filter(Boolean).slice(0, 4);
  if (e.stagger !== undefined) e.stagger = e.stagger === 'word' ? 'word' : undefined; if (e.value !== undefined) e.value = num(e.value, 0, 1_000_000, 0); if (e.type === 'logo') e.size = num(r.size, 120, 520, 360); if (e.type === 'pool') { e.w = num(e.w, 400, 1080, 1080); e.h = num(e.h, 260, 840, 760); e.leaves = Math.round(num(e.leaves, 0, 14, 0)); e.fill = num(e.fill, 0, 1, 1); e.cover = num(e.cover, 0, 1, 0); e.clear = num(e.clear, 0, 1, 0); }
  e.tweens = (Array.isArray(r.tweens) ? r.tweens : []).flatMap((w) => { const q = (w && typeof w === 'object' ? w : {}) as Record<string, unknown>; if (!PROPS.includes(String(q.prop))) return []; return [{ prop: q.prop, to: q.prop === 'color' ? q.to : q.prop === 'scale' ? num(q.to, 0.2, 1.8, 1) : ['fill', 'cover', 'clear'].includes(String(q.prop)) ? num(q.to, 0, 1, 0) : num(q.to, -2, 4, 0), ...(q.from !== undefined ? { from: q.prop === 'color' ? q.from : num(q.from, -2, 4, 0) } : {}), at: num(q.at, 0, total, 0), dur: num(q.dur, 0.1, 4, 0.6), ease: EASES.includes(String(q.ease)) ? q.ease : 'ease_in_out' }]; }).slice(0, 8);
  if (Array.isArray(r.rows)) e.rows = r.rows.slice(0, 6).map((row) => { const q = (row && typeof row === 'object' ? row : {}) as Record<string, unknown>; return { label: str(q.label, 36), ...(q.value ? { value: str(q.value, 20) } : {}), ...(q.status === 'done' || q.status === 'pending' ? { status: q.status } : {}) }; }).filter((row) => row.label);
  if (nested === false && Array.isArray(r.children)) e.children = r.children.slice(0, 10).map((ch) => cleanElement(ch, total, true)).filter((ch): ch is NonNullable<typeof ch> => !!ch);
  if (e.type === 'connector') { e.from = str(r.from, 24); e.to = str(r.to, 24); e.width = num(r.width, 2, 14, 7); }
  return e as Record<string, unknown> & { type: string; at: number };
}

const words = (e: Record<string, unknown>): string[] => [e.text, e.title, e.tag, e.label, ...(Array.isArray(e.rows) ? (e.rows as Array<Record<string, unknown>>).flatMap((r) => [r.label, r.value]) : []), ...(Array.isArray(e.children) ? (e.children as Array<Record<string, unknown>>).flatMap(words) : [])].filter((w): w is string => typeof w === 'string' && !!w);
const visible = (e: Record<string, unknown>, total: number): [number, number] => [Number(e.at), e.until !== undefined ? Number(e.until) : total];
const textBox = (e: Record<string, unknown>) => { const size = Number(e.size ?? 72); const text = String(e.text ?? ''); const width = Math.min(Number(e.width ?? 912), 960); const lines = Math.max(1, Math.ceil((text.length * size * 0.56) / width)); const w = Math.min(width, text.length * size * 0.56); const h = lines * size * 1.1; const cx = Number(e.x) * 1080; const cy = Number(e.y) * 1920; return { x0: cx - w / 2, x1: cx + w / 2, y0: cy - h / 2, y1: cy + h / 2 }; };

/** Plain checks of a timeline: what the writer is sent back to fix (captions, overlaps, crowding, dead stretches). */
export function timelineIssues(spec: TimelineSpec): string[] {
  const issues: string[] = []; const total = spec.seconds; const texts = spec.elements.filter((e) => e.type === 'text' && e.text);
  for (let a = 0; a + 2.2 <= total - 0.3; a += 1) { if (!texts.some((e) => { const [s, u] = visible(e, total); return s < a + 2.2 && u > a; })) { issues.push(`There are no words on screen between ${a.toFixed(0)}s and ${(a + 2.2).toFixed(1)}s. The video is watched with the sound off: some caption must always be on screen.`); break; } }
  if (!texts.some((e) => Number(e.at) <= 0.7)) issues.push('The hook has no words in the first 0.7 seconds. Open with a big line of type that creates curiosity.');
  for (let i = 0; i < texts.length; i += 1) for (let j = i + 1; j < texts.length; j += 1) {
    const [a0, a1] = visible(texts[i], total); const [b0, b1] = visible(texts[j], total); if (Math.min(a1, b1) - Math.max(a0, b0) < 0.4) continue;
    const A = textBox(texts[i]); const B = textBox(texts[j]); const ox = Math.min(A.x1, B.x1) - Math.max(A.x0, B.x0); const oy = Math.min(A.y1, B.y1) - Math.max(A.y0, B.y0);
    if (ox > 0 && oy > 0 && (ox * oy) / Math.min((A.x1 - A.x0) * (A.y1 - A.y0), (B.x1 - B.x0) * (B.y1 - B.y0)) > 0.12) { issues.push(`The words "${String(texts[i].text).slice(0, 30)}" and "${String(texts[j].text).slice(0, 30)}" are on screen together at the same place. Move one, or end the first before the second arrives.`); break; }
  }
  const solids = spec.elements.filter((e) => ['phone', 'card', 'node', 'character', 'button', 'pool', 'chip'].includes(e.type));
  for (const tx of texts) { const A = textBox(tx); const [a0, a1] = visible(tx, total); for (const o of solids) { const [b0, b1] = visible(o, total); if (Math.min(a1, b1) - Math.max(a0, b0) < 0.5) continue; const w = Number(o.w ?? (o.type === 'phone' ? 600 : o.type === 'card' ? 800 : o.type === 'chip' ? String(o.text ?? '').length * Number(o.size ?? 44) * 0.6 + 120 : Number(o.r ?? 100) * 2.4)); const h = Number(o.h ?? (o.type === 'phone' ? 960 : o.type === 'card' ? 520 : o.type === 'button' ? 112 : o.type === 'chip' ? 104 : Number(o.r ?? 100) * 2.4)); const cx = Number(o.x) * 1080; const cy = Number(o.y) * 1920; const ox = Math.min(A.x1, cx + w / 2) - Math.max(A.x0, cx - w / 2); const oy = Math.min(A.y1, cy + h / 2) - Math.max(A.y0, cy - h / 2); if (ox > 0 && oy > 0 && (ox * oy) / ((A.x1 - A.x0) * (A.y1 - A.y0)) > 0.1) { issues.push(`The words "${String(tx.text).slice(0, 30)}" sit over the ${o.type} "${String(o.id ?? '')}". Keep type in its own zone (headline y 0.08 to 0.28, caption y 0.74 to 0.8) and the ${o.type} between them.`); break; } } }
  for (let sec = 0.5; sec < total; sec += 1) { const n = spec.elements.filter((e) => e.type !== 'glow' && e.type !== 'connector' && (() => { const [s, u] = visible(e, total); return s <= sec && u >= sec; })()).length; if (n > 11) { issues.push(`${n} elements are on screen at ${sec.toFixed(1)}s: too crowded. Clear the old ones (give them "until") before the next idea arrives; leave negative space.`); break; } }
  const events = [...spec.elements.flatMap((e) => [Number(e.at), ...((e.tweens as Array<{ at: number; dur?: number }> | undefined) ?? []).flatMap((w) => { const out = [Number(w.at)]; for (let t = Number(w.at) + 1; t < Number(w.at) + Number(w.dur ?? 0.6); t += 1) out.push(t); return out; }), ...((e.children as Array<Record<string, unknown>> | undefined) ?? []).flatMap((ch) => [Number(ch.at), ...(Array.isArray(ch.rows) ? (ch.rows as unknown[]).map((_, i) => Number(ch.at) + 0.5 + i * 0.5) : [])])]), ...((spec.camera ?? []).flatMap((m) => { const out: number[] = []; for (let t = Number(m.at); t <= Number(m.at) + Number(m.dur); t += 1) out.push(t); return out; }))].sort((a, b) => a - b);
  for (let i = 1; i < events.length; i += 1) if (events[i] - events[i - 1] > 1.5) { issues.push(`Nothing enters or moves between ${events[i - 1].toFixed(1)}s and ${events[i].toFixed(1)}s. Keep something animating: a new element, a tween, a camera move.`); break; }
  return issues.slice(0, 7);
}

/** Cleans a whole spec: whitelists, clamps, keeps type out of the area platforms cover, never lets the words go small, and ends on the business and its call to action. */
export function cleanTimeline(raw: unknown, { seconds, business, cta }: { seconds: number; business: string; cta: string }): TimelineSpec | null {
  if (!raw || typeof raw !== 'object') return null; const r = raw as Record<string, unknown>;
  const total = Math.max(6, Math.min(45, seconds)); const asked = num(r.seconds, 4, 90, total); const scale = total / asked;
  let elements = (Array.isArray(r.elements) ? r.elements : []).map((e) => { const q = e && typeof e === 'object' ? { ...(e as Record<string, unknown>) } : e; if (q && typeof q === 'object') { const o = q as Record<string, unknown>; for (const k of ['at', 'until']) if (typeof o[k] === 'number') o[k] = Math.round((o[k] as number) * scale * 100) / 100; for (const w of (Array.isArray(o.tweens) ? o.tweens : []) as Array<Record<string, unknown>>) if (w && typeof w.at === 'number') w.at = Math.round(w.at * scale * 100) / 100; } return cleanElement(q, total); }).filter((e): e is NonNullable<typeof e> => !!e).slice(0, 70);
  const ids = new Set(elements.map((e) => e.id).filter(Boolean)); elements = elements.filter((e) => e.type !== 'connector' || (ids.has(e.from as string) && ids.has(e.to as string)));
  for (const e of elements) { if (e.type === 'icon') e.size = Math.min(Number(e.size ?? 120), 200); if (e.type === 'shape') { e.w = Math.min(Number(e.w ?? 300), 450); e.h = Math.min(Number(e.h ?? 300), 450); } if (e.type === 'phone') { e.w = Math.max(480, Math.min(Number(e.w ?? 600), 640)); e.h = Math.max(760, Math.min(Number(e.h ?? 960), 1000)); } }
  elements = [...elements.filter((e) => e.type !== 'text'), ...elements.filter((e) => e.type === 'text')]; // type is drawn last, so nothing is ever on top of the words
  for (const e of elements) if (e.type === 'text') { e.size = Math.max(48, Number(e.size ?? 72)); e.y = Math.max(0.08, Math.min(0.78, Number(e.y))); e.width = Math.min(Number(e.width ?? 912), 920); e.x = Math.max(0.12, Math.min(0.88, Number(e.x))); }
  // everything on a phone's screen is kept inside the screen: sized to fit and moved in, so the frame never clips it
  for (const ph of elements.filter((e) => e.type === 'phone')) {
    const sw = Number(ph.w ?? 600) - 28 - 24; const sh = Number(ph.h ?? 960) - 100 - 24; const kids = (ph.children as Array<Record<string, unknown>> | undefined) ?? [];
    for (const k of kids) {
      let w = k.type === 'card' ? Math.min(Number(k.w ?? 500), sw) : k.type === 'button' ? Math.min(Number(k.w ?? 400), sw) : k.type === 'chip' ? 0 : Math.min(Number(k.width ?? sw), sw); let h = k.type === 'card' ? Math.min(Number(k.h ?? 380), sh) : k.type === 'button' ? 112 : k.type === 'text' ? Math.ceil((String(k.text ?? '').length * Number(k.size ?? 48) * 0.56) / Math.max(200, w)) * Number(k.size ?? 48) * 1.1 : 100;
      if (k.type === 'text') { k.size = Math.max(36, Math.min(Number(k.size ?? 48), 64)); k.width = w; h = Math.ceil((String(k.text ?? '').length * Number(k.size) * 0.56) / Math.max(200, w)) * Number(k.size) * 1.1; }
      if (k.type === 'chip') { const size = Math.min(Number(k.size ?? 40), 44); k.size = size; w = Math.min(sw, String(k.text ?? '').length * size * 0.6 + 120); h = 104; }
      if (k.type === 'card') { k.w = w; k.h = h; } if (k.type === 'button') k.w = w;
      const fx = Math.max((w / 2 + 12) / sw, Math.min(1 - (w / 2 + 12) / sw, Number(k.x))); const fy = Math.max((h / 2 + 12) / sh, Math.min(1 - (h / 2 + 12) / sh, Number(k.y))); k.x = fx; k.y = fy;
    }
  }
  const last = total - 2.6; const name = business.toLowerCase();
  const endsOnBrand = elements.some((e) => (e.type === 'logo' || (e.type === 'text' && String(e.text).toLowerCase().includes(name))) && visible(e, total)[1] >= total - 0.4);
  if (!endsOnBrand) elements.push({ type: 'logo', id: 'brand_end', at: Math.max(0.5, last), x: 0.5, y: 0.34, size: 220, in: 'pop', until: total } as never);
  if (!elements.some((e) => (e.type === 'button' || e.type === 'text') && Number(e.at) >= last - 0.8 && visible(e, total)[1] >= total - 0.4 && e.id !== 'brand_end') && cta) elements.push({ type: 'button', id: 'cta_end', at: Math.max(0.8, last + 0.4), x: 0.5, y: 0.66, w: 760, text: cta.slice(0, 40), in: 'pop', pulse: true, until: total } as never);
  return elements.length >= 4 ? { seconds: total, theme: r.theme === 'light' ? 'light' : 'dark', ...(r.background && typeof r.background === 'object' ? { background: r.background as Record<string, unknown> } : {}), ...(Array.isArray(r.camera) ? { camera: (r.camera as Array<Record<string, unknown>>).slice(0, 6).map((m) => ({ at: num(m.at, 0, total, 0), dur: num(m.dur, 0.3, 4, 1), zoom: num(m.zoom, 0.8, 1.6, 1), x: num(m.x, -0.2, 0.2, 0), y: num(m.y, -0.2, 0.2, 0) })) } : {}), elements } : null;
}

const WRITER = `You are Pilot's motion designer. You are given a creative idea with a timed structure and you write the AD as a list of BEATS for a vertical 9:16, muted-friendly, always-captioned social ad. You do NOT place anything: for each beat you pick a COMPOSITION PRESET and fill in its content; Pilot's renderer lays it out so nothing collides, clips or sits still. Beats run one after another as one continuous piece of motion.
PRESETS (use each as often as the story needs; the seconds of all beats add up to the length asked; a beat is 3 to 8 seconds):
- "headline_illustration": {"headline" (up to 6 words, big kinetic type), "highlight": ["one key word"], "illustration": {"kind": "pool", "story": "leaves" | "clear" | "cover_on" | "cover_off" | "fill"} OR {"kind": "icons", "items": [{"icon": ICON, "label" (up to 14 chars)}] (2 to 4)}, "caption" (up to 8 words)}. The "pool" illustration is a top-down swimming pool: story "leaves" = leaves floating on it (the problem), "clear" = the leaves swept away, "cover_on" = the winter cover sliding on (a closing), "cover_off" = the cover sliding off (an opening), "fill" = the water level rising. USE THE POOL ILLUSTRATION whenever the business is a pool service (a closing is leaves, then clear, then cover_on; an opening is cover_off, then fill). ICON is one of: ${ICON_NAMES.filter((n) => n !== 'star').join(', ')}.
- "hero_phone": {"headline", "highlight", "screens": [{"title" (up to 16 chars), "tag" (up to 8 chars), "rows": [{"label" (up to 18 chars, a real thing the product does or shows), "status": "done" | "pending"}] (2 to 4)}] (1 to 3 screens, shown one after another), "floating": [{"title" (up to 12 chars: a real result or benefit such as Booked, Confirmed or 3 new leads, never a UI word like Cards or Badge), "tag"}] (0 to 2 small cards that float beside the phone), "caption"}. For software and anything a screen can demonstrate.
- "big_number": {"headline", "value" (a number from the business's own facts), "prefix", "suffix", "unit" (what it counts), "caption"}.
- "cta_end": {"headline" (up to 5 words), "button" (a real way to act: "Book now", "Get started"), "contact": [the business's real web address and/or phone, from the facts, up to 2]} ALWAYS the last beat: the renderer puts the business's logo, then your headline, a button and the contact lines in reserved slots.
Rules: follow the idea's shots in order; the first beat is the hook (big type that creates curiosity, in the first 3 seconds); only the business's own words and facts (no invented prices, hours, claims, awards, years, certifications, no "trusted"/"best"/"guaranteed"); the video is watched with the sound off so every beat has words; sample data on a phone screen is fine; short, concrete words; every headline names something specific the business does or a specific problem it solves (never a vague or poetic line such as "could sleep" or "tucks, protects, preserves"), and no two beats repeat a headline. Each beat is a FLAT object, for example {"preset": "headline_illustration", "seconds": 4, "headline": "...", "illustration": {"kind": "pool", "story": "leaves"}, "caption": "..."}. Reply with ONLY JSON: {"beats": [ ... ]}.`;
const BEAT_NOTES: Record<string, string> = { motion_graphics: 'Lead with big kinetic type and illustrations.', product_showcase: 'Lead with the phone (hero_phone) so the product is shown working.', character_icon: 'Lead with icons.', diagrammatic: 'Show how the pieces connect with icons.' };

export async function writeTimeline({ idea, method, business, seconds, direction, complete, feedback, logo, request }: { /** the owner's own words and the business's facts, so the copy stays about what the business really does */ request?: string; idea: Idea; method: MethodId; business: { name: string; type: string; description: string; services: string[] }; seconds: number; direction?: string; complete: Complete; feedback?: string[]; logo?: boolean }): Promise<TimelineSpec | null> {
  const prompt = `${request ? `THE OWNER'S WORDS AND THE BUSINESS'S OWN FACTS (the copy must come from these and be about the business's real services, never about unrelated products)\n${request.slice(0, 1400)}\n\n` : ''}THE BUSINESS: ${business.name} (${business.type}). ${business.description}\nServices: ${business.services.slice(0, 8).join(', ') || 'not listed'}\nLength: ${seconds} seconds\n${direction ? `\nWHAT THE BUSINESS NEEDS FROM THIS VIDEO\n${direction}\n` : ''}\nPRODUCTION METHOD: ${method}. ${/\bpool/i.test(`${business.name} ${business.type} ${business.services.join(' ')}`) ? 'This is a pool business: at least three beats MUST be headline_illustration beats with the pool illustration (leaves, then clear, then cover_on for a closing); do not use hero_phone.' : (BEAT_NOTES[method] ?? '')}\n\nTHE CREATIVE IDEA: "${idea.title}": ${idea.logline}\nStory: ${idea.story}\nHook: ${idea.hook}\nPayoff: ${idea.payoff}\nCall to action: ${idea.cta}\nTimed structure:\n${idea.shots.map((s, i) => `${i + 1}. [${s.beat}, ${s.seconds}s] ${s.still} | motion: ${s.motion}${s.words ? ` | words: "${s.words}"` : ''}`).join('\n')}${feedback?.length ? `\n\nFIX THESE PROBLEMS FROM THE LAST VERSION\n${feedback.map((f) => `- ${f}`).join('\n')}` : ''}`;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const reply = await complete(WRITER, prompt).catch(() => ''); let body: unknown = null; try { body = JSON.parse(/\{[\s\S]*\}/.exec(reply)?.[0] ?? ''); } catch { /* try again */ }
    const dbg = (body as { beats?: Array<Record<string, unknown>> } | null)?.beats; if (process.env.PILOT_DEBUG_TIMELINE) console.error('[timeline writer]', JSON.stringify(dbg ?? body ?? reply.slice(0, 600)).slice(0, 1600));
    const phone = /\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}/.exec(request ?? '')?.[0]; const site = /WEBSITE https?:\/\/(?:www\.)?([^\s/]+)/.exec(request ?? '')?.[1]; const beats = cleanBeats(body, seconds, { contacts: [site, phone].filter((c): c is string => !!c), poolOk: /\bpool/i.test(`${business.name} ${business.type} ${business.description} ${business.services.join(' ')} ${idea.story}`) }); if (!beats) continue;
    const spec = cleanTimeline(compileBeats(beats, { logo: !!logo, business: business.name }), { seconds, business: business.name, cta: idea.cta.split(/[.;,]/)[0] }); if (spec) return spec;
  }
  return null;
}

const mixHex = (a: string, b: string, k: number) => { const x = (h: string, i: number) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16); return `#${[0, 1, 2].map((i) => Math.round(x(a, i) + (x(b, i) - x(a, i)) * k).toString(16).padStart(2, '0')).join('')}`.toUpperCase(); };
/** The dark palette from the brand: the deep brand colour darkened for the background, the brand's action colour (orange, say) for buttons and key accents, its main blue for water and secondary elements. */
export const brandPalette = (kit: BrandKit) => ({ dark: true, bg_a: mixHex(kit.secondary, '#000000', 0.5), bg_b: mixHex(kit.secondary, '#000000', 0.78), text: '#FFFFFF', accent: kit.accent, on_accent: '#FFFFFF', glow: kit.primary, glow2: kit.primary, scrim: mixHex(kit.secondary, '#000000', 0.5) });
const run = (args: string[], timeoutMs = 120_000) => new Promise<void>((resolve, reject) => { const bin = ffmpegPath(); if (!bin) { reject(new Error('FFmpeg is not available.')); return; } const child = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] }); let err = ''; child.stderr.on('data', (c: Buffer) => { err = (err + c.toString()).slice(-400); }); const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('timed out')); }, timeoutMs); child.on('close', (code) => { clearTimeout(timer); if (code === 0) resolve(); else reject(new Error(`FFmpeg ${code}. ${err}`)); }); });

export type TimelineResult = { ok: true; seconds: number; spec: TimelineSpec; notes: string[]; framePaths: string[]; issuesLeft: string[] } | { ok: false; reason: string };
export async function renderTimelineVideo(args: { tenantId: string; idea: Idea; method: MethodId; business: { name: string; type: string; description: string; services: string[] }; kit: BrandKit; logoId: string | null; /** the logo, already cut out (transparent PNG) */ logoPng?: Buffer; storage: MediaStorage; facts: string; seconds: number; direction?: string; complete: Complete; workDir: string; outPath: string }): Promise<TimelineResult> {
  const notes: string[] = []; const { idea } = args;
  try {
    const support = await codeVideoSupport(); if (!support.ok || !support.python || !support.sandbox) return { ok: false, reason: support.reason };
    const ffmpeg = ffmpegPath(); if (!ffmpeg) return { ok: false, reason: 'FFmpeg is not available.' };
    const dir = path.join(args.workDir, 'timeline'); await mkdir(dir, { recursive: true });
    const input = { idea, method: args.method, business: args.business, seconds: args.seconds, direction: args.direction, complete: args.complete, logo: !!args.logoPng || !!args.logoId, request: args.facts };
    let spec = await writeTimeline(input); if (!spec) return { ok: false, reason: 'The timeline could not be written.' };
    let issues = timelineIssues(spec);
    for (let round = 0; round < 2 && issues.length; round += 1) { notes.push(`timeline sent back (${issues.length}): ${issues.map((i) => i.slice(0, 90)).join(' | ')}`); const again = await writeTimeline({ ...input, feedback: issues }); if (again) { const left = timelineIssues(again); if (left.length <= issues.length) { spec = again; issues = left; } } }
    // the words are checked against what the business really said; a line that claims something unsupported is dropped
    const all = spec.elements.flatMap((e) => (e.type === 'phone' || e.type === 'card' ? [] : words(e))); const asConcept = { scenes: all.map((w) => ({ headline: w, subtext: '', items: [] })) } as unknown as Concept;
    const contactLike = (w: string) => /\d{3}[^\d]{0,3}\d{3}[^\d]{0,3}\d{4}|\b[\w.-]+\.(com|net|ca|org|io)\b|@/i.test(w);
    const digits = (s: string) => s.replace(/\D/g, ''); const factsDigits = digits(args.facts); const factsLow = args.facts.toLowerCase().replace(/https?:\/\/(www\.)?/g, '');
    const realContact = (w: string) => contactLike(w) && ((digits(w).length >= 10 && factsDigits.includes(digits(w))) || factsLow.includes(w.toLowerCase().replace(/https?:\/\/(www\.)?/g, '')));
    const flagged = new Set<string>([...unsupportedClaims(asConcept, args.facts).map((c) => c.line), ...(await reviewClaims(asConcept, args.facts, args.complete).catch(() => [])).map((c) => c.line)].filter((line) => !realContact(line)));
    if (flagged.size) { const drop = (e: Record<string, unknown>): boolean => { for (const k of ['text', 'title', 'tag', 'label']) if (typeof e[k] === 'string' && flagged.has(e[k] as string)) { if (k === 'text' || k === 'title') return true; e[k] = ''; } return false; }; spec.elements = spec.elements.filter((e) => !drop(e)); notes.push(`removed unsupported words: ${[...flagged].map((w) => `"${w}"`).join(', ')}`); }
    // the video always opens on words: if the opening line was removed (an unsupported claim), the first approved line moves up into the headline slot
    const texts = spec.elements.filter((e) => e.type === 'text' && e.text).sort((a, b) => Number(a.at) - Number(b.at));
    if (texts.length && !texts.some((e) => Number(e.at) <= 0.7)) { const first = texts[0]; first.at = 0.2; first.y = 0.17; first.size = Math.max(Number(first.size ?? 72), 92); first.stagger = 'word'; first.in = 'rise'; first.weight = 800; first.color = 'text'; notes.push(`the opening line was removed, so "${String(first.text)}" now opens the video`); }
    const strings = [...spec.elements.flatMap((e) => [...words(e), ...(e.type === 'counter' ? [String(Number(e.value ?? 0))] : [])]), args.business.name, idea.cta.split(/[.;,]/)[0], 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].filter(Boolean);
    const fontDir = path.join(path.dirname(nodeModule.createRequire(path.join(process.cwd(), 'package.json')).resolve('@fontsource/inter/package.json')), 'files');
    const { assets } = await exportAssets({ tenantId: args.tenantId, plan: { summary: { photosUsed: [] } } as never, logoId: args.logoId, kit: args.kit, storage: args.storage, dir });
    if (args.logoPng) { const file = path.join(dir, 'logo-cut.png'); await writeFile(file, args.logoPng); (assets as Record<string, string>).logo = file; }
    const silent = path.join(dir, 'silent.mp4');
    const brief = { width: 1080, height: 1920, fps: 30, ffmpeg, font_dir: fontDir, out: silent, budget_seconds: 440, brand: { name: args.kit.name }, assets, palette: brandPalette(args.kit), scenes: [{ role: 'timeline', seconds: spec.seconds, headline: idea.title, subtext: '', photo: null, visual: null, items: strings }], total_seconds: spec.seconds, timeline: spec } as unknown as CodeBrief & { timeline: TimelineSpec };
    const briefPath = path.join(dir, 'brief.json'); await writeFile(briefPath, JSON.stringify(brief)); const scriptPath = path.join(dir, 'scene_script.py'); await writeFile(scriptPath, `def build(video):\n    video.timeline_ad()\n`);
    const sb = { python: support.python, sandbox: support.sandbox, jobDir: args.workDir, briefPath, scriptPath, fontDir, ffmpegPath: ffmpeg };
    const checked = await runSandboxed({ ...sb, checkOnly: true, timeoutMs: 120_000 }); if (!checked.ok) return { ok: false, reason: checked.errors[0] ?? 'The timeline failed its safety check.' };
    let drawn = await runSandboxed({ ...sb, timeoutMs: 1_800_000 }); if (!drawn.ok && /stopped without a result/i.test(drawn.errors[0] ?? '')) drawn = await runSandboxed({ ...sb, timeoutMs: 1_800_000 });
    if (!drawn.ok) return { ok: false, reason: drawn.errors[0] ?? 'The timeline could not be drawn.' };
    if (!(await stat(silent).then((f) => f.size > 10_000).catch(() => false))) return { ok: false, reason: 'The video file was not created.' };
    await run(['-hide_banner', '-loglevel', 'error', '-y', '-i', silent, '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100', '-shortest', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', args.outPath]);
    const framePaths: string[] = []; const step = spec.seconds / 8;
    for (let i = 0; i < 8; i += 1) { const f = path.join(dir, `frame-${i}.png`); await run(['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(Math.min(spec.seconds - 0.2, step * (i + 0.6))), '-i', args.outPath, '-frames:v', '1', '-vf', 'scale=360:-1', f]).then(() => framePaths.push(f)).catch(() => undefined); }
    return { ok: true, seconds: spec.seconds, spec, notes, framePaths, issuesLeft: issues };
  } catch (error) { return { ok: false, reason: error instanceof Error ? error.message.slice(0, 240) : 'The timeline video could not be made.' }; }
}

const CHECKER = 'You are the quality director for a short motion-graphics social ad (kinetic type, UI cards, a character, connected nodes) watched on a phone with the sound off. You see 8 frames in time order. Judge as an Instagram viewer and the business owner would. Report real problems only: overlapping or clipped words, text too small to read, empty or dead stretches, crowded frames, elements that look broken or cut off, generic or confusing visuals, a weak hook, no clear call to action or business name at the end. Reply with ONLY JSON: {"publishable": true or false, "score": 1 to 10, "problems": ["each problem, naming the frame"], "verdict": "one sentence"}.';
export async function checkTimelineVideo(result: Extract<TimelineResult, { ok: true }>, completeWithImages: (system: string, prompt: string, images: Buffer[]) => Promise<{ text: string }>): Promise<{ publishable: boolean; score: number; problems: string[]; verdict: string }> {
  const images = await Promise.all(result.framePaths.map((f) => readFile(f)));
  const reply = await completeWithImages(CHECKER, `The ad runs ${result.seconds} seconds. Plain checks left: ${result.issuesLeft.join(' | ') || 'none'}.`, images).catch(() => ({ text: '' }));
  try { const b = JSON.parse(/\{[\s\S]*\}/.exec(reply.text)?.[0] ?? '{}') as Record<string, unknown>; return { publishable: b.publishable === true, score: Math.max(1, Math.min(10, Math.round(Number(b.score) || 5))), problems: Array.isArray(b.problems) ? b.problems.map((p) => String(p).slice(0, 220)).slice(0, 8) : [], verdict: typeof b.verdict === 'string' ? b.verdict.slice(0, 200) : '' }; } catch { return { publishable: false, score: 5, problems: ['The quality check could not read the video.'], verdict: '' }; }
}
