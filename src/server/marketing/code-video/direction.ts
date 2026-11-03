/**
 * The inferred creative brief. A business owner may say only "make me a video". Before any idea is invented, Pilot reads everything it knows about the business
 * (its website, profile, services, photos) and decides, as a marketing strategist would, what this video is FOR: who it speaks to, the one strongest reason to
 * choose the business, the objective, which kind of video serves that, how long, in what format, at what pace, with what music, and what the viewer should do.
 * Nothing here is a default: every field comes from the business and the owner's words. What the owner does say (a length, a style, a platform) always wins.
 */
type Complete = (system: string, prompt: string) => Promise<string>;

export type Direction = {
  business: { name: string; type: string; description: string; services: string[]; location: string; tone: string };
  audience: string; selling_point: string; objective: string; /** what kind of video serves that (any kind: explainer, product film, story, comedy, tour, tutorial ...) */ video_type: string;
  platform: 'instagram' | 'tiktok' | 'facebook' | 'general'; format: 'vertical' | 'square' | 'landscape'; seconds: number; pacing: 'slow' | 'measured' | 'brisk' | 'rapid';
  /** how it should look and feel, in the strategist's words (not a fixed style) */ visual_direction: string;
  music: { mood: string; tempo: string; instruments: string; arc: string; energy: string };
  cta: string; subject: string; why: string; brand_colour: string | null; /** the brand's own colours, taken from its site */ brand: { primary: string | null; secondary: string | null; accent: string | null };
};
export type DirectionInput = { request: string; /** what Pilot knows: the website's text, the profile, services, pictures */ context: string; /** colours found on the website */ colours?: string[]; known?: Partial<Direction['business']>; /** what the owner said outright */ owner?: { seconds?: number; platform?: string; style?: string[]; instructions?: string[] } };

const STRATEGIST = `You are the marketing strategist at a top creative agency. A business owner asked for a video, possibly with nothing more than "make me a video". Read everything known about the business and decide what the video must do. You decide; do not wait for the owner to say it.
Think: what does this business really sell, to whom, and why would that person choose it? What is the single strongest selling point (from the facts, never invented)? What is the marketing objective (be known, get calls, bookings, sign-ups, visits, trust, a seasonal push)? Which KIND of video serves that best for THIS business and audience: a product film, a mini story, a how-it-works explainer, a funny sketch, a tour, a tutorial, a transformation, a countdown, a luxury commercial, a social trend edit, something else? Software and service businesses can be shown as explainers of what the product does; physical businesses are shown by what they make and do. Let the business decide the video; do NOT fall back on one look.
Also decide: platform (where this audience is, or "general"), format (vertical 9:16 unless the owner asks for another shape: it is what social ads and Pilot's renderers are made for), length in seconds (a quick social hook can be 10 to 15; an explainer that must teach something can run 30 to 45; never more than 45), pacing, the visual direction (feel, look, light, movement in your own words), the music (mood, tempo, instruments, how it builds and where it lands, energy), the call to action (only a real way to act that the business offers) and a subject (what the video is about, up to 10 words).
Anything the owner said outright (length, platform, style, instructions) must be honoured exactly. Never invent a fact: services, prices, hours, credentials, places, contact details and claims must come from what is known.
Also report the business itself as understood: name, type, one-sentence description, services (up to 8), location (or empty), the brand's tone of voice. brand_colour: a hex colour taken from COLOURS FOUND when one clearly is the brand's, else null. brand: the brand's primary, secondary and accent colours, chosen ONLY from COLOURS FOUND (the site's own named colours first, e.g. a primary and an accent), exact hex values; null for any you cannot find; never invent a colour.
Reply with ONLY JSON: {"business": {"name", "type", "description", "services": [], "location", "tone"}, "audience": "up to 20 words", "selling_point": "up to 25 words", "objective": "up to 20 words", "video_type": "up to 12 words", "platform": "instagram"|"tiktok"|"facebook"|"general", "format": "vertical"|"square"|"landscape", "seconds": number, "pacing": "slow"|"measured"|"brisk"|"rapid", "visual_direction": "up to 40 words", "music": {"mood", "tempo", "instruments", "arc", "energy"}, "cta": "up to 14 words", "subject": "up to 10 words", "why": "up to 40 words", "brand_colour": "#RRGGBB" or null, "brand": {"primary": "#RRGGBB" or null, "secondary": "#RRGGBB" or null, "accent": "#RRGGBB" or null}}.`;

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(String(v).toLowerCase() as T) ? (String(v).toLowerCase() as T) : fallback);

