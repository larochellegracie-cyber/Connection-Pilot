import { describe, expect, it, vi } from 'vitest';

vi.mock('@/server/db/client.js', () => ({ db: {} }));
vi.mock('#airo/secrets', () => ({ getSecret: () => 'fc-test' }));

const { brandColorText, cleanEmail, cleanPhone, contactPage, describeFacts, extractWebsiteFacts, logoLink, profileValuesFrom, socialFrom, toHex, websiteUrlIn } = await import('./website-knowledge.js');

const reply = (data: unknown, status = 200) => new Response(JSON.stringify({ success: status === 200, data }), { status });
const home = {
  json: { business_name: 'Somerset Pool Service', description: 'Pool cleaning and seasonal pool care in Windsor-Essex.', phone: '(519) 982-4901', email: 'hello@somersetpoolservice.com', address: '12 Main St, Windsor, ON', hours: 'Mon-Fri 8am-5pm', services: ['Pool opening', 'Pool closing', 'Weekly maintenance', 'How far in advance should I book?'], products: [] },
  branding: { logo: '/assets/logo.svg', colors: { primary: '#0B3C7D', secondary: 'rgb(30, 111, 217)', accent: '#ffffff', background: '#fff' } },
  links: ['https://www.facebook.com/somersetpools', 'https://instagram.com/somerset', 'https://somersetpoolservice.com/contact', 'https://www.facebook.com/sharer/sharer.php?u=x'],
};

describe('checking website facts', () => {
  it('accepts real phones and emails and rejects junk', () => {
    expect(cleanPhone('(519) 982-4901')).toBe('(519) 982-4901');
    expect(cleanPhone('call us today')).toBeNull();
    expect(cleanPhone('12')).toBeNull();
    expect(cleanEmail('mailto:Hello@Example.com')).toBe('hello@example.com');
    expect(cleanEmail('not an email')).toBeNull();
  });

  it('turns brand colours into #RRGGBB and drops white, black and duplicates', () => {
    expect(toHex('rgb(30, 111, 217)')).toBe('#1E6FD9');
    expect(toHex('#abc')).toBe('#AABBCC');
    expect(brandColorText({ primary: '#0B3C7D', secondary: '#ffffff', accent: 'rgb(30,111,217)' })).toBe('Primary #0B3C7D, Secondary #1E6FD9');
    expect(brandColorText({ primary: '#000', secondary: '#fff' })).toBeNull();
  });

  it('makes the logo an absolute https link and refuses data images', () => {
    expect(logoLink({ logo: '/logo.svg' }, 'https://example.com/')).toBe('https://example.com/logo.svg');
    expect(logoLink({ logo: 'data:image/png;base64,AAAA', images: { logo: 'http://cdn.example.com/l.png' } }, 'https://example.com/')).toBe('https://cdn.example.com/l.png');
    expect(logoLink({}, 'https://example.com/')).toBeNull();
  });

  it('keeps real social profiles, not share buttons', () => {
    const social = socialFrom(home.links);
    expect(social.facebook).toBe('https://www.facebook.com/somersetpools');
    expect(social.instagram).toContain('instagram.com/somerset');
    expect(social.twitter).toBeNull();
  });

  it('recognises a pasted website address, and nothing else', () => {
    expect(websiteUrlIn('somersetpoolservice.com')).toBe('somersetpoolservice.com');
    expect(websiteUrlIn('https://www.somersetpoolservice.com/about.')).toBe('https://www.somersetpoolservice.com/about');
    expect(websiteUrlIn('here is my website: somersetpoolservice.com')).toBe('somersetpoolservice.com');
    expect(websiteUrlIn('learn from my website https://example.com')).toBe('https://example.com');
    expect(websiteUrlIn('Make me a post for somersetpoolservice.com this weekend')).toBeNull();
    expect(websiteUrlIn('Make me a 15 second video about pool closing')).toBeNull();
    expect(websiteUrlIn('photo.png')).toBeNull();
  });
});

