import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { cleanServiceList, splitServiceText } from '@/lib/clean-services.js';
import { cleanHours } from '@/lib/clean-hours.js';
import { db } from '@/server/db/client.js';
import { businessKnowledge, businessProfile, marketingProfile } from '@/server/db/schema.js';
import { collectCandidates, type ImageCandidate } from './website-images.js';
import { FirecrawlNotConfiguredError, firecrawlFetch, isFirecrawlConfigured, MarketingRetrievalError, normaliseUrl } from './firecrawl-retrieval.js';

/**
 * Website knowledge extraction. The owner gives a website address; ONE Firecrawl scrape of the page reads three things at once:
 *   branding  the site's own logo and colours (Firecrawl reads them from the page's styles, so they are real, not guessed)
 *   json      structured facts: name, description, phone, email, address, hours, services, products
 *   links     the page's links, used to find social profiles and (if contact details are missing) one contact or about page
 * Plain code then checks every value (a phone must look like a phone, an email like an email, a logo must be an https link, colours
 * become #RRGGBB, the services list goes through the same cleaner as everything else) and merges the facts into the business's
 * marketing profile as "review required". The owner reviews and confirms it in Business Profile; only then does Pilot's chat,
 * the marketing briefs and the brand kit (colours and logo) use it. A profile the owner has already confirmed is never overwritten.
 *
 * Cost: one scrape is about 5 Firecrawl credits (1 for the page plus 4 for the structured read); a contact-page follow-up adds
 * about 5 more. Nothing here calls any other paid service.
 */
export type WebsiteFacts = {
  website: string;
  businessName: string | null; description: string | null; phone: string | null; email: string | null; address: string | null; hours: string | null;
  services: string[]; products: string[];
  logoUrl: string | null; /** e.g. "Primary #0B3C7D, Secondary #1E6FD9, Accent #4FC3F7" */ brandColors: string | null;
  socialLinks: Record<string, string | null>;
  pagesRead: string[]; warnings: string[];
  /** pictures found on the page(s), best first; the caller decides whether to save them (see website-images.ts) */
  imageCandidates: ImageCandidate[];
};

export const FACTS_SCHEMA = {
  type: 'object',
  properties: {
    business_name: { type: 'string' }, description: { type: 'string', description: 'What the business does, 1 to 3 sentences, using only the page' },
    phone: { type: 'string' }, email: { type: 'string' }, address: { type: 'string', description: 'Street address, city and region as written on the page' },
    hours: { type: 'string', description: 'Opening hours exactly as the page states them' },
    services: { type: 'array', items: { type: 'string' }, description: 'Names of individual services offered' },
    products: { type: 'array', items: { type: 'string' }, description: 'Names of individual products sold' },
  },
} as const;
const FACTS_PROMPT = 'Extract only facts that are stated on this page. Leave a field empty if the page does not state it. Do not guess or invent. Services and products are short names, not sentences or questions.';

// ---- checking each value ---------------------------------------------------------------------------------------------------

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');

export function cleanPhone(value: unknown): string | null {
  const raw = text(value, 60); const digits = raw.replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 15 && /^[+\d()\s.\-xext]+$/i.test(raw) ? raw : null;
}
export function cleanEmail(value: unknown): string | null {
  const raw = text(value, 255).replace(/^mailto:/i, '');
  return /^[^\s@<>]+@[^\s@<>]+\.[A-Za-z]{2,}$/.test(raw) ? raw.toLowerCase() : null;
}

const hex = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');
/** "#abc", "#aabbcc" or "rgb(1, 2, 3)" as "#AABBCC"; anything else is null. */
export function toHex(value: unknown): string | null {
  const raw = text(value, 40).toLowerCase();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(raw); if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toUpperCase();
  const long = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/.exec(raw); if (long) return `#${long[1]}`.toUpperCase();
  const rgb = /^rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})/.exec(raw); if (rgb) return `#${hex(+rgb[1])}${hex(+rgb[2])}${hex(+rgb[3])}`.toUpperCase();
  return null;
}
const brightness = (colour: string) => { const n = parseInt(colour.slice(1), 16); return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; };

