import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { HelmetProvider } from '@dr.pogodin/react-helmet';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';

const session = vi.hoisted(() => ({ isAuthenticated: true }));
vi.mock('@/lib/auth/auth-client', () => ({ ProtectedRoute: ({ children }: { children: unknown }) => children, useSession: () => ({ isAuthenticated: session.isAuthenticated }) }));

import OnboardingPage from '../onboarding';

function Where() { const location = useLocation(); return <p data-testid="where">{location.pathname}{location.search}</p>; }
const renderFlow = () => render(<HelmetProvider><MemoryRouter initialEntries={['/onboarding']}><Routes><Route path="/onboarding" element={<OnboardingPage />} /><Route path="*" element={<Where />} /></Routes></MemoryRouter></HelmetProvider>);

let posted: Array<Record<string, any>>;
let profileExists: boolean;
let saveStatus: number;
beforeEach(() => {
  posted = []; profileExists = false; saveStatus = 201; window.sessionStorage.clear(); session.isAuthenticated = true;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/business-profile') return new Response('{}', { status: profileExists ? 200 : 404 });
    if (url === '/api/onboarding') { posted.push(JSON.parse(String(init?.body))); return new Response(JSON.stringify(saveStatus < 300 ? { ok: true } : { error: 'Tell Pilot what your business is called to continue.' }), { status: saveStatus }); }
    return new Response('{}', { status: 404 });
  }));
});
afterEach(() => vi.unstubAllGlobals());

const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const pick = (name: string | RegExp) => { const [card] = [...screen.queryAllByRole('radio', { name }), ...screen.queryAllByRole('checkbox', { name })]; if (!card) throw new Error(`No answer card named ${String(name)}`); fireEvent.click(card); };
const next = () => click(/^Next|Upload my information/);

async function startAndName(name = 'Somerset Pool') {
  renderFlow();
  fireEvent.click(await screen.findByRole('button', { name: /Let’s get started/ }));
  fireEvent.change(screen.getByLabelText('Business name'), { target: { value: name } });
  next();
}

