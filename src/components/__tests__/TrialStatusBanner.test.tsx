import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

import TrialStatusBanner from '../TrialStatusBanner';

const stub = (subscription: unknown) => vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ subscription }), { status: 200 })));
const renderBanner = () => render(<MemoryRouter><TrialStatusBanner /></MemoryRouter>);

describe('TrialStatusBanner', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is a rounded banner with a blue status dot, the days left, and a link to the plan', async () => {
    stub({ status: 'trialing', planName: 'Growth', trialDaysRemaining: 4 });
    const { container } = renderBanner();
    expect(await screen.findByText('4 days left in your free trial.')).toBeTruthy();
    const banner = container.firstElementChild as HTMLElement;
    expect(banner.className).toContain('cp-banner');
    expect(banner.querySelector('.cp-dot-lg')?.className).toContain('tone-info');
    expect(screen.getByRole('link', { name: 'View plan details' }).getAttribute('href')).toBe('/subscription');
  });

  it('turns orange when the trial has ended', async () => {
    stub({ status: 'trial_expired', planName: 'Growth', trialDaysRemaining: 0 });
    const { container } = renderBanner();
    expect(await screen.findByText(/Your free trial has ended/)).toBeTruthy();
    expect((container.firstElementChild as HTMLElement).querySelector('.cp-dot-lg')?.className).toContain('tone-attention');
    expect(screen.getByRole('link', { name: 'Choose a plan' })).toBeTruthy();
  });

  it('shows nothing for an active paid plan', async () => {
    stub({ status: 'active', planName: 'Pro', trialDaysRemaining: 0 });
    const { container } = renderBanner();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(container.textContent).toBe('');
  });
});
