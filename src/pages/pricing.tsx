import { Helmet } from '@dr.pogodin/react-helmet';
import { ContentListContext } from '@airo/content';
import { Check, CheckCircle2, Minus, Sparkles } from 'lucide-react';
import { Link } from 'react-router';
import { useState } from 'react';
import { useSession } from '@/lib/auth/auth-client';
import { public_messaging } from 'virtual:content';

const priceIds = {
  Starter: 'price_1ULvwnAhedvpkEdkGp73i1xl',
  Growth: 'price_1ULvwnAhedvpkEdklZ6uIqTT',
  Pro: 'price_1ULvwnAhedvpkEdkLpgY5sfY',
} as const;
const siteUrl = 'https://connectionpilot.net';
const pageTitle = 'Plans and Pricing | Connection Pilot';
const pageDescription = 'Compare Connection Pilot plans for small-business management, intelligence, and AI-powered automation.';
const ogImage = `${siteUrl}/airo-assets/images/pages/home/customer-service-team`;

export default function PricingPage() {
  const { isAuthenticated } = useSession();
  const [checkingOut, setCheckingOut] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState('');
  const jsonLd = { '@context': 'https://schema.org', '@type': 'WebPage', '@id': `${siteUrl}/pricing#webpage`, name: pageTitle, url: `${siteUrl}/pricing`, isPartOf: { '@id': `${siteUrl}/#website` }, about: { '@id': `${siteUrl}/#organization` } };

  async function startCheckout(planName: keyof typeof priceIds) {
    if (!isAuthenticated) {
      window.location.assign(`/get-started?plan=${encodeURIComponent(planName)}`);
      return;
    }
    setCheckoutError('');
    setCheckingOut(planName);
    try {
      const response = await fetch('/api/stripe/create-checkout-session', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ priceId: priceIds[planName] }) });
      const data = await response.json() as { url?: string; error?: string };
      if (response.ok && data.url) window.location.assign(data.url);
      else setCheckoutError(data.error || 'Unable to start secure checkout. Please try again.');
    } catch {
      setCheckoutError('Unable to start secure checkout. Please try again.');
    } finally {
      setCheckingOut(null);
    }
  }

  return <><Helmet><title>{pageTitle}</title><meta name="description" content={pageDescription} /><link rel="canonical" href={`${siteUrl}/pricing`} /><meta property="og:title" content={pageTitle} /><meta property="og:description" content={pageDescription} /><meta property="og:type" content="website" /><meta property="og:url" content={`${siteUrl}/pricing`} /><meta property="og:image" content={ogImage} /><meta name="twitter:card" content="summary_large_image" /><meta name="twitter:title" content={pageTitle} /><meta name="twitter:description" content={pageDescription} /><meta name="twitter:image" content={ogImage} /><script type="application/ld+json">{JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script></Helmet><main>
    <section className="bg-muted py-xxxl"><div className="mx-auto max-w-content px-5 lg:px-8"><div className="mx-auto max-w-3xl text-center"><p className="text-sm font-bold text-primary">{public_messaging.pricing.hero.eyebrow}</p><h1 className="mt-sm text-5xl font-extrabold tracking-[-0.055em] text-secondary sm:text-6xl">{public_messaging.pricing.hero.title}</h1><p className="mt-lg text-lg leading-8 text-muted-foreground">{public_messaging.pricing.hero.description}</p><div className="mt-lg inline-flex items-center gap-2 rounded-full border border-primary bg-card px-4 py-2 text-sm font-extrabold text-secondary"><Sparkles size={16} className="text-primary" />7-day free trial on every plan</div></div><ContentListContext field="pricing.plans"><div className="mt-xxl grid grid-cols-1 items-stretch gap-base lg:grid-cols-3">{public_messaging.pricing.plans.map((plan, index) => { const isGrowth = index === 1; return <article key={plan.id} className={`relative flex flex-col rounded-3xl border p-xl shadow-sm ${isGrowth ? 'border-primary bg-secondary' : 'border-border bg-card'}`}>{isGrowth && <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-4 py-1 text-xs font-extrabold text-primary-foreground">Most popular</span>}<p className={`text-sm font-extrabold ${isGrowth ? 'text-primary-foreground' : 'text-primary'}`}>{plan.name}</p><div className="mt-base flex items-end gap-2"><span className={`text-5xl font-extrabold tracking-[-0.06em] ${isGrowth ? 'text-primary-foreground' : 'text-secondary'}`}>{plan.monthlyPrice}</span><span className={`pb-1 text-sm font-bold ${isGrowth ? 'text-secondary-foreground' : 'text-muted-foreground'}`}>{plan.monthlySuffix}</span></div><h2 className={`mt-lg text-2xl font-extrabold ${isGrowth ? 'text-primary-foreground' : 'text-secondary'}`}>{plan.tagline}</h2><p className={`mt-3 text-sm leading-6 ${isGrowth ? 'text-secondary-foreground' : 'text-muted-foreground'}`}>{plan.description}</p><ContentListContext field="pricing.plans.features"><div className="mt-xl grid gap-3">{plan.features.map((feature) => <div key={feature.id} className={`flex items-start gap-2 text-sm font-semibold ${isGrowth ? 'text-secondary-foreground' : 'text-muted-foreground'}`}><Check size={16} className="mt-0.5 shrink-0 text-primary" /><span>{feature.label}</span>{feature.id === 'pro-voice-receptionist' && <span className="shrink-0 rounded-full bg-accent px-2 py-0.5 text-[10px] font-extrabold text-primary">Coming Soon</span>}</div>)}</div></ContentListContext><button type="button" onClick={() => void startCheckout(plan.name as keyof typeof priceIds)} disabled={checkingOut === plan.name} className="mt-xl inline-flex w-full items-center justify-center rounded-full bg-primary px-5 py-3 text-sm font-bold text-primary-foreground hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-60">{checkingOut === plan.name ? 'Starting secure checkout...' : plan.cta}</button></article>; })}</div></ContentListContext></div></section>
    <section className="bg-background py-xxl"><div className="mx-auto max-w-content px-5 lg:px-8"><div className="mx-auto max-w-2xl text-center"><p className="text-sm font-bold text-primary">{public_messaging.pricing.comparison.eyebrow}</p><h2 className="mt-sm text-4xl font-extrabold tracking-[-0.045em] text-secondary sm:text-5xl">{public_messaging.pricing.comparison.title}</h2></div><div className="mt-xl overflow-x-auto rounded-3xl border border-border bg-card"><table className="min-w-[680px] w-full border-collapse text-left"><thead className="bg-muted"><tr><th scope="col" className="p-4 text-sm font-extrabold text-secondary">Included feature</th><th scope="col" className="p-4 text-center text-sm font-extrabold text-secondary">Starter</th><th scope="col" className="p-4 text-center text-sm font-extrabold text-secondary">Growth</th><th scope="col" className="p-4 text-center text-sm font-extrabold text-secondary">Pro</th></tr></thead><ContentListContext field="pricing.comparison.features"><tbody>{public_messaging.pricing.comparison.features.map((feature) => <tr key={feature.id} className="border-t border-border"><th scope="row" className="p-4 text-sm font-bold text-secondary">{feature.name}</th>{[feature.starter, feature.growth, feature.pro].map((included, index) => <td key={`${feature.id}-${index}`} className="p-4 text-center">{included ? <CheckCircle2 className="mx-auto text-primary" size={19} aria-label="Included" /> : <Minus className="mx-auto text-muted-foreground" size={19} aria-label="Not included" />}</td>)}</tr>)}</tbody></ContentListContext></table></div></div></section>
    <section className="bg-muted py-xxl"><div className="mx-auto max-w-content px-5 lg:px-8"><div className="mx-auto max-w-2xl text-center"><p className="text-sm font-bold text-primary">{public_messaging.pricing.faq.eyebrow}</p><h2 className="mt-sm text-4xl font-extrabold tracking-[-0.045em] text-secondary sm:text-5xl">{public_messaging.pricing.faq.title}</h2></div><ContentListContext field="pricing.faq.items"><div className="mx-auto mt-xl grid max-w-3xl gap-3">{public_messaging.pricing.faq.items.map((item) => <details key={item.id} className="rounded-2xl border border-border bg-card p-base"><summary className="cursor-pointer text-lg font-extrabold text-secondary">{item.question}</summary><p className="mt-3 text-sm leading-7 text-muted-foreground">{item.answer}</p></details>)}</div></ContentListContext></div></section>
    <section className="bg-secondary py-xxl"><div className="mx-auto max-w-content px-5 text-center lg:px-8"><h2 className="text-4xl font-extrabold tracking-[-0.045em] text-primary-foreground sm:text-5xl">{public_messaging.pricing.cta.title}</h2><p className="mx-auto mt-base max-w-2xl text-lg leading-8 text-secondary-foreground">{public_messaging.pricing.cta.description}</p><Link to="/get-started" className="mt-xl inline-flex items-center justify-center rounded-full bg-primary px-6 py-3.5 text-sm font-bold text-primary-foreground hover:bg-background hover:text-secondary">{public_messaging.pricing.cta.primaryCta}</Link></div></section>
    {checkoutError && <div role="alert" className="fixed bottom-5 left-1/2 z-50 w-[calc(100%-2.5rem)] max-w-lg -translate-x-1/2 rounded-2xl border border-destructive bg-card p-4 text-sm font-bold text-destructive shadow-xl">{checkoutError}</div>}
  </main></>;
}
