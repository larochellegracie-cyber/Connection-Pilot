import { Helmet } from '@dr.pogodin/react-helmet';
import { ArrowRight, Settings as SettingsIcon } from 'lucide-react';
import { Link } from 'react-router';
import { ProtectedRoute } from '@/lib/auth/auth-client';
import WorkspaceLayout from '@/layouts/WorkspaceLayout';
import { settings } from 'virtual:content';

function SettingsContent() {
  return <WorkspaceLayout><section><div className="max-w-2xl"><span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-accent text-primary"><SettingsIcon size={20} /></span><h1 className="mt-base text-3xl font-extrabold tracking-tight text-secondary">{settings.hero.title}</h1><p className="mt-2 leading-7 text-muted-foreground">{settings.hero.description}</p></div><div className="mt-xl grid grid-cols-1 gap-base md:grid-cols-2">{settings.cards.map((card) => <article key={card.title} className="flex flex-col rounded-3xl border border-border bg-card p-base"><h2 className="text-lg font-extrabold text-secondary">{card.title}</h2><p className="mt-2 flex-1 text-sm leading-6 text-muted-foreground">{card.description}</p><Link to={card.title === 'Business profile' ? '/business-profile' : card.title === 'Booking rules' ? '/dashboard/booking-rules' : card.title === 'Phone connection' ? '/phone-connection' : '/profile'} className="mt-lg inline-flex w-fit items-center gap-2 rounded-full bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground transition-colors hover:bg-secondary active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{card.action}<ArrowRight size={16} /></Link></article>)}</div></section></WorkspaceLayout>;
}

export default function SettingsPage() {
  return <><Helmet><title>{settings.meta.title}</title><meta name="description" content={settings.meta.description} /><meta name="robots" content="noindex, nofollow" /></Helmet><ProtectedRoute><SettingsContent /></ProtectedRoute></>;
}