/** The brand's own colours, in order: primary, secondary, accent. White, near-white, black and duplicates are page furniture, not brand colours. */
export function brandColorText(colors: unknown): string | null {
  const c = (colors && typeof colors === 'object' ? colors : {}) as Record<string, unknown>;
  const picked: string[] = [];
  for (const key of ['primary', 'secondary', 'accent']) {
    const colour = toHex(c[key]);
    if (colour && brightness(colour) < 0.94 && brightness(colour) > 0.03 && !picked.includes(colour)) picked.push(colour);
  }
  const names = ['Primary', 'Secondary', 'Accent'];
  return picked.length ? picked.map((colour, i) => `${names[i]} ${colour}`).join(', ') : null;
}

/** The logo as an absolute https link, or null (data: images and plain http cannot be loaded into videos). */
export function logoLink(branding: unknown, base: string): string | null {
  const b = (branding && typeof branding === 'object' ? branding : {}) as { logo?: unknown; images?: { logo?: unknown } };
  for (const candidate of [b.logo, b.images?.logo]) {
    if (typeof candidate !== 'string' || !candidate.trim() || /^data:/i.test(candidate.trim())) continue;
    try { const url = new URL(candidate.trim(), base); if (url.protocol === 'https:') return url.toString().slice(0, 2048); if (url.protocol === 'http:') { url.protocol = 'https:'; return url.toString().slice(0, 2048); } } catch { /* try the next one */ }
  }
  return null;
}

const SOCIAL: [string, RegExp][] = [['facebook', /(?:^|\.)facebook\.com$/], ['instagram', /(?:^|\.)instagram\.com$/], ['twitter', /(?:^|\.)(?:twitter|x)\.com$/], ['linkedin', /(?:^|\.)linkedin\.com$/], ['tiktok', /(?:^|\.)tiktok\.com$/], ['youtube', /(?:^|\.)youtube\.com$/]];
export function socialFrom(links: unknown): Record<string, string | null> {
  const result: Record<string, string | null> = { facebook: null, instagram: null, twitter: null, linkedin: null, tiktok: null, youtube: null };
  for (const link of Array.isArray(links) ? links : []) {
    if (typeof link !== 'string') continue;
    try { const url = new URL(link); const host = url.hostname.toLowerCase(); const hit = SOCIAL.find(([, pattern]) => pattern.test(host)); if (hit && !result[hit[0]] && url.pathname.length > 1 && !/\/(?:share|sharer|intent|login)/i.test(url.pathname)) result[hit[0]] = url.toString().slice(0, 500); } catch { /* not a link */ }
  }
  return result;
}

const stringList = (value: unknown, max: number) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : typeof value === 'string' ? splitServiceText(value) : []).slice(0, max);

/** A contact-style page on the same site, for the one follow-up scrape when details are missing. */
export function contactPage(links: unknown, base: string): string | null {
  let host = ''; try { host = new URL(base).hostname; } catch { return null; }
  for (const link of Array.isArray(links) ? links : []) {
    if (typeof link !== 'string') continue;
    try { const url = new URL(link); if (url.hostname === host && /contact|hours|location|about/i.test(url.pathname) && !/\.(?:jpe?g|png|pdf|svg)$/i.test(url.pathname) && url.toString() !== base) return url.toString(); } catch { /* skip */ }
  }
  return null;
}

type Scrape = { json?: Record<string, unknown>; branding?: unknown; links?: unknown; markdown?: unknown; images?: unknown; metadata?: { sourceURL?: string; ogImage?: unknown } };

