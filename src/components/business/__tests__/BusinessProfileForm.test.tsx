import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import BusinessProfileForm, { applyFacts, initialForm } from '../BusinessProfileForm';

const bp = { businessName: 'Somerset Pool Service', businessType: 'Pool cleaning', businessEmail: 'owner@example.com', address: '10605 Halstead Crescent', city: 'Windsor', region: 'Ontario', postalCode: 'N8R 2C3', website: 'https://somersetpoolservice.com' };
const rawHours = 'Contact us Hours of operation Monday to Friday 9:00 AM to 5:00 PM. How far in advance should I book? We service Windsor and surrounding areas. Call us or email.';
const bk = { serviceArea: 'Windsor-Essex', businessHours: rawHours, servicesOffered: 'you service Windsor and surrounding areas? Question How far in advance should I book?', pricingInformation: '', frequentlyAskedQuestions: 'Q: How far in advance? A: A week.', policies: '', receptionistInstructions: '', discloseAutomation: false };
const mp = { id: 'm1', approvalStatus: 'confirmed', analyzedAt: '2026-10-22', websiteUrl: 'https://somersetpoolservice.com/', businessDescription: 'Pool care in Windsor-Essex.', contactPhone: '(519) 982-4901', contactEmail: '', businessHours: '', services: JSON.stringify(['Weekly Pool Maintenance', 'Pool Openings & Closings']), products: '[]', brandColors: 'Primary #E1611A, Secondary #233D48, Accent #188BF6', logoUrl: 'https://cdn.example.com/logo.png', keySellingPoints: '[]', socialLinks: '{"facebook":"https://facebook.com/somerset"}', targetCustomers: 'Homeowners' };
const facts = { website: 'https://somersetpoolservice.com/', businessName: 'Somerset Pool Service', description: 'We keep pools clean.', phone: '(519) 555-0000', email: 'service@clickonsomerset.com', address: '10605 Halstead Crescent, Windsor', hours: 'Mon–Fri: 8:00 AM – 5:00 PM', services: ['Power Washing', 'Weekly Pool Maintenance'], products: [], logoUrl: 'https://cdn.example.com/new-logo.svg', brandColors: 'Primary #0B3C7D, Secondary #1E6FD9' };

let calls: Array<{ method: string; url: string; body: any }>;
beforeEach(() => {
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'; const body = init?.body ? JSON.parse(String(init.body)) : undefined; calls.push({ method, url, body });
    if (url === '/api/business-knowledge' && method === 'GET') return new Response(JSON.stringify({ profile: bp, knowledge: bk }));
    if (url === '/api/marketing/profile' && method === 'GET') return new Response(JSON.stringify({ marketingProfile: mp }));
    if (url === '/api/business-knowledge/website') return new Response(JSON.stringify({ facts, found: ['• Logo: found'], warnings: ['No opening hours were found on the website.'], photos: { saved: [{ id: 'p1', label: 'From website – logo', kind: 'logo', url: '/api/marketing/assets/p1' }], skipped: 2, message: 'I saved 3 photos from your website to “Photos Pilot can use”, labelled “From website”. Delete any you don’t want.' } }));
    if (method === 'PUT') return new Response(JSON.stringify({ ok: true, importedPages: ['https://somersetpoolservice.com/'], marketingProfile: mp }));
    return new Response('{}', { status: 404 });
  }));
});
afterEach(() => vi.unstubAllGlobals());

const open = async () => { render(<BusinessProfileForm />); await screen.findByLabelText('Business name'); };