describe('guided onboarding', () => {
  it('opens with a welcome and no progress bar, then shows one question at a time with progress', async () => {
    renderFlow();
    expect(await screen.findByText('Welcome to Connection Pilot 👋')).toBeTruthy();
    expect(screen.getByText('Let’s get to know your business.')).toBeTruthy();
    expect(screen.queryByRole('progressbar')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Let’s get started/ }));
    expect(screen.getByText('What’s your business called?')).toBeTruthy();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('1');
    expect(screen.getByText('Step 1 of 8')).toBeTruthy();
  });

  it('needs a business name before moving on', async () => {
    renderFlow();
    fireEvent.click(await screen.findByRole('button', { name: /Let’s get started/ }));
    expect(screen.getByRole('button', { name: /^Next/ }).hasAttribute('disabled')).toBe(true);
    fireEvent.change(screen.getByLabelText('Business name'), { target: { value: 'Somerset Pool' } });
    expect(screen.getByRole('button', { name: /^Next/ }).hasAttribute('disabled')).toBe(false);
  });

  it('offers the business types as large single-choice cards, and asks for typing only for Other', async () => {
    await startAndName();
    expect(screen.getByText('What type of business do you run?')).toBeTruthy();
    expect(screen.getAllByRole('radio').map((card) => card.textContent?.replace(/\s+/g, ' ').trim())).toEqual(['🏊Pool & outdoor services', '🧹Cleaning', '🔧Plumbing', '🌳Landscaping', '🏠Home services', '🍰Bakery / Food', '💇Beauty & personal services', '🚗Automotive', '📦Other']);
    expect(screen.queryByLabelText(/What kind of business/)).toBeNull();
    pick(/Pool/); pick(/Cleaning/);
    expect(screen.getAllByRole('radio').filter((card) => card.getAttribute('aria-checked') === 'true')).toHaveLength(1);
    pick(/Other/);
    expect(screen.getByRole('button', { name: /^Next/ }).hasAttribute('disabled')).toBe(true);
    fireEvent.change(screen.getByLabelText(/What kind of business/), { target: { value: 'Drone photography' } });
    expect(screen.getByRole('button', { name: /^Next/ }).hasAttribute('disabled')).toBe(false);
  });

  it('allows several choices for customers, time and help, with "everything" choices replacing the rest, and skipping', async () => {
    await startAndName(); pick(/Pool/); next();
    expect(screen.getByText('How do you usually get new customers?')).toBeTruthy();
    pick(/Phone calls/); pick(/Referrals/);
    expect(screen.getAllByRole('checkbox').filter((card) => card.getAttribute('aria-checked') === 'true')).toHaveLength(2);
    pick(/A little bit of everything/);
    expect(screen.getAllByRole('checkbox').filter((card) => card.getAttribute('aria-checked') === 'true').map((card) => card.textContent)).toEqual(['✨A little bit of everything']);
    pick(/Phone calls/);
    expect(screen.getByRole('checkbox', { name: /A little bit of everything/ }).getAttribute('aria-checked')).toBe('false');
    next();
    expect(screen.getByText('What takes up the most of your time?')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Skip' })).toBeTruthy();
    click('Skip');
    expect(screen.getByText('What would you like Pilot to help with?')).toBeTruthy();
  });

  it('presents missed-call answering as coming soon, not as an active feature', async () => {
    await startAndName(); pick(/Pool/); next(); click('Skip'); click('Skip');
    const voice = screen.getByRole('checkbox', { name: /Answer missed calls/ });
    expect(voice.textContent).toMatch(/Coming soon/);
    expect(voice.textContent).toMatch(/Not active yet/);
  });

  it('explains the file and software options honestly', async () => {
    await startAndName(); pick(/Pool/); next(); click('Skip'); click('Skip'); click('Skip'); pick(/2–5 people/); next();
    expect(screen.getByText('Do you already have business information somewhere?')).toBeTruthy();
    pick(/Yes, I have files/);
    expect(screen.getByText(/customer lists, invoices, quotes, jobs, employees, services/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Upload my information/ })).toBeTruthy();
    pick(/another software/);
    expect(screen.getByText(/Excel or CSV file/).textContent).toMatch(/Direct connections to other software aren’t available/);
  });

  it('saves everything once, with the answers, and goes to the import when files were chosen', async () => {
    await startAndName('  Somerset Pool  '); pick(/Pool/); next();
    pick(/Phone calls/); next(); pick(/Scheduling/); next(); pick(/Schedule my team/); pick(/Answer missed calls/); next();
    pick(/2–5 people/); next(); pick(/Yes, I have files/); next();
    expect(await screen.findByText('Perfect. I’ve got it.')).toBeTruthy();
    expect(screen.getByText('Next, let’s get your business information organized.')).toBeTruthy();
    expect(posted).toEqual([]); // nothing is saved until the owner finishes
    click(/Let’s organize it/);
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toEqual({ mode: 'guided', businessName: 'Somerset Pool', answers: { businessType: 'pool', otherType: '', channels: ['phone'], timeConsumers: ['scheduling'], helpWanted: ['schedule', 'calls'], teamSize: '2-5', existingData: 'files' } });
    expect((await screen.findByTestId('where')).textContent).toBe('/setup-with-pilot?import=1');
    expect(window.sessionStorage.getItem('cp-onboarding-draft')).toBeNull();
  });

  it('goes straight to the workspace when starting fresh', async () => {
    await startAndName(); pick(/Bakery/); next(); click('Skip'); click('Skip'); click('Skip'); click('Skip'); pick(/starting fresh/); next();
    click(/Take me to my workspace/);
    expect((await screen.findByTestId('where')).textContent).toBe('/dashboard');
  });

  it('shows the server’s message if setup fails and keeps the answers', async () => {
    saveStatus = 400;
    await startAndName(); pick(/Pool/); next(); click('Skip'); click('Skip'); click('Skip'); click('Skip'); pick(/starting fresh/); next();
    click(/Take me to my workspace/);
    expect((await screen.findByRole('alert')).textContent).toContain('Tell Pilot what your business is called');
    expect(screen.getByText('Perfect. I’ve got it.')).toBeTruthy();
  });

  it('lets people go back and change an answer, and remembers progress if the page is refreshed', async () => {
    await startAndName(); pick(/Plumbing/);
    click('Back');
    expect((screen.getByLabelText('Business name') as HTMLInputElement).value).toBe('Somerset Pool');
    next();
    expect(screen.getByRole('radio', { name: /Plumbing/ }).getAttribute('aria-checked')).toBe('true');
    const { unmount } = { unmount: () => undefined }; unmount();
    document.body.innerHTML = '';
    renderFlow();
    expect(await screen.findByText('What type of business do you run?')).toBeTruthy();
    expect(screen.getByRole('radio', { name: /Plumbing/ }).getAttribute('aria-checked')).toBe('true');
  });

  it('does not show the questions to someone who already has a business, or who is signed out', async () => {
    profileExists = true;
    renderFlow();
    expect((await screen.findByTestId('where')).textContent).toBe('/dashboard');
  });
  it('sends signed-out visitors to log in', async () => {
    session.isAuthenticated = false;
    renderFlow();
    expect((await screen.findByTestId('where')).textContent).toBe('/login');
  });
});
