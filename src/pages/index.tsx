import { Helmet } from '@dr.pogodin/react-helmet';
import { ContentListContext } from '@airo/content';
import { Navigate } from 'react-router';
import {
  ArrowRight,
  BarChart3,
  Boxes,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  ClipboardList,
  Sparkles,
  UsersRound,
  WalletCards,
} from 'lucide-react';
import { useSession } from '@/lib/auth/auth-client';
import PilotAvatar from '@/components/PilotAvatar';
import { index } from 'virtual:content';

const siteUrl = 'https://connectionpilot.net';
const pageTitle = 'Connection Pilot | Your Business, on Autopilot.';
const pageDescription =
  'Meet Pilot — your AI business assistant that helps manage your customers, appointments, marketing, employees, and day-to-day operations.';
const heroImage = '/airo-assets/images/pages/home/hero';

const heroNodePositions = [
  'left-2 top-7',
  'right-2 top-7',
  'left-0 top-[35%]',
  'right-0 top-[35%]',
  'left-3 bottom-5',
  'right-3 bottom-5',
  'left-[15%] bottom-0',
  'right-[15%] bottom-0',
] as const;

const heroConnectionLines = [
  [42, 42], [278, 42], [30, 130], [290, 130], [52, 224], [268, 224], [102, 252], [218, 252],
] as const;

const iconMap = {
  users: UsersRound,
  chart: BarChart3,
  clipboard: ClipboardList,
  calendar: CalendarDays,
  boxes: Boxes,
  wallet: WalletCards,
  briefcase: BriefcaseBusiness,
  sparkles: Sparkles,
} as const;

const insightKindColour: Record<string, string> = {
  Opportunity: 'text-emerald-600 bg-emerald-50',
  'Follow-up': 'text-amber-600 bg-amber-50',
  'Heads up': 'text-blue-600 bg-blue-50',
};