describe('the single Business profile form', () => {
  it('has one website step and one form with every field the owner needs', async () => {
    await open();
    expect(screen.getAllByRole('button', { name: 'Read my website' })).toHaveLength(1);
    expect(screen.getAllByRole('form', { name: 'Business profile' })).toHaveLength(1);
    for (const label of ['Business name', 'Business type', 'Website', 'Phone', 'Email', 'Address', 'City', 'About', 'Products and services', 'Hours', 'Logo link']) expect(screen.getByLabelText(new RegExp(`^${label}(?! address)`))).toBeTruthy();
    for (const label of ['Primary', 'Secondary', 'Accent']) expect(screen.getByLabelText(label)).toBeTruthy();
    expect(screen.getByAltText('Your logo').getAttribute('src')).toBe('https://cdn.example.com/logo.png');
    expect(screen.getByLabelText('Phone')).toHaveProperty('value', '(519) 982-4901');
  });

  it('shows clean hours and services instead of raw page text', async () => {
    await open();
    expect(screen.getByLabelText(/^Hours/)).toHaveProperty('value', 'Mon–Fri: 9:00 AM – 5:00 PM');
    expect(screen.getByLabelText(/^Products and services/)).toHaveProperty('value', 'Weekly Pool Maintenance\nPool Openings & Closings');
    expect(initialForm(bp, { ...bk, businessHours: 'Pool closing, power washing. Do you offer weekend service? Ask us.' }, null).form.hours).toBe(''); // no hours in it, so blank
  });

  it('folds the long optional guidance away', async () => {
    await open();
    const more = screen.getByText(/More for Pilot/).closest('details') as HTMLDetailsElement;
    expect(more.open).toBe(false);
    expect(more.textContent).toContain('Frequently asked questions');
  });

  it('fills the form from the website: blanks are filled, hours, logo and colours are replaced, and it asks for confirmation', async () => {
    await open();
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Read my website' }));
    expect(await screen.findByText(/Pilot filled in:/)).toBeTruthy();
    expect(screen.getByLabelText('Phone')).toHaveProperty('value', '(519) 555-0000');
    expect(screen.getByLabelText('Email')).toHaveProperty('value', 'owner@example.com'); // not overwritten
    expect(screen.getByLabelText(/^Hours/)).toHaveProperty('value', 'Mon–Fri: 8:00 AM – 5:00 PM');
    expect(screen.getByAltText('Your logo').getAttribute('src')).toBe('https://cdn.example.com/new-logo.svg');
    expect(screen.getByLabelText(/^Products and services/)).toHaveProperty('value', 'Weekly Pool Maintenance\nPool Openings & Closings\nPower Washing');
    expect(screen.getByText(/I saved 3 photos from your website/)).toBeTruthy(); // the photos it saved are mentioned, with a link to the Photos section
    expect(screen.getByRole('link', { name: 'See them' }).getAttribute('href')).toBe('#photos-title');
    expect(screen.getByText('Needs your review')).toBeTruthy();
    expect(calls.some((call) => call.method === 'PUT')).toBe(false); // reading saves nothing
  });

  it('saves both places in one step, with hours optional, and confirms', async () => {
    await open();
    fireEvent.change(screen.getByLabelText(/^Hours/), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and save' }));
    await waitFor(() => expect(calls.filter((call) => call.method === 'PUT')).toHaveLength(2));
    const [knowledge, marketing] = calls.filter((call) => call.method === 'PUT');
    expect(knowledge.url).toBe('/api/business-knowledge'); expect(marketing.url).toBe('/api/marketing/profile');
    expect(knowledge.body).toMatchObject({ businessName: 'Somerset Pool Service', businessHours: '', servicesOffered: 'Weekly Pool Maintenance, Pool Openings & Closings', businessEmail: 'owner@example.com' });
    expect(marketing.body).toMatchObject({ contactPhone: '(519) 982-4901', brandColors: 'Primary #E1611A, Secondary #233D48, Accent #188BF6', logoUrl: 'https://cdn.example.com/logo.png', targetCustomers: 'Homeowners', services: ['Weekly Pool Maintenance', 'Pool Openings & Closings'] });
    expect(marketing.body.socialLinks).toEqual({ facebook: 'https://facebook.com/somerset' }); // what the form does not show is kept
    expect(await screen.findByText(/Saved and confirmed/)).toBeTruthy();
  });
});

describe('applyFacts', () => {
  it('reports what it filled', () => {
    const base = initialForm(bp, bk, null).form;
    const { filled } = applyFacts({ ...base, phone: '' }, facts);
    expect(filled).toEqual(expect.arrayContaining(['phone', 'hours', 'logo', 'brand colours', 'services']));
  });
});