/** Builds checked facts from what Firecrawl returned for one or two pages. */
export function factsFromScrapes(website: string, scrapes: Scrape[]): WebsiteFacts {
  const warnings: string[] = []; const first = (pick: (json: Record<string, unknown>) => string | null) => { for (const scrape of scrapes) { const value = scrape.json ? pick(scrape.json) : null; if (value) return value; } return null; };
  const services = cleanServiceList(scrapes.flatMap((scrape) => stringList(scrape.json?.services, 40)), 20);
  const products = cleanServiceList(scrapes.flatMap((scrape) => stringList(scrape.json?.products, 40)), 20);
  const branding = scrapes.find((scrape) => scrape.branding)?.branding as { colors?: unknown } | undefined;
  const logoUrl = logoLink(branding, website); const brandColors = brandColorText(branding?.colors);
  const facts: WebsiteFacts = {
    website,
    businessName: first((j) => text(j.business_name, 255) || null), description: first((j) => text(j.description, 1200) || null),
    phone: first((j) => cleanPhone(j.phone)), email: first((j) => cleanEmail(j.email)), address: first((j) => text(j.address, 512) || null), hours: first((j) => cleanHours(text(j.hours, 1000)) || null),
    services, products, logoUrl, brandColors, socialLinks: socialFrom(scrapes.flatMap((scrape) => (Array.isArray(scrape.links) ? scrape.links : []))),
    pagesRead: scrapes.map((scrape) => scrape.metadata?.sourceURL ?? website), warnings,
    imageCandidates: collectCandidates(scrapes, website),
  };
  if (!logoUrl) warnings.push('No logo was found on the website. You can upload one in Marketing > Library.');
  if (!brandColors) warnings.push('No brand colours were found on the website, so Pilot will use its default palette until you add yours.');
  if (!facts.phone && !facts.email && !facts.address) warnings.push('No contact details were found on the website.');
  if (!facts.hours) warnings.push('No opening hours were found on the website.');
  if (!services.length && !products.length) warnings.push('No individual services or products were found on the website.');
  return facts;
}

// ---- Firecrawl --------------------------------------------------------------------------------------------------------------

type Fetcher = typeof firecrawlFetch;
async function scrape(fetcher: Fetcher, url: string, formats: unknown[]): Promise<Scrape> {
  let response = await fetcher('/scrape', { method: 'POST', body: JSON.stringify({ url, formats, onlyMainContent: false, timeout: 40000 }) }, 55_000);
  // if this Firecrawl plan or version does not know the "images" format, read the page without it (the markdown still lists its pictures)
  if (response.status === 400 && formats.includes('images')) response = await fetcher('/scrape', { method: 'POST', body: JSON.stringify({ url, formats: formats.filter((format) => format !== 'images'), onlyMainContent: false, timeout: 40000 }) }, 55_000);
  if (response.status === 401 || response.status === 403) throw new MarketingRetrievalError('firecrawl_retrieval', 'The website-learning key was not accepted. Check FIRECRAWL_API_KEY in this app’s settings.', 502, `Firecrawl ${response.status}`);
  if (response.status === 402) throw new MarketingRetrievalError('firecrawl_retrieval', 'The website-learning account is out of credits. Add credits to Firecrawl, or upload your business information instead.', 502, 'Firecrawl 402');
  if (response.status === 429) throw new MarketingRetrievalError('firecrawl_retrieval', 'Website learning is busy right now. Please try again in a minute.', 502, 'Firecrawl 429');
  const payload = await response.json().catch(() => null) as { success?: boolean; data?: Scrape; error?: string } | null;
  if (!response.ok || !payload?.success || !payload.data) throw new MarketingRetrievalError('firecrawl_retrieval', 'I could not read that website. Check the address, or upload your business information instead.', 502, `Firecrawl ${response.status}: ${payload?.error ?? 'no data'}`);
  return payload.data;
}

