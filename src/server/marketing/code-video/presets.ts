import type { TimelineSpec } from './timeline.js';

/**
 * COMPOSITION PRESETS. The writer does not place elements: it picks a preset for each beat of the ad and fills in the content (words, rows, a story for the
 * illustration). The layout (the slots, sizes, timings, and the motion that never stops) is decided here, once, so nothing can collide, nothing is clipped and nothing
 * sits still for long. Every preset keeps the headline in the top zone, the showcase in the middle, a caption below it, and everything above the area platforms cover.
 */
export const PRESETS = ['hero_phone', 'headline_illustration', 'big_number', 'cta_end'] as const;
export type PresetName = (typeof PRESETS)[number];
export const ICON_NAMES = ['calendar', 'chat', 'bolt', 'users', 'chart', 'clock', 'mail', 'phone', 'bell', 'tick', 'star', 'arrow', 'globe', 'leaf', 'droplet', 'shield', 'wrench', 'home', 'sun', 'snowflake', 'sparkle'] as const;
/** Words an icon may be asked for, mapped to one that really exists. Anything unknown is dropped: there is no fallback shape. */
const ICON_SYNONYMS: Record<string, (typeof ICON_NAMES)[number]> = { leaves: 'leaf', foliage: 'leaf', debris: 'leaf', algae: 'leaf', plant: 'leaf', water: 'droplet', pool: 'droplet', rain: 'droplet', drip: 'droplet', chemicals: 'droplet', chemical: 'droplet', cover: 'shield', protect: 'shield', protection: 'shield', safety: 'shield', safe: 'shield', winter: 'snowflake', snow: 'snowflake', ice: 'snowflake', cold: 'snowflake', frost: 'snowflake', summer: 'sun', spring: 'sun', season: 'sun', tool: 'wrench', tools: 'wrench', repair: 'wrench', fix: 'wrench', equipment: 'wrench', pump: 'wrench', filter: 'wrench', service: 'wrench', house: 'home', yard: 'home', backyard: 'home', clean: 'sparkle', cleaning: 'sparkle', fresh: 'sparkle', shine: 'sparkle', booking: 'calendar', schedule: 'calendar', appointment: 'calendar', date: 'calendar', message: 'chat', messages: 'chat', text: 'chat', email: 'mail', call: 'phone', time: 'clock', fast: 'bolt', speed: 'bolt', report: 'chart', insights: 'chart', growth: 'chart', team: 'users', staff: 'users', customers: 'users', check: 'tick', done: 'tick' };
export const iconFor = (name: unknown): (typeof ICON_NAMES)[number] | null => { const n = String(name ?? '').toLowerCase().trim(); if ((ICON_NAMES as readonly string[]).includes(n)) return n === 'star' ? null : (n as (typeof ICON_NAMES)[number]); return ICON_SYNONYMS[n] ?? null; };

export type Beat = { preset: PresetName; seconds: number; headline?: string; caption?: string; highlight?: string[];
  /** hero_phone */ screens?: Array<{ title: string; tag?: string; rows: Array<{ label: string; status?: 'done' | 'pending' }> }>; floating?: Array<{ title: string; tag?: string }>;
  /** headline_illustration */ illustration?: { kind: 'pool' | 'icons'; story?: 'leaves' | 'clear' | 'cover_on' | 'cover_off' | 'fill'; items?: Array<{ icon: string; label: string }> };
  /** big_number */ value?: number; prefix?: string; suffix?: string; unit?: string;
  /** cta_end */ button?: string; contact?: string[] };

/** A floating card must say something real ("Booked", "3 new leads"), not a placeholder word. */
const JUNK = new Set(['cards', 'card', 'snap', 'sparkle', 'badge', 'counter', 'chip', 'smart chip', 'queue', 'spark', 'auto', 'message', 'ai assistant', 'assistant', 'widget', 'tile', 'item', 'label', 'note', 'tag', 'alert', 'alerts', 'update', 'tip']);
export const realLabel = (title: unknown) => { const t = String(title ?? '').trim().toLowerCase(); return t.length >= 6 && !JUNK.has(t) && /[a-z]{3}/.test(t); };
const LIGHT_TEXT = '#C9D6EC';
const trim = (text: unknown, max: number) => { const t = String(text ?? '').replace(/[\u2010-\u2015\u2212]/g, '-').replace(/\s+/g, ' ').trim(); if (t.length <= max) return t; const cut = t.slice(0, max + 1); const space = cut.lastIndexOf(' '); return (space > max * 0.55 ? cut.slice(0, space) : cut.slice(0, max)).replace(/[,;:&-]+$/, ''); };
const headSize = (t: string) => (t.length <= 16 ? 118 : t.length <= 28 ? 98 : t.length <= 42 ? 82 : 68);