export function cleanDirection(raw: unknown, input: DirectionInput): Direction | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>; const b = (r.business && typeof r.business === 'object' ? r.business : {}) as Record<string, unknown>; const m = (r.music && typeof r.music === 'object' ? r.music : {}) as Record<string, unknown>;
  const known = input.known ?? {};
  const business = { name: known.name || text(b.name, 80), type: known.type || text(b.type, 80), description: known.description || text(b.description, 300), services: (known.services?.length ? known.services : Array.isArray(b.services) ? b.services.map((s) => text(s, 80)).filter(Boolean) : []).slice(0, 8), location: known.location || text(b.location, 80), tone: known.tone || text(b.tone, 80) };
  const seconds = input.owner?.seconds && input.owner.seconds > 0 ? Math.min(60, input.owner.seconds) : Math.max(8, Math.min(45, Math.round(Number(r.seconds) || 0) || 20));
  const colour = typeof r.brand_colour === 'string' && /^#[0-9a-f]{6}$/i.test(r.brand_colour.trim()) ? r.brand_colour.trim().toUpperCase() : null;
  const bc = (r.brand && typeof r.brand === 'object' ? r.brand : {}) as Record<string, unknown>; const hex = (v: unknown) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v.trim()) ? v.trim().toUpperCase() : null);
  const direction: Direction = { business, audience: text(r.audience, 160), selling_point: text(r.selling_point, 200), objective: text(r.objective, 160), video_type: text(r.video_type, 100), platform: pick(input.owner?.platform ?? r.platform, ['instagram', 'tiktok', 'facebook', 'general'], 'general'), format: pick(r.format, ['vertical', 'square', 'landscape'], 'vertical'), seconds, pacing: pick(r.pacing, ['slow', 'measured', 'brisk', 'rapid'], 'measured'), visual_direction: text(r.visual_direction, 300), music: { mood: text(m.mood, 80), tempo: text(m.tempo, 60), instruments: text(m.instruments, 100), arc: text(m.arc, 140), energy: text(m.energy, 60) }, cta: text(r.cta, 120), subject: text(r.subject, 90), why: text(r.why, 300), brand_colour: colour, brand: { primary: hex(bc.primary), secondary: hex(bc.secondary), accent: hex(bc.accent) } };
  return direction.business.name && direction.video_type && direction.selling_point ? direction : null;
}

export async function inferDirection(input: DirectionInput, complete: Complete): Promise<Direction | null> {
  const owner = input.owner ? [input.owner.seconds ? `length ${input.owner.seconds} seconds` : '', input.owner.platform ? `platform ${input.owner.platform}` : '', input.owner.style?.length ? `style: ${input.owner.style.join(', ')}` : '', ...(input.owner.instructions ?? [])].filter(Boolean).join('; ') : '';
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const reply = await complete(STRATEGIST, `THE OWNER SAID\n"${input.request.slice(0, 500)}"${owner ? `\nExplicit requirements: ${owner}` : '\nNo explicit requirements.'}\n\nWHAT IS KNOWN ABOUT THE BUSINESS\n${input.context.slice(0, 9000)}\n\nCOLOURS FOUND: ${(input.colours ?? []).slice(0, 8).join(', ') || 'none'}`).catch(() => '');
    let body: unknown = null; try { body = JSON.parse(/\{[\s\S]*\}/.exec(reply)?.[0] ?? ''); } catch { /* try again */ }
    const direction = cleanDirection(body, input); if (direction) return direction;
  }
  return null;
}

/** The direction as plain lines for the idea and strategy stages, which treat it as what the business needs from this video. */
export const directionText = (d: Direction) => [`Audience: ${d.audience}`, `Strongest selling point: ${d.selling_point}`, `Objective: ${d.objective}`, `Kind of video chosen for this business: ${d.video_type}`, `Visual direction: ${d.visual_direction}`, `Call to action: ${d.cta}`].join('\n');