/** Reads a website with Firecrawl and returns checked facts. Throws MarketingRetrievalError with an owner-readable message. */
export async function extractWebsiteFacts(value: string, fetcher: Fetcher = firecrawlFetch): Promise<WebsiteFacts> {
  if (fetcher === firecrawlFetch && !isFirecrawlConfigured()) throw new FirecrawlNotConfiguredError();
  const url = normaliseUrl(value).toString();
  const home = await scrape(fetcher, url, ['branding', 'links', 'markdown', 'images', { type: 'json', schema: FACTS_SCHEMA, prompt: FACTS_PROMPT }]);
  const scrapes: Scrape[] = [{ ...home, metadata: { sourceURL: url } }];
  const missing = !cleanPhone(home.json?.phone) && !cleanEmail(home.json?.email) || !text(home.json?.hours, 10) || !text(home.json?.address, 5);
  const next = missing ? contactPage(home.links, url) : null;
  if (next) { try { const page = await scrape(fetcher, next, [{ type: 'json', schema: FACTS_SCHEMA, prompt: FACTS_PROMPT }]); scrapes.push({ ...page, metadata: { sourceURL: next } }); } catch { /* the first page is enough */ } }
  return factsFromScrapes(url, scrapes);
}

// ---- saving it ---------------------------------------------------------------------------------------------------------------

const list = (value: string | null | undefined): string[] => { try { const parsed = JSON.parse(value ?? '[]'); return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []; } catch { return []; } };
const union = (...lists: string[][]) => { const seen = new Set<string>(); return lists.flat().filter((item) => { const key = item.toLowerCase(); if (seen.has(key)) return false; seen.add(key); return true; }); };

/** The marketing-profile columns that website facts set. Facts the website states win; empty ones leave what is already there alone. */
export function profileValuesFrom(facts: WebsiteFacts, existing?: { businessName?: string | null; businessDescription?: string | null; location?: string | null; contactPhone?: string | null; contactEmail?: string | null; businessHours?: string | null; services?: string | null; products?: string | null; brandColors?: string | null; logoUrl?: string | null; socialLinks?: string | null } | null) {
  let social: Record<string, string | null> = {}; try { social = JSON.parse(existing?.socialLinks ?? '{}') ?? {}; } catch { /* none */ }
  const mergedSocial = { ...social, ...Object.fromEntries(Object.entries(facts.socialLinks).filter(([, link]) => link)) };
  return {
    websiteUrl: facts.website, analysisStatus: 'complete' as const, analyzedAt: new Date(), approvalStatus: 'review_required' as const, confirmedAt: null,
    businessName: facts.businessName ?? existing?.businessName ?? null, businessDescription: facts.description ?? existing?.businessDescription ?? null,
    location: facts.address ?? existing?.location ?? null, contactPhone: facts.phone ?? existing?.contactPhone ?? null, contactEmail: facts.email ?? existing?.contactEmail ?? null,
    businessHours: facts.hours ?? existing?.businessHours ?? null,
    services: JSON.stringify(union(facts.services, list(existing?.services))), products: JSON.stringify(union(facts.products, list(existing?.products))),
    brandColors: facts.brandColors ?? existing?.brandColors ?? null, logoUrl: facts.logoUrl ?? existing?.logoUrl ?? null,
    socialLinks: JSON.stringify({ facebook: null, instagram: null, twitter: null, linkedin: null, tiktok: null, youtube: null, ...mergedSocial }),
  };
}

export type SaveResult = { saved: true } | { saved: false; reason: 'confirmed' };

/** Saves facts to the business's marketing profile as "review required". A profile the owner already confirmed is left untouched. */
export async function saveWebsiteFacts(businessProfileId: string, facts: WebsiteFacts): Promise<SaveResult> {
  const [existing] = await db.select().from(marketingProfile).where(eq(marketingProfile.businessProfileId, businessProfileId)).limit(1);
  if (existing?.approvalStatus === 'confirmed') return { saved: false, reason: 'confirmed' };
  const values = profileValuesFrom(facts, existing);
  if (existing) await db.update(marketingProfile).set(values).where(eq(marketingProfile.businessProfileId, businessProfileId));
  else await db.insert(marketingProfile).values({ id: randomUUID(), businessProfileId, ...values });
  return { saved: true };
}

