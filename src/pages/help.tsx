import { Helmet } from '@dr.pogodin/react-helmet';
import { CircleHelp, ExternalLink, LifeBuoy } from 'lucide-react';
import { Link } from 'react-router';
import { ProtectedRoute } from '@/lib/auth/auth-client';
import WorkspaceLayout from '@/layouts/WorkspaceLayout';
import { help } from 'virtual:content';

function HelpContent() {
  return <WorkspaceLayout><section><div className="max-w-2xl"><span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-accent text-primary"><CircleHelp size={20} /></span><h1 className="mt-base text-3xl font-extrabold tracking-tight text-secondary">{help.hero.title}</h1><p className="mt-2 leading-7 text-muted-foreground">{help.hero.description}</p></div><div className="mt-xl grid grid-cols-1 gap-base md:grid-cols-3">{help.topics.map((topic) => <article key={topic.title} className="flex flex-col rounded-3xl border border-border bg-card p-base"><h2 className="text-lg font-extrabold text-secondary">{topic.title}</h2><p className="mt-2 flex-1 text-sm leading-6 text-muted-foreground">{topic.description}</p><Link to={topic.title === 'Set up your workspace' ? '/business-profile' : topic.title === 'Manage appointments' ? '/calendar' : '/dashboard/booking-rules'} className="mt-lg inline-flex items-center gap-2 text-sm font-bold text-primary transition-colors hover:text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{topic.action}<ExternalLink size={15} /></Link></article>)}</div><section className="mt-xl rounded-3xl border border-primary bg-accent p-base sm:p-xl"><div className="flex flex-col justify-between gap-base sm:flex-row sm:items-center"><div><div className="flex items-center gap-2 text-secondary"><LifeBuoy size={20} /><h2 className="text-xl font-extrabold">{help.support.title}</h2></div><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{help.support.description}</p></div><Link to="/contact" className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-bold text-primary-foreground transition-colors hover:bg-secondary active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{help.support.action}<ExternalLink size={16} /></Link></div></section></section></WorkspaceLayout>;
}

export default function HelpPage() {
  return <><Helmet><title>{help.meta.title}</title><meta name="description" content={help.meta.description} /><meta name="robots" content="noindex, nofollow" /></Helmet><ProtectedRoute><HelpContent /></ProtectedRoute></>;
}