type El = TimelineSpec['elements'][number];
/** Gentle breathing so a key element is never still: alternating scale tweens every 1.2 seconds. */
const breathe = (el: El, from: number, to: number): El => { const tweens: Array<Record<string, unknown>> = [...((el.tweens as Array<Record<string, unknown>> | undefined) ?? [])]; let k = 0; for (let t = from; t < to - 0.6; t += 1.2) { tweens.push({ prop: 'scale', to: k % 2 === 0 ? 1.045 : 1.0, at: Math.round(t * 100) / 100, dur: 1.2, ease: 'ease_in_out' }); k += 1; } return { ...el, tweens } as El; };

function frame(beat: Beat, t0: number, last: boolean): El[] {
  const t1 = t0 + beat.seconds; const els: El[] = []; const words = { until: Math.round((t1 - (last ? 0 : 0.3)) * 100) / 100, out: 'fade', out_dur: 0.25 }; // words leave a moment before the next beat's words arrive, so two lines are never on screen together
  const headline = trim(beat.headline, 52); const caption = trim(beat.caption, 64);
  if (headline) els.push(breathe({ type: 'text', id: `h${t0}`, at: t0 + 0.2, x: 0.5, y: 0.17, size: headSize(headline), weight: 800, width: 880, text: headline, stagger: 'word', step: 0.07, in: 'rise', in_dur: 0.45, ...(beat.highlight?.length ? { highlight: beat.highlight, highlight_color: 'accent' } : {}), ...words } as unknown as El, t0 + 1.4, t1 - 0.3));
  if (caption && beat.preset !== 'cta_end') els.push({ type: 'text', id: `c${t0}`, at: t0 + Math.min(1.5, beat.seconds * 0.4), x: 0.5, y: 0.775, size: 58, weight: 700, width: 900, text: caption, color: LIGHT_TEXT, in: 'rise', ...words } as unknown as El);
  return els;
}

