import type { ReactNode } from 'react';
import { Helmet } from '@dr.pogodin/react-helmet';
import { ContentListContext } from '@airo/content';
import { ArrowRight, CalendarDays, CheckCircle2, CircleHelp, ClipboardList, MessageSquare, PhoneCall, ShieldCheck, Sparkles, Users } from 'lucide-react';
import { Link } from 'react-router';
import PilotAvatar from '@/components/PilotAvatar';
import { resources } from 'virtual:content';

const siteUrl = 'https://connectionpilot.net';
const ogImage = `${siteUrl}/airo-assets/images/pages/home/customer-service-team`;
const highlightIcons = [ClipboardList, CalendarDays, ShieldCheck] as const;
const pilotHighlightIcons = [Users, CalendarDays, CheckCircle2, CircleHelp] as const;

type ResourceShellProps = { children: ReactNode; title: string; description: string; path: string };

function ResourceShell({ children, title, description, path }: ResourceShellProps) {
  const jsonLd = { '@context': 'https://schema.org', '@type': 'WebPage', '@id': `${siteUrl}${path}#webpage`, name: title, url: `${siteUrl}${path}`, isPartOf: { '@id': `${siteUrl}/#website` }, about: { '@id': `${siteUrl}/#organization` } };
  return <><Helmet><title>{title}</title><meta name="description" content={description} /><link rel="canonical" href={`${siteUrl}${path}`} /><meta property="og:title" content={title} /><meta property="og:description" content={description} /><meta property="og:type" content="website" /><meta property="og:url" content={`${siteUrl}${path}`} /><meta property="og:image" content={ogImage} /><meta name="twitter:card" content="summary_large_image" /><meta name="twitter:title" content={title} /><meta name="twitter:description" content={description} /><meta name="twitter:image" content={ogImage} /><script type="application/ld+json">{JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script></Helmet><main>{children}</main></>;
}

export function PilotPublicPage() {
  const title = 'Pilot AI Business Assistant | Connection Pilot';
  const description = 'Meet Pilot, the Connection Pilot AI business assistant for business owners and authorized teams.';
  return <ResourceShell title={title} description={description} path="/pilot">
    <section className="overflow-hidden bg-gradient-to-br from-muted via-background to-muted py-xxxl">
      <div className="mx-auto grid max-w-content items-center gap-xl px-5 lg:grid-cols-[minmax(300px,0.78fr)_minmax(0,1fr)] lg:px-8">
        <div className="relative mx-auto flex min-h-[300px] w-full max-w-md items-center justify-center lg:min-h-[390px]">
          <div className="absolute inset-8 rounded-full border border-border bg-background" aria-hidden="true" />
          <div className="absolute bottom-9 left-5 h-16 w-16 rounded-2xl border border-border bg-card shadow-sm" aria-hidden="true"><span className="absolute left-4 top-4 h-2 w-8 rounded-full bg-primary" /><span className="absolute left-4 top-8 h-2 w-5 rounded-full bg-muted" /></div>
          <div className="absolute right-5 top-10 flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-card text-primary shadow-sm" aria-hidden="true"><Sparkles size={22} /></div>
          <div className="relative z-10 flex flex-col items-center">
            <div className="relative flex h-52 w-52 items-center justify-center rounded-full border border-border bg-card shadow-xl sm:h-64 sm:w-64">
              <PilotAvatar size="lg" state="idle" className="pilot-avatar-float h-36 w-36 sm:h-44 sm:w-44" />
            </div>
            <div className="relative -mt-3 ml-24 max-w-[232px] rounded-2xl border border-border bg-card px-4 py-3 text-sm font-bold leading-5 text-secondary shadow-lg sm:max-w-[260px]">
              <span>{resources.pilot.greeting}</span><span className="absolute -left-2 top-5 h-4 w-4 rotate-45 border-b border-l border-border bg-card" aria-hidden="true" />
            </div>
          </div>
        </div>
        <div>
          <p className="text-sm font-bold text-primary">{resources.pilot.eyebrow}</p>
          <h1 className="mt-sm max-w-2xl text-5xl font-extrabold tracking-[-0.055em] text-secondary sm:text-6xl">{resources.pilot.title}</h1>
          <p className="mt-lg max-w-xl text-lg leading-8 text-muted-foreground">{resources.pilot.description}</p>
          <div className="mt-lg flex items-start gap-3 border-l-2 border-primary pl-4"><ShieldCheck className="mt-0.5 shrink-0 text-primary" size={20} /><p className="text-sm font-bold leading-6 text-secondary">{resources.pilot.audienceNote}</p></div>
        </div>
      </div>
    </section>

    <section className="bg-background py-xxl">
      <div className="mx-auto max-w-content px-5 lg:px-8">
        <div className="max-w-xl"><p className="text-sm font-bold text-primary">What Pilot does</p><h2 className="mt-sm text-3xl font-extrabold tracking-[-0.04em] text-secondary sm:text-4xl">{resources.pilot.capabilitiesTitle}</h2></div>
        <ContentListContext field="pilot.highlights"><div className="mt-xl grid divide-y divide-border border-y border-border md:grid-cols-2 md:divide-x md:divide-y-0">{resources.pilot.highlights.map((item, index) => { const Icon = pilotHighlightIcons[index] ?? ClipboardList; return <article key={item.id} className="flex gap-4 px-0 py-6 md:px-6 md:py-7 md:first:pl-0 md:nth-[2n+1]:pl-0"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-muted text-primary"><Icon size={20} /></span><div><h3 className="text-lg font-extrabold text-secondary">{item.title}</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">{item.description}</p></div></article>; })}</div></ContentListContext>
      </div>
    </section>

    <section className="bg-muted py-xxl">
      <div className="mx-auto grid max-w-content items-center gap-xl px-5 lg:grid-cols-[0.72fr_minmax(0,1fr)] lg:px-8">
        <div><p className="text-sm font-bold text-primary">Action, with your approval</p><h2 className="mt-sm text-4xl font-extrabold tracking-[-0.045em] text-secondary">{resources.pilot.chatTitle}</h2><p className="mt-base max-w-md text-lg leading-8 text-muted-foreground">{resources.pilot.chatSubtitle}</p><div className="mt-lg flex items-start gap-3"><CheckCircle2 className="mt-0.5 shrink-0 text-primary" size={20} /><p className="text-sm leading-6 text-secondary">Pilot checks the details with you before it changes an appointment, customer record, or follow-up.</p></div></div>
        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-xl"><div className="flex items-center gap-3 border-b border-border bg-background px-5 py-4"><PilotAvatar size="sm" state="speaking" /><div><p className="text-sm font-extrabold text-secondary">Pilot</p><p className="text-xs text-muted-foreground">Your AI business assistant</p></div><span className="ml-auto h-2.5 w-2.5 rounded-full bg-primary" aria-label="Pilot is available" /></div><ContentListContext field="pilot.chatMessages"><div className="grid gap-4 p-5">{resources.pilot.chatMessages.map((message) => <div key={message.id} className={message.role === 'owner' ? 'ml-auto max-w-[88%]' : 'mr-auto flex max-w-[88%] gap-2'}>{message.role === 'pilot' && <PilotAvatar size="sm" state="speaking" />}<div><p className={message.role === 'owner' ? 'mb-1 text-right text-xs font-bold text-muted-foreground' : 'mb-1 text-xs font-bold text-muted-foreground'}>{message.speaker}</p><p className={message.role === 'owner' ? 'rounded-2xl rounded-tr-sm bg-primary px-4 py-3 text-sm leading-6 text-primary-foreground' : 'rounded-2xl rounded-tl-sm bg-muted px-4 py-3 text-sm leading-6 text-secondary'}>{message.content}</p></div></div>)}</div></ContentListContext><div className="border-t border-border bg-background px-5 py-3"><p className="text-xs font-semibold text-muted-foreground">Changes stay in your control.</p></div></div>
      </div>
    </section>

    <section className="bg-secondary py-xxl text-secondary-foreground">
      <div className="mx-auto flex max-w-content flex-col items-start justify-between gap-base px-5 lg:flex-row lg:items-center lg:px-8"><div><p className="text-sm font-bold text-primary-foreground">Connection Pilot</p><h2 className="mt-sm text-3xl font-extrabold tracking-[-0.04em] text-primary-foreground sm:text-4xl">{resources.pilot.ctaTitle}</h2><p className="mt-sm max-w-xl text-base leading-7 text-primary-foreground">{resources.pilot.ctaDescription}</p></div><Link to="/get-started" className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-bold text-primary-foreground transition-transform hover:-translate-y-0.5">{resources.pilot.cta}<ArrowRight size={17} /></Link></div>
    </section>
  </ResourceShell>;
}

export function ReceptionistPublicPage() {
  const title = 'AI Voice Receptionist Coming Soon | Connection Pilot';
  const description = 'Preview the upcoming Connection Pilot AI Voice Receptionist for business calls and booking support.';
  return <ResourceShell title={title} description={description} path="/ai-receptionist"><section className="bg-background py-xxxl"><div className="mx-auto grid max-w-content items-center gap-xl px-5 lg:grid-cols-[minmax(0,1fr)_260px] lg:px-8"><div><div className="flex flex-wrap items-center gap-3"><p className="text-sm font-bold text-primary">{resources.receptionist.eyebrow}</p><span className="rounded-full bg-accent px-3 py-1 text-xs font-extrabold text-primary">Coming Soon</span></div><h1 className="mt-sm max-w-3xl text-5xl font-extrabold tracking-[-0.055em] text-secondary sm:text-6xl">{resources.receptionist.title}</h1><p className="mt-lg max-w-2xl text-lg leading-8 text-muted-foreground">{resources.receptionist.description}</p></div><div className="flex justify-center"><div className="flex h-48 w-48 items-center justify-center rounded-[2.5rem] bg-secondary text-primary-foreground shadow-xl"><PhoneCall size={68} /></div></div></div></section><section className="bg-muted py-xxxl"><div className="mx-auto max-w-content px-5 lg:px-8"><ContentListContext field="receptionist.highlights"><div className="grid grid-cols-1 gap-base md:grid-cols-3">{resources.receptionist.highlights.map((item, index) => { const Icon = highlightIcons[index] ?? ClipboardList; return <article key={item.id} className="rounded-2xl border border-border bg-card p-base shadow-sm"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-primary"><Icon size={20} /></span><h2 className="mt-base text-xl font-extrabold text-secondary">{item.title}</h2><p className="mt-sm text-sm leading-6 text-muted-foreground">{item.description}</p></article>; })}</div></ContentListContext><div className="mt-xxl flex flex-col items-center justify-between gap-base rounded-3xl border border-border bg-card p-xl sm:flex-row"><div><p className="text-xl font-extrabold text-secondary">The AI Voice Receptionist is on its way.</p><p className="mt-1 text-sm text-muted-foreground">It is not accepting phone setup, routing calls, or answering callers yet.</p></div><Link to="/features" className="inline-flex shrink-0 items-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-bold text-primary-foreground hover:bg-secondary">{resources.receptionist.cta}<ArrowRight size={17} /></Link></div></div></section></ResourceShell>;
}

export function CustomerManagementPublicPage() {
  const title = 'Customer Management | Connection Pilot';
  const description = 'Organize customer history, notes, conversations, and appointments with Connection Pilot.';
  return <ResourceShell title={title} description={description} path="/customer-management"><section className="bg-background py-xxxl"><div className="mx-auto grid max-w-content items-center gap-xl px-5 lg:grid-cols-[minmax(0,1fr)_260px] lg:px-8"><div><p className="text-sm font-bold text-primary">{resources.customers.eyebrow}</p><h1 className="mt-sm max-w-3xl text-5xl font-extrabold tracking-[-0.055em] text-secondary sm:text-6xl">{resources.customers.title}</h1><p className="mt-lg max-w-2xl text-lg leading-8 text-muted-foreground">{resources.customers.description}</p></div><div className="flex justify-center"><div className="flex h-48 w-48 items-center justify-center rounded-[2.5rem] bg-secondary text-primary-foreground shadow-xl"><Users size={68} /></div></div></div></section><section className="bg-muted py-xxxl"><div className="mx-auto max-w-content px-5 lg:px-8"><ContentListContext field="customers.highlights"><div className="grid grid-cols-1 gap-base md:grid-cols-3">{resources.customers.highlights.map((item, index) => { const Icon = highlightIcons[index] ?? ClipboardList; return <article key={item.id} className="rounded-2xl border border-border bg-card p-base shadow-sm"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-primary"><Icon size={20} /></span><h2 className="mt-base text-xl font-extrabold text-secondary">{item.title}</h2><p className="mt-sm text-sm leading-6 text-muted-foreground">{item.description}</p></article>; })}</div></ContentListContext><div className="mt-xxl rounded-3xl bg-secondary p-xl text-center"><p className="text-2xl font-extrabold tracking-tight text-primary-foreground">Give every customer conversation the context it deserves.</p><Link to="/get-started" className="mt-base inline-flex items-center gap-2 rounded-full bg-background px-6 py-3 text-sm font-bold text-secondary hover:-translate-y-0.5">{resources.customers.cta}<ArrowRight size={17} /></Link></div></div></section></ResourceShell>;
}

export function FaqsPublicPage() {
  const title = 'Connection Pilot FAQs';
  const description = 'Get answers to frequently asked questions about Connection Pilot, Pilot, and AI Receptionist setup.';
  return <ResourceShell title={title} description={description} path="/faqs"><section className="bg-background py-xxxl"><div className="mx-auto max-w-3xl px-5 text-center lg:px-8"><p className="text-sm font-bold text-primary">{resources.faqs.eyebrow}</p><h1 className="mt-sm text-5xl font-extrabold tracking-[-0.055em] text-secondary sm:text-6xl">{resources.faqs.title}</h1><p className="mt-lg text-lg leading-8 text-muted-foreground">{resources.faqs.description}</p></div></section><section className="bg-muted py-xxxl"><div className="mx-auto max-w-3xl px-5 lg:px-8"><ContentListContext field="faqs.questions"><div className="grid gap-3">{resources.faqs.questions.map((item) => <article key={item.id} className="rounded-2xl border border-border bg-card p-base shadow-sm"><div className="flex gap-3"><span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent text-primary"><CircleHelp size={17} /></span><div><h2 className="text-lg font-extrabold text-secondary">{item.question}</h2><p className="mt-sm leading-7 text-muted-foreground">{item.answer}</p></div></div></article>)}</div></ContentListContext><div className="mt-xl text-center"><Link to="/how-it-works" className="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-bold text-primary-foreground hover:bg-secondary">{resources.faqs.cta}<ArrowRight size={17} /></Link></div></div></section></ResourceShell>;
}

export function HelpPublicPage() {
  const title = 'Help Center | Connection Pilot';
  const description = 'Get setup guidance and practical help for your Connection Pilot workspace.';
  return <ResourceShell title={title} description={description} path="/help"><section className="bg-background py-xxxl"><div className="mx-auto grid max-w-content items-center gap-xl px-5 lg:grid-cols-[minmax(0,1fr)_260px] lg:px-8"><div><p className="text-sm font-bold text-primary">{resources.help.eyebrow}</p><h1 className="mt-sm max-w-3xl text-5xl font-extrabold tracking-[-0.055em] text-secondary sm:text-6xl">{resources.help.title}</h1><p className="mt-lg max-w-2xl text-lg leading-8 text-muted-foreground">{resources.help.description}</p></div><div className="flex justify-center"><div className="flex h-48 w-48 items-center justify-center rounded-[2.5rem] bg-secondary text-primary-foreground shadow-xl"><MessageSquare size={68} /></div></div></div></section><section className="bg-muted py-xxxl"><div className="mx-auto max-w-content px-5 lg:px-8"><ContentListContext field="help.highlights"><div className="grid grid-cols-1 gap-base md:grid-cols-3">{resources.help.highlights.map((item, index) => { const Icon = highlightIcons[index] ?? ClipboardList; return <article key={item.id} className="rounded-2xl border border-border bg-card p-base shadow-sm"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-primary"><Icon size={20} /></span><h2 className="mt-base text-xl font-extrabold text-secondary">{item.title}</h2><p className="mt-sm text-sm leading-6 text-muted-foreground">{item.description}</p></article>; })}</div></ContentListContext><div className="mt-xxl flex flex-col items-center justify-between gap-base rounded-3xl border border-border bg-card p-xl sm:flex-row"><div><p className="text-xl font-extrabold text-secondary">Need more help?</p><p className="mt-1 text-sm text-muted-foreground">Our support team can help you choose the next step for your workspace.</p></div><a href="mailto:support@connectionpilot.net" className="inline-flex shrink-0 items-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-bold text-primary-foreground hover:bg-secondary">{resources.help.cta}<ArrowRight size={17} /></a></div></div></section></ResourceShell>;
}