describe('extractWebsiteFacts', () => {
  it('reads logo, colours, hours, services, contact details and social links from one scrape', async () => {
    const calls: { path: string; body: any }[] = [];
    const fetcher = (async (path: string, init: RequestInit) => { calls.push({ path, body: JSON.parse(String(init.body)) }); return reply(home); }) as never;
    const facts = await extractWebsiteFacts('somersetpoolservice.com', fetcher);
    expect(calls[0].path).toBe('/scrape');
    expect(calls[0].body.formats).toEqual(expect.arrayContaining(['branding', 'links', expect.objectContaining({ type: 'json' })]));
    expect(calls).toHaveLength(1); // nothing missing, so no follow-up page
    expect(facts).toMatchObject({ businessName: 'Somerset Pool Service', phone: '(519) 982-4901', email: 'hello@somersetpoolservice.com', hours: 'Mon–Fri: 8:00 AM – 5:00 PM', logoUrl: 'https://somersetpoolservice.com/assets/logo.svg', brandColors: 'Primary #0B3C7D, Secondary #1E6FD9' });
    expect(facts.services).toEqual(['Pool opening', 'Pool closing', 'Weekly maintenance']); // the FAQ question is dropped
    expect(describeFacts(facts).join('\n')).toContain('Hours: Mon–Fri: 8:00 AM – 5:00 PM');
  });

  it('reads one contact page when details are missing, and stays on the same site', async () => {
    const urls: string[] = [];
    const fetcher = (async (_path: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)); urls.push(body.url);
      return reply(body.url.endsWith('/contact') ? { json: { phone: '519-555-0100', hours: 'Daily 9-5' } } : { ...home, json: { business_name: 'Somerset', services: ['Pool closing'] } });
    }) as never;
    const facts = await extractWebsiteFacts('https://somersetpoolservice.com', fetcher);
    expect(urls).toEqual(['https://somersetpoolservice.com/', 'https://somersetpoolservice.com/contact']);
    expect(facts.phone).toBe('519-555-0100'); expect(facts.hours).toBe('Daily 9-5');
    expect(contactPage(['https://evil.example/contact'], 'https://somersetpoolservice.com/')).toBeNull();
  });

  it('says clearly when the account is out of credits or the key is refused', async () => {
    await expect(extractWebsiteFacts('example.com', (async () => reply(null, 402)) as never)).rejects.toMatchObject({ publicMessage: expect.stringContaining('out of credits') });
    await expect(extractWebsiteFacts('example.com', (async () => reply(null, 401)) as never)).rejects.toMatchObject({ publicMessage: expect.stringContaining('FIRECRAWL_API_KEY') });
    await expect(extractWebsiteFacts('localhost', (async () => reply(home)) as never)).rejects.toMatchObject({ stage: 'url_validation' });
  });

  it('warns about what was not found instead of guessing', async () => {
    const facts = await extractWebsiteFacts('example.com', (async () => reply({ json: { business_name: 'Example' } })) as never);
    expect(facts.warnings.join(' ')).toMatch(/No logo/); expect(facts.warnings.join(' ')).toMatch(/No opening hours/);
    expect(facts.logoUrl).toBeNull(); expect(facts.hours).toBeNull();
  });
});

describe('merging facts into the profile', () => {
  it('lets stated facts win, keeps what the website did not say, and always asks for review', async () => {
    const facts = await extractWebsiteFacts('somersetpoolservice.com', (async () => reply(home)) as never);
    const values = profileValuesFrom(facts, { contactPhone: '000', location: 'Old address', services: JSON.stringify(['Pool opening', 'Liner repair']), logoUrl: 'https://old/logo.png', socialLinks: JSON.stringify({ tiktok: 'https://tiktok.com/@x' }) });
    expect(values.approvalStatus).toBe('review_required');
    expect(values.contactPhone).toBe('(519) 982-4901'); expect(values.location).toBe('12 Main St, Windsor, ON');
    expect(JSON.parse(values.services)).toEqual(['Pool opening', 'Pool closing', 'Weekly maintenance', 'Liner repair']);
    expect(values.logoUrl).toBe('https://somersetpoolservice.com/assets/logo.svg');
    expect(JSON.parse(values.socialLinks)).toMatchObject({ tiktok: 'https://tiktok.com/@x', facebook: 'https://www.facebook.com/somersetpools' });
    const sparse = profileValuesFrom({ ...facts, phone: null, logoUrl: null }, { contactPhone: '000', logoUrl: 'https://old/logo.png' });
    expect(sparse.contactPhone).toBe('000'); expect(sparse.logoUrl).toBe('https://old/logo.png');
  });
});