export function compileBeat(beat: Beat, t0: number, last: boolean, logo: boolean, business: string): { elements: El[]; camera: Array<Record<string, unknown>> } {
  const t1 = t0 + beat.seconds; const els = frame(beat, t0, last); const end = { until: Math.round((t1 + (last ? 0 : 0.15)) * 100) / 100, out: 'fade', out_dur: 0.35 };
  const camera = [{ at: t0, dur: beat.seconds, zoom: 1.035, x: 0, y: 0 }, { at: t1, dur: 0.3, zoom: 1, x: 0, y: 0 }];
  if (beat.preset === 'hero_phone') {
    const screens = (beat.screens?.length ? beat.screens : [{ title: business, rows: [] }]).slice(0, 3); const per = Math.max(2.2, (beat.seconds - 0.5) / screens.length);
    const phone: Record<string, unknown> = { type: 'phone', id: `ph${t0}`, at: t0 + 0.2, x: 0.5, y: 0.5, w: 620, h: 980, in: 'slide_left', ...end, children: [] as unknown[] };
    screens.forEach((s, i) => { const at = Math.round((t0 + 0.3 + i * per) * 100) / 100; const rows = (s.rows ?? []).slice(0, 4).map((r) => ({ label: trim(r.label, 18), ...(r.status ? { status: r.status } : {}) })).filter((r) => r.label); const h = 128 + rows.length * 100 + 40; (phone.children as unknown[]).push({ type: 'card', title: trim(s.title, 16), tag: trim(s.tag, 8), at, until: i < screens.length - 1 ? Math.round((at + per - 0.1) * 100) / 100 : undefined, x: 0.5, y: Math.min(0.5, (h / 2 + 24) / 880), w: 540, h, in: 'rise', rows, row_step: 0.35, float: 0.4 }); });
    els.push(breathe(phone as unknown as El, t0 + 1.4, t1));
    (beat.floating ?? []).filter((f) => realLabel(f.title)).slice(0, 2).forEach((f, i) => els.push({ type: 'card', id: `fl${t0}${i}`, at: t0 + 1.6 + i * 1.1, x: i === 0 ? 0.2 : 0.8, y: i === 0 ? 0.62 : 0.7, w: Math.min(420, Math.max(330, trim(f.title, 12).length * 24 + (f.tag ? 130 : 90))), h: 150, dark: false, title: trim(f.title, 12), tag: trim(f.tag, 5), in: i === 0 ? 'slide_right' : 'slide_left', float: 1, ...end } as unknown as El));
  } else if (beat.preset === 'headline_illustration') {
    const ill = beat.illustration ?? { kind: 'pool', story: 'leaves' };
    if (ill.kind === 'pool') {
      const story = ill.story ?? 'leaves'; const base: Record<string, unknown> = { type: 'pool', id: `pool${t0}`, at: t0 + 0.2, x: 0.5, y: 0.53, w: 1080, h: 780, in: 'fade', fill: 1, cover: 0, leaves: 0, clear: 0, ...end };
      const tw = (prop: string, to: number, at: number, dur: number) => ({ prop, to, at: Math.round((t0 + at) * 100) / 100, dur, ease: 'ease_in_out' });
      if (story === 'leaves') { base.leaves = 12; base.tweens = [{ prop: 'scale', to: 1.03, at: t0 + 1.0, dur: 1.4, ease: 'ease_in_out' }, { prop: 'scale', to: 1, at: t0 + 2.4, dur: 1.4, ease: 'ease_in_out' }]; }
      if (story === 'clear') { base.leaves = 12; base.tweens = [tw('clear', 1, 0.5, Math.max(1.6, beat.seconds - 1.0))]; }
      if (story === 'cover_on') { base.tweens = [tw('cover', 1, 0.5, Math.max(1.6, beat.seconds - 1.6))]; }
      if (story === 'cover_off') { base.cover = 1; base.tweens = [tw('cover', 0, 0.5, Math.max(1.6, beat.seconds - 1.2))]; }
      if (story === 'fill') { base.fill = 0.12; base.tweens = [tw('fill', 1, 0.6, Math.max(1.8, beat.seconds - 1.2))]; }
      els.push(base as unknown as El);
    } else {
      const items = (ill.items ?? []).map((it) => ({ icon: iconFor(it.icon), label: trim(it.label, 14) })).filter((it): it is { icon: NonNullable<ReturnType<typeof iconFor>>; label: string } => !!it.icon && !!it.label).slice(0, 4);
      const slots = [[0.3, 0.37], [0.7, 0.37], [0.3, 0.58], [0.7, 0.58]];
      items.forEach((it, i) => els.push({ type: 'node', id: `n${t0}${i}`, at: t0 + 0.5 + i * 0.7, x: slots[i][0], y: slots[i][1], r: 86, icon: it.icon, label: it.label, size: 40, in: 'pop', float: 1, ...end } as unknown as El));
    }
  } else if (beat.preset === 'big_number') {
    const value = Number(beat.value ?? 0);
    els.push({ type: 'ring', id: `rg${t0}`, at: t0 + 0.2, x: 0.5, y: 0.43, r: 225, value: 0.78, color: 'accent', in: 'pop', ...end } as unknown as El);
    els.push({ type: 'counter', id: `ct${t0}`, at: t0 + 0.3, x: 0.5, y: 0.4, size: 230, width: 800, value, count_dur: Math.min(2.4, beat.seconds - 0.8), in: 'zoom', ...end } as unknown as El);
    if (beat.unit) els.push({ type: 'text', id: `un${t0}`, at: t0 + 1.0, x: 0.5, y: 0.605, size: 60, weight: 800, width: 800, text: trim(`${beat.prefix ?? ''}${beat.suffix ?? ''} ${beat.unit}`, 30), color: 'accent', in: 'rise', ...end } as unknown as El);
  } else if (beat.preset === 'cta_end') {
    if (logo) els.push({ type: 'logo', id: `lg${t0}`, at: t0 + 0.1, x: 0.5, y: 0.21, size: 420, in: 'pop', until: t1, float: 0.3 } as unknown as El);
    else els.push({ type: 'text', id: `nm${t0}`, at: t0 + 0.1, x: 0.5, y: 0.2, size: 92, weight: 800, width: 880, text: trim(business, 30), in: 'pop', until: t1 } as unknown as El);
    if (beat.headline) { const hl = els.findIndex((e) => String(e.id).startsWith('h')); if (hl >= 0) { els[hl] = { ...els[hl], y: 0.4, size: Math.min(Number(els[hl].size), 96), until: t1 } as El; } }
    els.push({ type: 'button', id: `bt${t0}`, at: t0 + 1.0, x: 0.5, y: 0.56, w: 760, text: trim(beat.button || 'Learn more', 28), in: 'pop', pulse: true, until: t1 } as unknown as El);
    (beat.contact ?? []).slice(0, 2).forEach((line, i) => els.push({ type: 'text', id: `ct${t0}${i}`, at: t0 + 1.6 + i * 0.5, x: 0.5, y: 0.655 + i * 0.07, size: 60, weight: 700, width: 960, text: trim(line, 38), color: LIGHT_TEXT, in: 'rise', until: t1 } as unknown as El));
  }
  return { elements: els, camera: beat.preset === 'cta_end' ? [] : camera };
}

