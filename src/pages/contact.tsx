import { Helmet } from '@dr.pogodin/react-helmet';
import { type FormEvent, useState } from 'react';
import { Mail, MessageSquareText } from 'lucide-react';
import { contact } from 'virtual:content';

type FormStatus = 'idle' | 'sending' | 'success' | 'error';

const siteUrl = 'https://connectionpilot.net';
const pageTitle = 'Contact Connection Pilot | Sales Inquiries';
const pageDescription = 'Contact Connection Pilot to discuss AI-assisted customer conversations, business calls, texts, and customer workflows.';

export default function ContactPage() {
  const [status, setStatus] = useState<FormStatus>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    if (formData.get('_gotcha')) return;

    const name = String(formData.get('name') ?? '').trim();
    const email = String(formData.get('email') ?? '').trim();
    const company = String(formData.get('company') ?? '').trim();
    const phone = String(formData.get('phone') ?? '').trim();
    const teamSize = String(formData.get('teamSize') ?? '').trim();
    const interest = String(formData.get('interest') ?? '').trim();
    const message = String(formData.get('message') ?? '').trim();

    setStatus('sending');
    setErrorMessage('');
    try {
      // Field mapping: only the message textarea goes in messages_attributes[0].body.
      // All other fields (dropdowns, radios, checkboxes) must be added to conversation.data as { "Label": value } pairs.
      const response = await fetch('/api/contact/sales-inquiry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversation: {
            messages_attributes: [{ body: message || 'New sales inquiry' }],
            data: {
              __gd_contact_form_title: contact.form.title,
              'Company name': company,
              'Phone number': phone,
              'Team size': teamSize,
              'What would you like to explore?': interest,
            },
          },
          user: { email, name },
        }),
      });
      const payload = await response.json() as { success?: boolean; error?: string };
      if (!payload.success) throw new Error(payload.error || contact.form.error);
      form.reset();
      setStatus('success');
    } catch (error) {
      setStatus('error');
      setErrorMessage(error instanceof Error ? error.message : contact.form.error);
    }
  }

  return <><Helmet><title>{pageTitle}</title><meta name="description" content={pageDescription} /><link rel="canonical" href={`${siteUrl}/contact`} /><meta property="og:title" content={pageTitle} /><meta property="og:description" content={pageDescription} /><meta property="og:type" content="website" /><meta property="og:url" content={`${siteUrl}/contact`} /><meta name="twitter:card" content="summary_large_image" /><meta name="twitter:title" content={pageTitle} /><meta name="twitter:description" content={pageDescription} /><script type="application/ld+json">{JSON.stringify({ '@context': 'https://schema.org', '@type': 'ContactPage', '@id': `${siteUrl}/contact#webpage`, name: pageTitle, url: `${siteUrl}/contact`, isPartOf: { '@id': `${siteUrl}/#website` }, about: { '@id': `${siteUrl}/#organization` } }).replace(/</g, '\\u003c')}</script></Helmet><main><section className="bg-secondary py-xxxl text-secondary-foreground"><div className="mx-auto max-w-content px-5 lg:px-8"><p className="text-sm font-bold text-primary-foreground">{contact.hero.eyebrow}</p><h1 className="mt-base max-w-3xl text-4xl font-extrabold tracking-[-0.05em] sm:text-6xl">{contact.hero.title}</h1><p className="mt-lg max-w-2xl text-lg leading-8 text-secondary-foreground">{contact.hero.description}</p></div></section><section className="bg-muted py-xxl"><div className="mx-auto grid max-w-content grid-cols-1 gap-xl px-5 lg:grid-cols-[0.78fr_1.22fr] lg:px-8"><aside className="rounded-3xl bg-card p-xl"><MessageSquareText className="text-primary" size={30} aria-hidden="true" /><h2 className="mt-lg text-3xl font-extrabold tracking-[-0.04em] text-secondary">{contact.details.title}</h2><p className="mt-base text-base leading-7 text-muted-foreground">{contact.details.description}</p><div className="mt-xl border-t border-border pt-base"><p className="text-sm font-bold text-secondary">{contact.details.emailLabel}</p><a href={`mailto:${contact.details.email}`} className="mt-sm inline-flex items-center gap-2 text-sm font-bold text-primary hover:text-secondary"><Mail size={16} aria-hidden="true" />{contact.details.email}</a></div><div className="mt-xl rounded-2xl bg-accent p-base"><h3 className="text-base font-extrabold text-secondary">{contact.details.responseTitle}</h3><p className="mt-sm text-sm leading-6 text-muted-foreground">{contact.details.responseDescription}</p></div></aside><section className="rounded-3xl border border-border bg-card p-base sm:p-xl"><h2 className="text-3xl font-extrabold tracking-[-0.04em] text-secondary">{contact.form.title}</h2><p className="mt-sm text-muted-foreground">{contact.form.description}</p><form onSubmit={handleSubmit} className="mt-xl grid gap-base"><input type="text" name="_gotcha" tabIndex={-1} autoComplete="off" style={{ position: 'absolute', left: '-9999px' }} aria-hidden="true" /><div className="grid grid-cols-1 gap-base sm:grid-cols-2"><label className="grid gap-2 text-sm font-bold text-secondary">{contact.form.name}<input required name="name" className="rounded-xl border border-border bg-background px-4 py-3 text-base font-normal outline-none focus:border-primary focus:ring-2 focus:ring-ring" /></label><label className="grid gap-2 text-sm font-bold text-secondary">{contact.form.email}<input required name="email" type="email" className="rounded-xl border border-border bg-background px-4 py-3 text-base font-normal outline-none focus:border-primary focus:ring-2 focus:ring-ring" /></label></div><div className="grid grid-cols-1 gap-base sm:grid-cols-2"><label className="grid gap-2 text-sm font-bold text-secondary">{contact.form.company}<input required name="company" className="rounded-xl border border-border bg-background px-4 py-3 text-base font-normal outline-none focus:border-primary focus:ring-2 focus:ring-ring" /></label><label className="grid gap-2 text-sm font-bold text-secondary">{contact.form.phone}<input required name="phone" type="tel" className="rounded-xl border border-border bg-background px-4 py-3 text-base font-normal outline-none focus:border-primary focus:ring-2 focus:ring-ring" /></label></div><div className="grid grid-cols-1 gap-base sm:grid-cols-2"><label className="grid gap-2 text-sm font-bold text-secondary">{contact.form.teamSize}<select required name="teamSize" defaultValue="" className="rounded-xl border border-border bg-background px-4 py-3 text-base font-normal outline-none focus:border-primary focus:ring-2 focus:ring-ring"><option value="" disabled>Select a team size</option>{contact.form.teamOptions.map((option) => <option key={option} value={option}>{option}</option>)}</select></label><label className="grid gap-2 text-sm font-bold text-secondary">{contact.form.interest}<select required name="interest" defaultValue="" className="rounded-xl border border-border bg-background px-4 py-3 text-base font-normal outline-none focus:border-primary focus:ring-2 focus:ring-ring"><option value="" disabled>Select an option</option>{contact.form.interestOptions.map((option) => <option key={option} value={option}>{option}</option>)}</select></label></div><label className="grid gap-2 text-sm font-bold text-secondary">{contact.form.message}<textarea name="message" rows={5} className="resize-y rounded-xl border border-border bg-background px-4 py-3 text-base font-normal outline-none focus:border-primary focus:ring-2 focus:ring-ring" /></label>{status === 'error' && <p role="alert" className="text-sm font-bold text-destructive">{errorMessage}</p>}{status === 'success' && <p role="status" className="rounded-xl bg-accent p-3 text-sm font-bold text-secondary">{contact.form.success}</p>}<button type="submit" disabled={status === 'sending'} className="w-full rounded-full bg-primary px-6 py-3.5 text-sm font-bold text-primary-foreground transition-transform hover:-translate-y-0.5 hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-60">{status === 'sending' ? contact.form.sending : contact.form.submit}</button></form></section></div></section></main></>;
}