export default function HomePage() {
  const { isAuthenticated } = useSession();

  if (isAuthenticated) return <Navigate to="/dashboard" replace />;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'WebSite', '@id': `${siteUrl}/#website`, name: 'Connection Pilot', url: `${siteUrl}/` },
      { '@type': 'Organization', '@id': `${siteUrl}/#organization`, name: 'Connection Pilot', url: `${siteUrl}/`, logo: `${siteUrl}/airo-assets/images/logo/horizontal` },
      { '@type': 'WebPage', '@id': `${siteUrl}/#webpage`, name: pageTitle, url: `${siteUrl}/`, isPartOf: { '@id': `${siteUrl}/#website` }, about: { '@id': `${siteUrl}/#organization` }, datePublished: '2026-09-29', dateModified: '2026-10-03' },
    ],
  };

  return (
    <>
      <Helmet>
        <title>{pageTitle}</title>
        <meta name="description" content={pageDescription} />
        <link rel="canonical" href={`${siteUrl}/`} />
        <meta property="og:title" content={pageTitle} />
        <meta property="og:description" content={pageDescription} />
        <meta property="og:type" content="website" />
        <meta property="og:url" content={`${siteUrl}/`} />
        <meta property="og:image" content={`${siteUrl}${heroImage}`} />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={pageTitle} />
        <meta name="twitter:description" content={pageDescription} />
        <meta name="twitter:image" content={`${siteUrl}${heroImage}`} />
        <script type="application/ld+json">{JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>
      </Helmet>

      <main>
        {/* ── 1. HERO ─────────────────────────────────────────────────── */}
        <section className="relative overflow-hidden bg-secondary py-xxxl text-secondary-foreground">
          <div className="pilot-network pointer-events-none absolute inset-0 opacity-70" aria-hidden="true" />
          <div className="pointer-events-none absolute -right-40 top-12 h-96 w-96 rounded-full blur-3xl" style={{ background: 'hsl(var(--pilot-glow) / 0.22)' }} aria-hidden="true" />

          <div className="relative mx-auto grid max-w-content items-center gap-xxl px-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(420px,0.95fr)] lg:px-8">
            <div className="max-w-2xl">
              <p className="inline-flex rounded-full border border-primary bg-secondary px-3 py-1.5 text-sm font-bold text-primary-foreground">
                {index.hero.eyebrow}
              </p>
              <h1 className="mt-lg text-5xl font-extrabold tracking-[-0.06em] text-primary-foreground sm:text-6xl lg:text-7xl">
                {index.hero.title}
              </h1>
              <p className="mt-lg max-w-xl text-lg leading-8 text-secondary-foreground">
                {index.hero.subtitle}
              </p>
              <p className="mt-base text-base font-bold text-primary-foreground">
                {index.hero.tagline}
              </p>
              <div className="mt-xl flex flex-col gap-3 sm:flex-row">
                <a href="/get-started" className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-6 py-3.5 text-sm font-extrabold text-primary-foreground transition-transform hover:-translate-y-0.5">
                  {index.hero.primaryCta}<ArrowRight size={17} />
                </a>
                <a href="#how-pilot-works" className="inline-flex items-center justify-center gap-2 rounded-xl border border-primary bg-secondary px-6 py-3.5 text-sm font-extrabold text-primary-foreground transition-colors hover:bg-card hover:text-secondary">
                  {index.hero.secondaryCta}
                </a>
              </div>
            </div>

            <figure className="relative mx-auto w-full max-w-xl overflow-hidden rounded-3xl border border-primary bg-secondary p-3 shadow-2xl sm:p-5">
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,hsl(var(--pilot-glow)_/_0.2),transparent_52%)]" aria-hidden="true" />
              <div className="relative h-[330px] w-full sm:h-[390px]" aria-label="Pilot connects every area of your business">
                <svg viewBox="0 0 320 280" className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
                  <circle cx="160" cy="140" r="88" fill="none" stroke="hsl(var(--primary))" strokeOpacity="0.36" strokeWidth="1" strokeDasharray="4 7" />
                  <circle cx="160" cy="140" r="63" fill="none" stroke="hsl(var(--pilot-glow))" strokeOpacity="0.5" strokeWidth="1" />
                  <circle cx="160" cy="140" r="48" fill="none" stroke="hsl(var(--primary))" strokeOpacity="0.26" strokeWidth="1.5" />
                  {heroConnectionLines.map(([x, y]) => (
                    <line key={`${x}-${y}`} x1="160" y1="140" x2={x} y2={y} stroke="hsl(var(--pilot-glow))" strokeOpacity="0.72" strokeWidth="1.4" />
                  ))}
                </svg>
                <div className="pointer-events-none absolute left-1/2 top-1/2 z-[5] h-36 w-36 -translate-x-1/2 -translate-y-1/2 rounded-full blur-2xl" style={{ background: 'hsl(var(--pilot-glow) / 0.32)' }} aria-hidden="true" />
                <div className="absolute left-1/2 top-1/2 z-10 flex h-32 w-32 -translate-x-1/2 -translate-y-1/2 items-center justify-center sm:h-36 sm:w-36">
                  <PilotAvatar size="lg" state="idle" className="h-24 w-24 drop-shadow-lg sm:h-28 sm:w-28" />
                </div>
                <ContentListContext field="hero.nodes">
                  {index.hero.nodes.map((node, nodeIndex) => {
                    const Icon = iconMap[node.icon as keyof typeof iconMap];
                    return (
                      <div key={node.id} className={`absolute z-20 flex items-center gap-2 rounded-2xl border border-primary bg-card px-2.5 py-2 shadow-lg sm:px-3 ${heroNodePositions[nodeIndex]}`}>
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent text-primary"><Icon size={14} /></span>
                        <span className="text-xs font-extrabold text-secondary">{node.label}</span>
                      </div>
                    );
                  })}
                </ContentListContext>
              </div>
              <figcaption className="relative mt-2 text-center text-xs font-semibold text-secondary-foreground">{index.hero.hubDetail}</figcaption>
            </figure>
          </div>
        </section>

        {/* ── 2. INTRODUCTION ─────────────────────────────────────────── */}
        <section className="bg-background py-xxl">
          <div className="mx-auto max-w-content px-5 lg:px-8">
            <div className="mx-auto max-w-3xl text-center">
              <p className="text-sm font-bold text-primary">{index.intro.eyebrow}</p>
              <h2 className="mt-sm text-4xl font-extrabold tracking-[-0.05em] text-secondary sm:text-5xl">{index.intro.title}</h2>
              <p className="mt-base text-lg leading-8 text-muted-foreground">{index.intro.description}</p>
            </div>
            <ContentListContext field="intro.pillars">
              <div className="mt-xl grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                {index.intro.pillars.map((pillar) => {
                  const Icon = iconMap[pillar.icon as keyof typeof iconMap];
                  return (
                    <div key={pillar.id} className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-card p-5 text-center shadow-sm">
                      <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent text-primary"><Icon size={20} /></span>
                      <span className="text-sm font-extrabold text-secondary">{pillar.label}</span>
                    </div>
                  );
                })}
              </div>
            </ContentListContext>
          </div>
        </section>

        {/* ── 3. APPOINTMENTS & CUSTOMERS ─────────────────────────────── */}
        <section id="how-pilot-works" className="bg-muted py-xxl">
          <div className="mx-auto grid max-w-content items-center gap-xl px-5 lg:grid-cols-[1fr_1fr] lg:px-8">
            <div>
              <p className="text-sm font-bold text-primary">{index.appointments.eyebrow}</p>
              <h2 className="mt-sm text-4xl font-extrabold tracking-[-0.05em] text-secondary sm:text-5xl">{index.appointments.title}</h2>
              <p className="mt-base text-lg font-semibold text-muted-foreground">{index.appointments.subtitle}</p>
              <ContentListContext field="appointments.capabilities">
                <ul className="mt-lg grid gap-3" role="list">
                  {index.appointments.capabilities.map((cap) => (
                    <li key={cap.id} className="flex items-center gap-3">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"><Check size={13} strokeWidth={3} /></span>
                      <span className="text-sm font-semibold text-secondary">{cap.text}</span>
                    </li>
                  ))}
                </ul>
              </ContentListContext>
              <p className="mt-xl text-base font-bold text-primary">{index.appointments.closing}</p>
            </div>

            {/* Visual mockup — customer + appointment cards */}
            <div className="relative mx-auto w-full max-w-md">
              <div className="overflow-hidden rounded-3xl border border-border bg-secondary p-5 shadow-2xl">
                <div className="flex items-center gap-2 border-b border-primary pb-4">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground"><UsersRound size={15} /></span>
                  <span className="text-sm font-extrabold text-primary-foreground">Customers & Appointments</span>
                </div>
                <div className="mt-4 grid gap-3">
                  {[
                    { name: 'Sarah M.', detail: 'Appointment confirmed — Thu 2:00 PM', status: 'Confirmed', colour: 'bg-emerald-500' },
                    { name: 'James R.', detail: 'Quote sent — awaiting response', status: 'Pending', colour: 'bg-amber-500' },
                    { name: 'Priya K.', detail: 'Returning customer — 4 visits', status: 'Returning', colour: 'bg-primary' },
                  ].map((row) => (
                    <div key={row.name} className="flex items-center justify-between rounded-xl bg-card px-4 py-3 shadow-sm">
                      <div className="flex items-center gap-3">
                        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-xs font-extrabold text-primary">{row.name[0]}</span>
                        <div>
                          <p className="text-sm font-extrabold text-secondary">{row.name}</p>
                          <p className="text-xs text-muted-foreground">{row.detail}</p>
                        </div>
                      </div>
                      <span className={`flex h-2 w-2 rounded-full ${row.colour}`} aria-label={row.status} />
                    </div>
                  ))}
                </div>
                <div className="mt-4 rounded-xl bg-primary px-4 py-3 text-center">
                  <p className="text-xs font-extrabold text-primary-foreground">Pilot handled 3 booking requests today</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── 4. MARKETING ────────────────────────────────────────────── */}
        <section className="bg-background py-xxl">
          <div className="mx-auto max-w-content px-5 lg:px-8">
            <div className="mx-auto max-w-3xl text-center">
              <p className="text-sm font-bold text-primary">{index.marketing.eyebrow}</p>
              <h2 className="mt-sm text-4xl font-extrabold tracking-[-0.05em] text-secondary sm:text-5xl">{index.marketing.title}</h2>
              <p className="mt-base text-lg leading-8 text-muted-foreground">{index.marketing.subtitle}</p>
            </div>

            {/* Flow diagram: Your website → Pilot → Your content */}
            <div className="mt-xl flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
              <div className="flex min-w-[160px] flex-col items-center gap-3 rounded-2xl border border-border bg-card p-6 text-center shadow-sm">
                <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent text-primary"><Sparkles size={22} /></span>
                <p className="text-sm font-extrabold text-secondary">Your website</p>
                <p className="text-xs text-muted-foreground">Your services, brand, and story</p>
              </div>
              <div className="flex items-center justify-center">
                <ArrowRight className="rotate-90 text-primary sm:rotate-0" size={28} aria-hidden="true" />
              </div>
              <div className="flex min-w-[160px] flex-col items-center gap-3 rounded-2xl border border-primary bg-secondary p-6 text-center shadow-lg">
                <PilotAvatar size="sm" state="idle" className="h-12 w-12" />
                <p className="text-sm font-extrabold text-primary-foreground">Pilot</p>
                <p className="text-xs text-secondary-foreground">Learns your business</p>
              </div>
              <div className="flex items-center justify-center">
                <ArrowRight className="rotate-90 text-primary sm:rotate-0" size={28} aria-hidden="true" />
              </div>
              <div className="flex min-w-[160px] flex-col items-center gap-3 rounded-2xl border border-border bg-card p-6 text-center shadow-sm">
                <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent text-primary"><BarChart3 size={22} /></span>
                <p className="text-sm font-extrabold text-secondary">Your content</p>
                <p className="text-xs text-muted-foreground">Ready to share</p>
              </div>
            </div>

            <p className="mt-xl text-center text-base leading-8 text-muted-foreground">{index.marketing.description}</p>

            <ContentListContext field="marketing.capabilities">
              <div className="mt-lg flex flex-wrap justify-center gap-3">
                {index.marketing.capabilities.map((cap) => (
                  <span key={cap.id} className="rounded-full border border-border bg-card px-4 py-2 text-sm font-semibold text-secondary shadow-sm">
                    {cap.label}
                  </span>
                ))}
              </div>
            </ContentListContext>

            <p className="mt-base text-center text-sm font-semibold text-muted-foreground">{index.marketing.upcomingNote}</p>

            <div className="mt-lg text-center">
              <a href="/features" className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-6 py-3.5 text-sm font-extrabold text-primary-foreground transition-transform hover:-translate-y-0.5">
                {index.marketing.cta}<ArrowRight size={17} />
              </a>
            </div>
          </div>
        </section>

        {/* ── 5. BUSINESS INSIGHTS ────────────────────────────────────── */}
        <section className="bg-muted py-xxl">
          <div className="mx-auto max-w-content px-5 lg:px-8">
            <div className="mx-auto max-w-3xl text-center">
              <p className="text-sm font-bold text-primary">{index.insights.eyebrow}</p>
              <h2 className="mt-sm text-4xl font-extrabold tracking-[-0.05em] text-secondary sm:text-5xl">{index.insights.title}</h2>
              <p className="mt-base text-lg leading-8 text-muted-foreground">{index.insights.subtitle}</p>
              <p className="mt-sm text-base leading-8 text-muted-foreground">{index.insights.description}</p>
            </div>

            <ContentListContext field="insights.examples">
              <div className="mt-xl grid grid-cols-1 gap-base md:grid-cols-3">
                {index.insights.examples.map((example) => (
                  <article key={example.id} className="rounded-3xl border border-border bg-card p-base shadow-sm">
                    <span className={`inline-flex rounded-full px-3 py-1 text-xs font-bold ${insightKindColour[example.kind] ?? 'text-primary bg-accent'}`}>
                      {example.kind}
                    </span>
                    <p className="mt-base text-base font-semibold leading-7 text-secondary">{example.text}</p>
                  </article>
                ))}
              </div>
            </ContentListContext>

            <p className="mt-lg text-center text-sm font-semibold text-muted-foreground">{index.insights.exampleNote}</p>
          </div>
        </section>

        {/* ── 6. EMPLOYEE SCHEDULING ──────────────────────────────────── */}
        <section className="bg-background py-xxl">
          <div className="mx-auto grid max-w-content items-center gap-xl px-5 lg:grid-cols-[1fr_1fr] lg:px-8">
            {/* Visual mockup — schedule preview */}
            <div className="order-2 mx-auto w-full max-w-md lg:order-1">
              <div className="overflow-hidden rounded-3xl border border-border bg-secondary p-5 shadow-2xl">
                <div className="flex items-center justify-between border-b border-primary pb-4">
                  <span className="text-sm font-extrabold text-primary-foreground">Week of Oct 6 – 12</span>
                  <span className="rounded-full bg-primary px-3 py-1 text-xs font-bold text-primary-foreground">Published</span>
                </div>
                <div className="mt-4 grid gap-2">
                  {[
                    { name: 'Alex T.', days: 'Mon · Tue · Wed · Fri', hours: '32 hrs' },
                    { name: 'Jordan L.', days: 'Mon · Thu · Fri', hours: '24 hrs' },
                    { name: 'Morgan S.', days: 'Tue · Wed · Sat', hours: '28 hrs' },
                  ].map((emp) => (
                    <div key={emp.name} className="flex items-center justify-between rounded-xl bg-card px-4 py-3">
                      <div>
                        <p className="text-sm font-extrabold text-secondary">{emp.name}</p>
                        <p className="text-xs text-muted-foreground">{emp.days}</p>
                      </div>
                      <span className="text-xs font-bold text-primary">{emp.hours}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-4 rounded-xl border border-primary bg-secondary px-4 py-3">
                  <p className="text-xs font-semibold text-secondary-foreground">Pilot drafted this schedule based on your business hours and team availability.</p>
                </div>
              </div>
            </div>

            <div className="order-1 lg:order-2">
              <p className="text-sm font-bold text-primary">{index.scheduling.eyebrow}</p>
              <h2 className="mt-sm text-4xl font-extrabold tracking-[-0.05em] text-secondary sm:text-5xl">{index.scheduling.title}</h2>
              <p className="mt-base text-lg font-semibold text-muted-foreground">{index.scheduling.subtitle}</p>
              <p className="mt-base text-base leading-8 text-muted-foreground">{index.scheduling.description}</p>
              <ContentListContext field="scheduling.features">
                <div className="mt-lg grid gap-4">
                  {index.scheduling.features.map((feature) => {
                    const Icon = iconMap[feature.icon as keyof typeof iconMap];
                    return (
                      <div key={feature.id} className="flex items-center gap-4 rounded-2xl border border-border bg-card p-4 shadow-sm">
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent text-primary"><Icon size={18} /></span>
                        <span className="text-sm font-extrabold text-secondary">{feature.label}</span>
                      </div>
                    );
                  })}
                </div>
              </ContentListContext>
            </div>
          </div>
        </section>

        {/* ── 7. PILOT CHAT ───────────────────────────────────────────── */}
        <section className="relative overflow-hidden bg-secondary py-xxl text-secondary-foreground">
          <div className="pointer-events-none absolute -left-40 top-12 h-96 w-96 rounded-full blur-3xl" style={{ background: 'hsl(var(--pilot-glow) / 0.18)' }} aria-hidden="true" />
          <div className="relative mx-auto grid max-w-content items-center gap-xl px-5 lg:grid-cols-[1fr_1fr] lg:px-8">
            <div>
              <p className="text-sm font-bold text-primary-foreground">{index.chat.eyebrow}</p>
              <h2 className="mt-sm text-4xl font-extrabold tracking-[-0.05em] text-primary-foreground sm:text-5xl">{index.chat.title}</h2>
              <p className="mt-base text-lg font-semibold text-secondary-foreground">{index.chat.subtitle}</p>
              <p className="mt-base text-sm text-secondary-foreground">{index.chat.disclaimer}</p>
              <div className="mt-xl">
                <a href="/get-started" className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-6 py-3.5 text-sm font-extrabold text-primary-foreground transition-transform hover:-translate-y-0.5">
                  Try Pilot<ArrowRight size={17} />
                </a>
              </div>
            </div>

            {/* Chat demo */}
            <div className="mx-auto w-full max-w-md">
              <div className="overflow-hidden rounded-3xl border border-primary bg-card shadow-2xl">
                <div className="flex items-center gap-3 border-b border-border bg-muted px-5 py-4">
                  <PilotAvatar size="sm" state="speaking" />
                  <div>
                    <p className="text-sm font-extrabold text-secondary">Pilot</p>
                    <p className="text-xs text-muted-foreground">Your AI business assistant</p>
                  </div>
                </div>
                <div className="flex flex-col gap-3 p-5">
                  <ContentListContext field="chat.messages">
                    {index.chat.messages.map((msg) => (
                      <div key={msg.id} className={`flex ${msg.role === 'owner' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-6 ${msg.role === 'owner' ? 'rounded-br-sm bg-primary text-primary-foreground font-semibold' : 'rounded-bl-sm bg-muted text-secondary font-semibold border border-border'}`}>
                          {msg.text}
                        </div>
                      </div>
                    ))}
                  </ContentListContext>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── 8. VALUE & AFFORDABILITY ────────────────────────────────── */}
        <section className="bg-background py-xxl">
          <div className="mx-auto max-w-content px-5 lg:px-8">

            {/* Header */}
            <div className="mx-auto max-w-3xl">
              <p className="text-sm font-bold text-primary">{index.value.eyebrow}</p>
              <h2 className="mt-sm text-4xl font-extrabold tracking-[-0.05em] text-secondary sm:text-5xl">
                {index.value.title}
              </h2>
              <p className="mt-base text-xl font-semibold text-secondary">{index.value.description}</p>
              <p className="mt-sm text-lg leading-8 text-muted-foreground">{index.value.body}</p>
            </div>

            {/* Four pillars */}
            <ContentListContext field="value.pillars">
              <div className="mt-xl grid grid-cols-1 gap-base sm:grid-cols-2">
                {index.value.pillars.map((pillar) => (
                  <article
                    key={pillar.id}
                    className="group relative overflow-hidden rounded-3xl border border-border bg-card p-base shadow-sm transition-shadow hover:shadow-md"
                  >
                    {/* Subtle accent line on the left */}
                    <div className="absolute inset-y-0 left-0 w-1 rounded-l-3xl bg-primary" aria-hidden="true" />
                    <div className="pl-5">
                      <h3 className="text-xl font-extrabold tracking-[-0.03em] text-secondary">
                        {pillar.headline}
                      </h3>
                      <p className="mt-sm text-base leading-7 text-muted-foreground">{pillar.detail}</p>
                    </div>
                  </article>
                ))}
              </div>
            </ContentListContext>

            {/* Closing statement — full-width dark band */}
            <div className="mt-xl overflow-hidden rounded-3xl bg-secondary px-8 py-10 shadow-xl sm:px-12">
              <div className="flex flex-col items-start gap-6 sm:flex-row sm:items-center sm:justify-between">
                <p className="max-w-2xl text-2xl font-extrabold tracking-[-0.04em] text-primary-foreground sm:text-3xl">
                  {index.value.closing}
                </p>
                <a
                  href="/get-started"
                  className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-primary px-6 py-3.5 text-sm font-extrabold text-primary-foreground transition-transform hover:-translate-y-0.5"
                >
                  Get Started <ArrowRight size={17} />
                </a>
              </div>
            </div>

          </div>
        </section>

        {/* ── 9. FINAL CTA ────────────────────────────────────────────── */}
        <section className="bg-background py-xxxl">
          <div className="mx-auto max-w-content px-5 text-center lg:px-8">
            <p className="text-sm font-bold text-primary">{index.cta.eyebrow}</p>
            <h2 className="mx-auto mt-sm max-w-3xl text-5xl font-extrabold tracking-[-0.06em] text-secondary sm:text-6xl">{index.cta.title}</h2>
            <p className="mx-auto mt-base max-w-xl text-xl font-semibold text-muted-foreground">{index.cta.subtitle}</p>
            <p className="mx-auto mt-base max-w-2xl text-lg leading-8 text-muted-foreground">{index.cta.description}</p>
            <p className="mt-lg text-2xl font-extrabold tracking-[-0.04em] text-secondary">{index.cta.closing}</p>
            <a href="/get-started" className="mt-xl inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-8 py-4 text-base font-extrabold text-primary-foreground transition-transform hover:-translate-y-0.5">
              {index.cta.primaryCta}<ArrowRight size={18} />
            </a>
          </div>
        </section>
      </main>
    </>
  );
}