/** The beats as one continuous timeline (each beat's elements leave as the next one's arrive). */
export function compileBeats(beats: Beat[], opts: { logo: boolean; business: string }): TimelineSpec {
  let t = 0; const elements: El[] = []; const camera: Array<Record<string, unknown>> = [];
  let lastPool: El | null = null;
  beats.forEach((beat, i) => {
    const c = compileBeat(beat, t, i === beats.length - 1, opts.logo, opts.business); let els = c.elements;
    const pool = els.find((e) => e.type === 'pool');
    // one pool stays on screen across consecutive pool beats and changes state (leaves, swept away, cover sliding on), so the story reads as one continuous action
    if (pool && lastPool && beats[i - 1]?.illustration?.kind === 'pool') {
      const story = beat.illustration?.story; const prev = lastPool as Record<string, unknown>; const mine = pool as Record<string, unknown>; const tw = (prop: string, to: number) => ({ prop, to, at: Math.round(t * 100) / 100, dur: 0.1, ease: 'linear' });
      prev.until = mine.until; prev.leaves = Math.max(Number(prev.leaves ?? 0), Number(mine.leaves ?? 0));
      prev.tweens = [...((prev.tweens as unknown[]) ?? []), ...(story === 'cover_off' ? [tw('cover', 1)] : []), ...(story === 'fill' ? [tw('fill', 0.12)] : []), ...((mine.tweens as unknown[]) ?? []).filter((w) => (w as { prop: string }).prop !== 'scale')];
      els = els.filter((e) => e !== pool);
    } else if (pool) lastPool = pool; else lastPool = null;
    elements.push(...els); camera.push(...c.camera); t += beat.seconds;
  });
  return { seconds: Math.round(t * 100) / 100, theme: 'dark', camera, elements } as unknown as TimelineSpec;
}

