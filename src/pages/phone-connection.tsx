import { Helmet } from '@dr.pogodin/react-helmet';
import { PhoneCall, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router';
import { ProtectedRoute } from '@/lib/auth/auth-client';
import WorkspaceLayout from '@/layouts/WorkspaceLayout';
import { phone_connection } from 'virtual:content';

function PhoneConnectionContent() {
  return <WorkspaceLayout><main className="grid gap-xl"><section className="rounded-3xl border border-border bg-card p-base shadow-sm sm:p-xl"><div className="flex flex-wrap items-center gap-3"><p className="text-sm font-bold text-primary">{phone_connection.hero.eyebrow}</p><span className="rounded-full bg-accent px-3 py-1 text-xs font-extrabold text-primary">{phone_connection.hero.badge}</span></div><div className="mt-base flex gap-4"><span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-muted text-muted-foreground"><PhoneCall size={22} /></span><div><h1 className="text-3xl font-extrabold tracking-tight text-secondary">{phone_connection.hero.title}</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{phone_connection.hero.description}</p></div></div></section><section className="rounded-2xl border border-border bg-card p-base shadow-sm sm:p-xl"><div className="flex gap-3"><ShieldCheck className="mt-0.5 shrink-0 text-primary" size={21} /><div><h2 className="text-xl font-extrabold text-secondary">{phone_connection.status.title}</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{phone_connection.status.description}</p></div></div><Link to="/dashboard/ai-receptionist" className="mt-xl inline-flex rounded-full border border-border px-5 py-2.5 text-sm font-bold text-primary hover:border-primary">{phone_connection.status.action}</Link></section></main></WorkspaceLayout>;
}

export default function PhoneConnectionPage() { return <><Helmet><title>{phone_connection.seo.title}</title><meta name="description" content={phone_connection.seo.description} /><meta name="robots" content="noindex, nofollow" /></Helmet><ProtectedRoute><PhoneConnectionContent /></ProtectedRoute></>; }
