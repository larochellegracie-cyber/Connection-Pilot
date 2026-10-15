import { Helmet } from '@dr.pogodin/react-helmet';
import { ContentListContext } from '@airo/content';
import { motion } from 'motion/react';
import {
  ArrowDown,
  ArrowRight,
  BellRing,
  Bot,
  CalendarCheck,
  Check,
  ClipboardList,
  Clock3,
  MessageCircle,
  PhoneCall,
  Send,
  UserRoundCheck,
} from 'lucide-react';
import { platform_pages } from 'virtual:content';

const siteUrl = 'https://connectionpilot.net';
const pageTitle = 'Business Operating Platform Solutions | Connection Pilot';
const pageDescription = 'Explore Connection Pilot solutions for connected customers, operations, scheduling, finances, inventory, and business insights.';
const ogImage = `${siteUrl}/airo-assets/images/pages/home/customer-service-team`;

const reveal = {
  hidden: { opacity: 0, y: 22 },
  visible: { opacity: 1, y: 0 },
} as const;

export default function SolutionsPage() {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    '@id': `${siteUrl}/solutions#webpage`,
    name: pageTitle,
    url: `${siteUrl}/solutions`,
    isPartOf: { '@id': `${siteUrl}/#website` },
    about: { '@id': `${siteUrl}/#organization` },
  };

  return (
    <>
      <Helmet>
        <title>{pageTitle}</title>
        <meta name="description" content={pageDescription} />
        <link rel="canonical" href={`${siteUrl}/solutions`} />
        <meta property="og:title" content={pageTitle} />
        <meta property="og:description" content={pageDescription} />
        <meta property="og:type" content="website" />
        <meta property="og:url" content={`${siteUrl}/solutions`} />
        <meta property="og:image" content={ogImage} />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={pageTitle} />
        <meta name="twitter:description" content={pageDescription} />
        <meta name="twitter:image" content={ogImage} />
        <script type="application/ld+json">{JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>
      </Helmet>

      <main>
        <section className="relative overflow-hidden bg-background py-xxxl">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_78%_25%,hsl(var(--accent)),transparent_42%)]" />
          <div className="pointer-events-none absolute -right-12 top-20 hidden h-72 w-72 rounded-full border-[28px] border-primary/10 lg:block" />
          <div className="relative mx-auto max-w-content px-5 text-center lg:px-8">
            <motion.p initial="hidden" animate="visible" variants={reveal} transition={{ duration: 0.35 }} className="text-sm font-bold text-primary">{platform_pages.solutions.hero.eyebrow}</motion.p>
            <motion.h1 initial="hidden" animate="visible" variants={reveal} transition={{ duration: 0.4, delay: 0.08 }} className="mx-auto mt-sm max-w-4xl text-5xl font-extrabold tracking-[-0.055em] text-secondary sm:text-6xl lg:text-7xl">{platform_pages.solutions.hero.title}</motion.h1>
            <motion.p initial="hidden" animate="visible" variants={reveal} transition={{ duration: 0.42, delay: 0.16 }} className="mx-auto mt-lg max-w-2xl text-lg leading-8 text-muted-foreground">{platform_pages.solutions.hero.description}</motion.p>
            <motion.div initial="hidden" animate="visible" variants={reveal} transition={{ duration: 0.42, delay: 0.24 }} className="mt-xl flex flex-col justify-center gap-3 sm:flex-row">
              <a href="#get-started" className="inline-flex items-center justify-center gap-2 rounded-full bg-primary px-6 py-3.5 text-sm font-bold text-primary-foreground transition-transform duration-200 hover:-translate-y-0.5 hover:bg-secondary">{platform_pages.solutions.hero.primaryCta}<ArrowRight size={17} /></a>
              <a href="#contact" className="inline-flex items-center justify-center rounded-full border border-border bg-card px-6 py-3.5 text-sm font-bold text-secondary transition-colors hover:border-primary hover:text-primary">{platform_pages.solutions.hero.secondaryCta}</a>
            </motion.div>
          </div>
        </section>

        <section className="bg-muted py-xxxl">
          <div className="mx-auto grid max-w-content items-center gap-xxl px-5 lg:grid-cols-[1fr_1.05fr] lg:px-8">
            <motion.div initial="hidden" whileInView="visible" viewport={{ once: true, amount: 0.2 }} variants={reveal} transition={{ duration: 0.45 }}>
              <p className="text-sm font-bold text-primary">{platform_pages.solutions.missedCalls.eyebrow}</p>
              <h2 className="mt-sm text-4xl font-extrabold tracking-[-0.045em] text-secondary sm:text-5xl">{platform_pages.solutions.missedCalls.title}</h2>
              <p className="mt-base text-lg leading-8 text-muted-foreground">{platform_pages.solutions.missedCalls.description}</p>
              <a href="/how-it-works" className="mt-xl inline-flex items-center gap-2 text-sm font-bold text-primary hover:text-secondary">{platform_pages.solutions.missedCalls.cta}<ArrowRight size={17} /></a>
            </motion.div>
            <motion.div id="how-it-works" initial={{ opacity: 0, x: 24 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true, amount: 0.2 }} transition={{ duration: 0.5 }} className="rounded-3xl bg-secondary p-base shadow-xl">
              <ContentListContext field="missedCalls.flow"><div className="grid gap-3">{platform_pages.solutions.missedCalls.flow.map((step, index) => <div key={step.label} className="flex items-center gap-3 rounded-2xl bg-card p-4"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent text-primary">{index === 0 ? <PhoneCall size={19} /> : index === 1 ? <Send size={19} /> : index === 2 ? <MessageCircle size={19} /> : <BellRing size={19} />}</span><span className="min-w-0 flex-1 text-sm font-extrabold text-secondary">{step.label}</span>{index < platform_pages.solutions.missedCalls.flow.length - 1 && <ArrowDown className="text-primary" size={18} />}</div>)}</div></ContentListContext>
            </motion.div>
          </div>
        </section>

        <section className="bg-background py-xxxl">
          <div className="mx-auto grid max-w-content items-center gap-xxl px-5 lg:grid-cols-[1.05fr_1fr] lg:px-8">
            <motion.div initial={{ opacity: 0, x: -24 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true, amount: 0.2 }} transition={{ duration: 0.48 }} className="order-2 rounded-3xl border border-border bg-card p-base shadow-lg lg:order-1">
              <div className="rounded-2xl bg-muted p-base"><div className="flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary text-primary-foreground"><Bot size={21} /></span><div><p className="text-sm font-extrabold text-secondary">Customer conversation</p><p className="text-xs text-muted-foreground">Guided by your business preferences</p></div></div><div className="mt-base grid gap-3"><p className="w-4/5 rounded-2xl rounded-tl-sm bg-card p-3 text-sm leading-6 text-secondary">How can we help today?</p><p className="ml-auto w-4/5 rounded-2xl rounded-tr-sm bg-primary p-3 text-sm leading-6 text-primary-foreground">I need help with a service request.</p><div className="flex items-center gap-2 rounded-xl border border-border bg-card p-3"><UserRoundCheck size={17} className="text-primary" /><span className="text-xs font-bold text-secondary">Ready to involve a team member</span></div></div></div>
            </motion.div>
            <motion.div initial="hidden" whileInView="visible" viewport={{ once: true, amount: 0.2 }} variants={reveal} transition={{ duration: 0.45 }} className="order-1 lg:order-2">
              <p className="text-sm font-bold text-primary">{platform_pages.solutions.aiConversations.eyebrow}</p><h2 className="mt-sm text-4xl font-extrabold tracking-[-0.045em] text-secondary sm:text-5xl">{platform_pages.solutions.aiConversations.title}</h2><p className="mt-base text-lg leading-8 text-muted-foreground">{platform_pages.solutions.aiConversations.description}</p>
              <ContentListContext field="aiConversations.items"><ul className="mt-xl grid gap-3 sm:grid-cols-2">{platform_pages.solutions.aiConversations.items.map((item) => <li key={item.label} className="flex items-center gap-2 text-sm font-bold text-secondary"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-primary"><Check size={14} /></span>{item.label}</li>)}</ul></ContentListContext>
              <p className="mt-xl rounded-2xl border border-border bg-muted p-4 text-sm font-semibold leading-6 text-secondary">{platform_pages.solutions.aiConversations.controlNote}</p>
            </motion.div>
          </div>
        </section>

        <section className="bg-muted py-xxxl">
          <div className="mx-auto grid max-w-content items-center gap-xxl px-5 lg:grid-cols-[1fr_1.15fr] lg:px-8">
            <motion.div initial="hidden" whileInView="visible" viewport={{ once: true, amount: 0.2 }} variants={reveal} transition={{ duration: 0.45 }}>
              <p className="text-sm font-bold text-primary">{platform_pages.solutions.leadCapture.eyebrow}</p><h2 className="mt-sm text-4xl font-extrabold tracking-[-0.045em] text-secondary sm:text-5xl">{platform_pages.solutions.leadCapture.title}</h2><p className="mt-base text-lg leading-8 text-muted-foreground">{platform_pages.solutions.leadCapture.description}</p>
            </motion.div>
            <motion.div initial={{ opacity: 0, y: 18 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.2 }} transition={{ duration: 0.45 }} className="overflow-hidden rounded-3xl border border-border bg-card shadow-lg">
              <div className="flex items-center gap-3 border-b border-border bg-background p-base"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-primary"><ClipboardList size={19} /></span><div><p className="text-sm font-extrabold text-secondary">Organized lead view</p><p className="text-xs text-muted-foreground">Customer details from the conversation</p></div></div>
              <div className="overflow-x-auto p-base"><table className="min-w-[620px] w-full text-left"><thead><ContentListContext field="leadCapture.table.headers"><tr>{platform_pages.solutions.leadCapture.table.headers.map((header) => <th key={header.label} className="border-b border-border pb-3 pr-4 text-xs font-bold text-muted-foreground">{header.label}</th>)}</tr></ContentListContext></thead><tbody><tr>{platform_pages.solutions.leadCapture.table.headers.map((header) => <td key={header.label} className="border-b border-border py-4 pr-4 text-sm font-semibold text-secondary">{header.label === 'Customer' ? platform_pages.solutions.leadCapture.table.row.customer : header.label === 'Service' ? platform_pages.solutions.leadCapture.table.row.service : header.label === 'Address' ? platform_pages.solutions.leadCapture.table.row.address : header.label === 'Urgency' ? platform_pages.solutions.leadCapture.table.row.urgency : platform_pages.solutions.leadCapture.table.row.status}</td>)}</tr></tbody></table></div>
            </motion.div>
          </div>
        </section>

        <section className="bg-background py-xxxl">
          <div className="mx-auto grid max-w-content items-center gap-xxl px-5 lg:grid-cols-[1.05fr_.95fr] lg:px-8">
            <motion.div initial={{ opacity: 0, x: 24 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true, amount: 0.2 }} transition={{ duration: 0.48 }} className="order-2 rounded-3xl bg-secondary p-base shadow-xl lg:order-1"><div className="rounded-2xl bg-card p-base"><div className="flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary text-primary-foreground"><CalendarCheck size={21} /></span><div><p className="text-sm font-extrabold text-secondary">Customer follow-up</p><p className="text-xs text-muted-foreground">A clear next touchpoint</p></div></div><div className="mt-xl rounded-2xl bg-muted p-4"><p className="text-xs font-bold text-primary">Message ready</p><p className="mt-2 text-sm leading-6 text-secondary">Thanks for reaching out. Your team has the details and will follow up with the next step.</p></div><div className="mt-3 flex items-center gap-2 text-xs font-semibold text-muted-foreground"><Clock3 size={15} className="text-primary" />Keep every important customer moment visible.</div></div></motion.div>
            <motion.div initial="hidden" whileInView="visible" viewport={{ once: true, amount: 0.2 }} variants={reveal} transition={{ duration: 0.45 }} className="order-1 lg:order-2"><p className="text-sm font-bold text-primary">{platform_pages.solutions.followUps.eyebrow}</p><h2 className="mt-sm text-4xl font-extrabold tracking-[-0.045em] text-secondary sm:text-5xl">{platform_pages.solutions.followUps.title}</h2><p className="mt-base text-lg leading-8 text-muted-foreground">{platform_pages.solutions.followUps.description}</p><ContentListContext field="followUps.items"><div className="mt-xl grid gap-3 sm:grid-cols-2">{platform_pages.solutions.followUps.items.map((item) => <div key={item.label} className="flex items-center gap-3 rounded-xl border border-border bg-card p-3 text-sm font-bold text-secondary"><span className="h-2 w-2 rounded-full bg-primary" />{item.label}</div>)}</div></ContentListContext></motion.div>
          </div>
        </section>

        <section className="bg-muted py-xxxl">
          <div className="mx-auto grid max-w-content items-center gap-xxl px-5 lg:grid-cols-[1fr_1.05fr] lg:px-8"><motion.div initial="hidden" whileInView="visible" viewport={{ once: true, amount: 0.2 }} variants={reveal} transition={{ duration: 0.45 }}><p className="text-sm font-bold text-primary">{platform_pages.solutions.unified.eyebrow}</p><h2 className="mt-sm text-4xl font-extrabold tracking-[-0.045em] text-secondary sm:text-5xl">{platform_pages.solutions.unified.title}</h2><p className="mt-base text-lg leading-8 text-muted-foreground">{platform_pages.solutions.unified.description}</p></motion.div><motion.div initial={{ opacity: 0, scale: 0.97 }} whileInView={{ opacity: 1, scale: 1 }} viewport={{ once: true, amount: 0.2 }} transition={{ duration: 0.45 }} className="rounded-3xl bg-secondary p-base shadow-xl"><ContentListContext field="unified.steps"><div className="flex flex-col items-center">{platform_pages.solutions.unified.steps.map((step, index) => <div key={step.label} className="flex w-full max-w-xs flex-col items-center"><div className="flex w-full items-center gap-3 rounded-2xl bg-card p-4"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent text-primary">{index === 0 ? <PhoneCall size={17} /> : index === 1 ? <MessageCircle size={17} /> : index === 2 ? <Bot size={17} /> : index === 3 ? <ClipboardList size={17} /> : <UserRoundCheck size={17} />}</span><span className="text-sm font-extrabold text-secondary">{step.label}</span></div>{index < platform_pages.solutions.unified.steps.length - 1 && <ArrowDown className="my-2 text-primary" size={19} />}</div>)}</div></ContentListContext></motion.div></div>
        </section>

        <section className="bg-background py-xxxl">
          <div className="mx-auto max-w-content px-5 lg:px-8"><div className="max-w-2xl"><p className="text-sm font-bold text-primary">{platform_pages.solutions.industries.eyebrow}</p><h2 className="mt-sm text-4xl font-extrabold tracking-[-0.045em] text-secondary sm:text-5xl">{platform_pages.solutions.industries.title}</h2></div><ContentListContext field="industries.items"><div className="mt-xxl grid grid-cols-1 gap-base md:grid-cols-2 lg:grid-cols-4">{platform_pages.solutions.industries.items.map((item) => <motion.article key={item.title} initial="hidden" whileInView="visible" viewport={{ once: true, amount: 0.2 }} variants={reveal} transition={{ duration: 0.35 }} className="rounded-3xl border border-border bg-card p-base shadow-sm transition-transform duration-200 hover:-translate-y-1 hover:shadow-lg"><span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-accent text-primary">{item.title === 'Home Services' ? <PhoneCall size={20} /> : item.title === 'Appointment-Based Businesses' ? <CalendarCheck size={20} /> : item.title === 'Local Businesses' ? <MessageCircle size={20} /> : <ClipboardList size={20} />}</span><h3 className="mt-lg text-xl font-extrabold tracking-tight text-secondary">{item.title}</h3><p className="mt-sm text-sm leading-6 text-muted-foreground">{item.description}</p></motion.article>)}</div></ContentListContext></div>
        </section>

        <section id="get-started" className="bg-background py-xxxl"><div className="mx-auto max-w-content px-5 lg:px-8"><div id="contact" className="relative overflow-hidden rounded-3xl bg-secondary px-base py-xxl text-secondary-foreground sm:px-xxl"><div className="pointer-events-none absolute -right-12 -top-16 h-64 w-64 rounded-full bg-primary blur-3xl" /><div className="relative grid items-end gap-xl lg:grid-cols-[1fr_auto]"><div className="max-w-2xl"><h2 className="text-4xl font-extrabold tracking-[-0.045em] text-primary-foreground sm:text-5xl">{platform_pages.solutions.cta.title}</h2><p className="mt-base text-lg leading-8 text-secondary-foreground">{platform_pages.solutions.cta.description}</p></div><div className="flex flex-col gap-3 sm:flex-row"><a href="mailto:hello@connectionpilot.net" className="inline-flex items-center justify-center gap-2 rounded-full bg-background px-6 py-3.5 text-sm font-bold text-secondary transition-transform duration-200 hover:-translate-y-0.5">{platform_pages.solutions.cta.primaryCta}<ArrowRight size={17} /></a><a href="mailto:hello@connectionpilot.net" className="inline-flex items-center justify-center rounded-full border border-primary bg-secondary px-6 py-3.5 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary">{platform_pages.solutions.cta.secondaryCta}</a></div></div></div></div></section>
      </main>
    </>
  );
}