/** Tidies the beats the writer sent: only known presets, whole content, real seconds that add up to the length asked. */
export function cleanBeats(raw: unknown, seconds: number, opts: { poolOk?: boolean; contacts?: string[] } = {}): Beat[] | null {
  const list = Array.isArray((raw as { beats?: unknown })?.beats) ? (raw as { beats: unknown[] }).beats : []; const beats: Beat[] = [];
  for (const item of list) {
    const raw0 = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>; const r = { ...((raw0.content && typeof raw0.content === 'object' ? raw0.content : {}) as Record<string, unknown>), ...raw0, preset: raw0.preset ?? raw0.type } as Record<string, unknown>; // a beat may nest its fields under "content" or name its preset "type"
    if (!(PRESETS as readonly string[]).includes(String(r.preset))) continue;
    const beat: Beat = { preset: r.preset as PresetName, seconds: Math.max(2.4, Math.min(12, Number(r.seconds ?? r.duration) || 4)), headline: trim(r.headline, 52), caption: trim(r.caption, 64) };
    if (Array.isArray(r.highlight)) beat.highlight = r.highlight.map((w) => trim(w, 20)).filter(Boolean).slice(0, 3);
    if (beat.preset === 'hero_phone') { beat.screens = (Array.isArray(r.screens) ? r.screens : []).slice(0, 3).map((s) => { const q = (s && typeof s === 'object' ? s : {}) as Record<string, unknown>; return { title: trim(q.title, 16), tag: trim(q.tag, 8), rows: (Array.isArray(q.rows) ? q.rows : []).slice(0, 4).map((row) => { const w = (row && typeof row === 'object' ? row : {}) as Record<string, unknown>; return { label: trim(w.label, 18), ...(w.status === 'done' || w.status === 'pending' ? { status: w.status as 'done' | 'pending' } : {}) }; }).filter((row) => row.label) }; }).filter((s) => s.title); beat.floating = (Array.isArray(r.floating) ? r.floating : []).slice(0, 2).map((f) => { const q = (f && typeof f === 'object' ? f : {}) as Record<string, unknown>; return { title: trim(q.title, 12), tag: trim(q.tag, 5) }; }).filter((f) => f.title); }
    if (beat.preset === 'headline_illustration') {
      const q = (r.illustration && typeof r.illustration === 'object' ? r.illustration : {}) as Record<string, unknown>; const stories = ['leaves', 'clear', 'cover_on', 'cover_off', 'fill'];
      if (q.kind === 'pool' && opts.poolOk) beat.illustration = { kind: 'pool', story: (stories.includes(String(q.story)) ? q.story : 'leaves') as 'leaves' };
      else if (q.kind === 'icons' && !opts.poolOk) { const items = (Array.isArray(q.items) ? q.items : []).map((it) => { const w = (it && typeof it === 'object' ? it : {}) as Record<string, unknown>; return { icon: iconFor(w.icon) ? String(w.icon) : '', label: trim(w.label, 14) }; }).filter((it) => it.icon && it.label); if (items.length >= 2) beat.illustration = { kind: 'icons', items }; }
      if (!beat.illustration && opts.poolOk) { const n = beats.filter((b) => b.illustration?.kind === 'pool').length; beat.illustration = { kind: 'pool', story: (['leaves', 'clear', 'cover_on', 'cover_off', 'fill'] as const)[n % 5] }; } // the writer named no illustration for a pool business: the next step of the pool story is used
      if (!beat.illustration) continue; // an illustration that does not apply (a pool for a business with no pool) or has fewer than two real icons is never shown: the beat is dropped
    }
    if (beat.preset === 'big_number') { beat.value = Math.max(0, Math.min(1_000_000, Number(r.value) || 0)); beat.prefix = trim(r.prefix, 4); beat.suffix = trim(r.suffix, 6); beat.unit = trim(r.unit, 24); }
    if (beat.preset === 'cta_end') { beat.button = trim(r.button, 28); beat.contact = (Array.isArray(r.contact) ? r.contact : []).map((c) => trim(c, 38)).filter(Boolean).slice(0, 2); for (const def of opts.contacts ?? []) { const key = def.toLowerCase().replace(/\D/g, '') || def.toLowerCase(); if (beat.contact.length < 2 && !beat.contact.some((c) => (c.toLowerCase().replace(/\D/g, '') || c.toLowerCase()).includes(key))) beat.contact.push(def); } }
    if (beats.length && beat.headline && beat.headline.toLowerCase() === (beats[beats.length - 1].headline ?? '').toLowerCase()) beat.headline = ''; // the same headline is never shown twice in a row
    beats.push(beat);
  }
  if (beats.length < 2) return null;
  if (opts.poolOk && beats.filter((b) => b.illustration?.kind === 'pool').length < 3) return null; // a pool business is shown with the pool: at least three beats must use the illustration
  if (beats[beats.length - 1].preset !== 'cta_end') beats.push({ preset: 'cta_end', seconds: 4, headline: '', button: '', contact: [] });
  const total = beats.reduce((a, b) => a + b.seconds, 0); const k = seconds / total; beats.forEach((b) => { b.seconds = Math.max(2.4, Math.round(b.seconds * k * 10) / 10); });
  return beats;
}