/**
 * When the owner confirms the profile, the parts Pilot's receptionist and booking answers read (business_knowledge: hours, services) and
 * the business profile (email, website) are filled in IF they are still empty. What the owner typed there themselves is never replaced.
 */
export async function syncConfirmedProfile(businessProfileId: string, profile: { businessHours?: string | null; services?: string | null; contactEmail?: string | null; websiteUrl?: string | null }): Promise<{ hours: boolean; services: boolean; email: boolean; website: boolean }> {
  const done = { hours: false, services: false, email: false, website: false };
  const [knowledge] = await db.select().from(businessKnowledge).where(eq(businessKnowledge.businessProfileId, businessProfileId)).limit(1);
  if (knowledge) {
    const set: Record<string, string> = {};
    const hours = text(profile.businessHours, 2000); if (hours && !knowledge.businessHours.trim()) { set.businessHours = hours; done.hours = true; }
    const services = list(profile.services).join(', '); if (services && !cleanServiceList([knowledge.servicesOffered]).length) { set.servicesOffered = services; done.services = true; }
    if (Object.keys(set).length) await db.update(businessKnowledge).set(set).where(eq(businessKnowledge.businessProfileId, businessProfileId));
  }
  const [business] = await db.select({ email: businessProfile.businessEmail, website: businessProfile.website }).from(businessProfile).where(eq(businessProfile.id, businessProfileId)).limit(1);
  const email = cleanEmail(profile.contactEmail); const website = text(profile.websiteUrl, 255);
  const set: Record<string, string> = {};
  if (business && !business.email && email) { set.businessEmail = email; done.email = true; }
  if (business && !business.website && website) { set.website = website; done.website = true; }
  if (Object.keys(set).length) await db.update(businessProfile).set(set).where(eq(businessProfile.id, businessProfileId));
  return done;
}

// ---- what the owner is told -----------------------------------------------------------------------------------------------

/** A plain-language summary of what was found, for Pilot's reply. */
export function describeFacts(facts: WebsiteFacts): string[] {
  const count = (items: string[]) => (items.length ? `${items.length} (${items.slice(0, 4).join(', ')}${items.length > 4 ? ', …' : ''})` : null);
  const found: [string, string | null][] = [
    ['Logo', facts.logoUrl ? 'found' : null], ['Brand colours', facts.brandColors], ['Hours', facts.hours], ['Phone', facts.phone], ['Email', facts.email], ['Address', facts.address],
    ['About', facts.description ? (facts.description.length > 140 ? `${facts.description.slice(0, 137)}…` : facts.description) : null], ['Services', count(facts.services)], ['Products', count(facts.products)],
  ];
  return found.map(([label, value]) => `• ${label}: ${value ?? 'not found'}`);
}

/** A message that is just a website address, or asks Pilot to learn from one, returns that address. */
export function websiteUrlIn(message: string): string | null {
  const trimmed = message.trim();
  const link = /(?:https?:\/\/)?(?:www\.)?[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?:\/[^\s]*)?/i.exec(trimmed);
  if (!link) return null;
  if (/\.(?:png|jpe?g|gif|webp|svg|pdf|docx?|xlsx?|csv|txt|mp4|mov|heic)$/i.test(link[0])) return null;
  const rest = trimmed.replace(link[0], '').replace(/[\s.,!?:;"'()<>-]+/g, ' ').trim().toLowerCase();
  const asking = /^(?:please |pilot |hey pilot )?(?:learn|read|scan|import|use|check|look at|pull|get|grab|extract|here is|here's|heres|this is|it is|its|my|the)?(?:\s*(?:from|about|on|at|of|info|information|details|my|our|the|business|brand|website|site|web|page|url|link|logo|colours?|colors?|hours|services|is|at|me|for))*$/.test(rest);
  return rest === '' || asking ? link[0].replace(/[.,!?;:)]+$/, '') : null;
}
