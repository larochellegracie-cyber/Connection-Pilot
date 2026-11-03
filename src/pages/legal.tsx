import type { ReactNode } from 'react';
import { Helmet } from '@dr.pogodin/react-helmet';
import { Link } from 'react-router';
import { site } from 'virtual:content';

const siteUrl = 'https://connectionpilot.net';
const ogImage = `${siteUrl}/airo-assets/images/logo/horizontal`;
const updated = 'November 2026';

type Section = { heading: string; body: ReactNode };
function LegalPage({ title, description, path, intro, sections }: { title: string; description: string; path: string; intro: string; sections: Section[] }) {
  const jsonLd = { '@context': 'https://schema.org', '@type': 'WebPage', '@id': `${siteUrl}${path}#webpage`, name: title, url: `${siteUrl}${path}`, isPartOf: { '@id': `${siteUrl}/#website` }, about: { '@id': `${siteUrl}/#organization` } };
  return (
    <>
      <Helmet>
        <title>{title}</title>
        <meta name="description" content={description} />
        <link rel="canonical" href={`${siteUrl}${path}`} />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={description} />
        <meta property="og:type" content="website" />
        <meta property="og:url" content={`${siteUrl}${path}`} />
        <meta property="og:image" content={ogImage} />
        <meta name="twitter:card" content="summary" />
        <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>
      </Helmet>
      <main className="bg-background py-xxxl">
        <article className="mx-auto max-w-3xl px-5 lg:px-8">
          <p className="text-sm font-bold text-primary">Legal</p>
          <h1 className="mt-sm text-4xl font-extrabold tracking-tight text-secondary">{title.split(' | ')[0]}</h1>
          <p className="mt-sm text-sm text-muted-foreground">Last updated {updated}</p>
          <p className="mt-lg text-lg leading-8 text-muted-foreground">{intro}</p>
          {sections.map((s) => (
            <section key={s.heading} className="mt-xl">
              <h2 className="text-2xl font-bold text-secondary">{s.heading}</h2>
              <div className="mt-sm space-y-3 leading-7 text-muted-foreground">{s.body}</div>
            </section>
          ))}
          <p className="mt-xl leading-7 text-muted-foreground">
            Questions about this page? Write to <a className="font-semibold text-primary underline" href={`mailto:${site.contactEmail}`}>{site.contactEmail}</a> or visit our <Link className="font-semibold text-primary underline" to="/contact">contact page</Link>.
          </p>
        </article>
      </main>
    </>
  );
}

const list = (items: string[]) => <ul className="list-disc space-y-1 pl-6">{items.map((i) => <li key={i}>{i}</li>)}</ul>;

export function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy | Connection Pilot"
      description="What Connection Pilot collects, why, who helps us process it, and the choices you have."
      path="/privacy"
      intro="Connection Pilot is a workspace where a business keeps its customers, scheduling, quotes, invoices and messages together, with an AI assistant called Pilot. This page explains what information the service handles and the choices you have."
      sections={[
        { heading: 'What we collect', body: list(['Your account details: name, email address and a password (stored only in protected form).', 'Information about your business that you enter or import: its profile, services, hours, team, customers, leads, jobs, quotes, invoices and schedule.', 'Messages and files you create or upload in the workspace, such as notes, documents and images.', 'Billing information is handled by our payment provider; we do not store full card numbers.', 'Basic technical data needed to run the service safely, such as sign-in sessions and error logs.']) },
        { heading: 'How we use it', body: list(['To provide the workspace and the features you choose to use.', 'To let Pilot answer questions and draft work from the information in your own workspace.', 'To send the emails and texts you ask the service to send (for example schedules, quotes, invoices and password resets).', 'To take payment for your plan and keep the service secure.']) },
        { heading: 'Who helps us process it', body: <><p>We use outside providers to run parts of the service. They receive only what each job needs:</p>{list(['Payments and subscriptions: Stripe.', 'Email delivery: Resend.', 'Phone and text features: Twilio.', 'The Pilot assistant and document review: OpenAI.', 'Reading a business website you ask us to learn from: Firecrawl.', 'Hosting and the database: our hosting provider.'])}<p>We do not sell your information.</p></> },
        { heading: 'Cookies', body: <p>We use cookies that keep you signed in and the site working. We do not use advertising cookies. If we ever add analytics, we will ask you first.</p> },
        { heading: 'Your choices', body: <p>You can see and change the information in your workspace at any time. To ask for your account or data to be corrected or deleted, email us at the address below and we will respond.</p> },
        { heading: 'Changes', body: <p>If this page changes in a way that matters, we will update the date above.</p> },
      ]}
    />
  );
}

export function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service | Connection Pilot"
      description="The terms for using Connection Pilot: your account, plans and billing, the AI assistant, and acceptable use."
      path="/terms"
      intro="These terms apply when you use Connection Pilot. By creating an account or using the service you agree to them."
      sections={[
        { heading: 'Your account', body: <p>You are responsible for your account, for keeping your password private, and for the information you and your team put into the workspace. Only use Connection Pilot for lawful business purposes.</p> },
        { heading: 'Plans and billing', body: <><p>Plans are billed monthly. Every plan starts with a 7-day free trial. Current plans and prices are shown on the <Link className="font-semibold text-primary underline" to="/pricing">pricing page</Link>. You can change your plan later, and payments are processed by Stripe.</p></> },
        { heading: 'The Pilot assistant', body: <><p>Pilot uses AI to answer questions, draft messages and suggest actions. AI can make mistakes, so check anything important before you send it to a customer or rely on it. You stay responsible for what you send and do with Pilot's help.</p><p>Features marked "Coming Soon", such as the AI Voice Receptionist, are not available yet.</p></> },
        { heading: 'Your information', body: <p>The information you put into Connection Pilot stays yours. You allow us to process it only to run the service for you, as described in our <Link className="font-semibold text-primary underline" to="/privacy">Privacy Policy</Link>.</p> },
        { heading: 'Acceptable use', body: list(['Do not use the service to break the law or to send spam, harassment or misleading messages.', 'Do not try to disrupt, copy or gain unauthorised access to the service or other people\'s information.', 'Only add customer contact details you are entitled to use.']) },
        { heading: 'The service', body: <p>We work to keep Connection Pilot available and accurate, but it is provided as it is, and we cannot promise it will always be uninterrupted or error free. To the extent the law allows, we are not liable for indirect or lost-profit losses from using it. We may update these terms and will change the date above when we do.</p> },
      ]}
    />
  );
}
