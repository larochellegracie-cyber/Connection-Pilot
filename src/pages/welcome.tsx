import { Helmet } from '@dr.pogodin/react-helmet';
import { ContentListContext } from '@airo/content';
import { ArrowRight, Check, Circle } from 'lucide-react';
import { ProtectedRoute, useSession } from '@/lib/auth/auth-client';
import { welcome } from 'virtual:content';

const siteUrl = 'https://connectionpilot.net';
const pageTitle = 'Welcome to Connection Pilot';
const pageDescription = 'Finish setting up your Connection Pilot customer communication workspace.';

function WelcomeContent() {
  const { user } = useSession();
  return <main className="bg-muted py-xxxl"><div className="mx-auto max-w-3xl px-5 lg:px-8"><section className="rounded-3xl border border-border bg-card p-base text-center shadow-xl sm:p-xxl"><span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-xl font-extrabold text-primary-foreground">CC</span><p className="mt-xl text-sm font-bold text-primary">Your account is ready{user?.name ? `, ${user.name}` : ''}</p><h1 className="mt-sm text-4xl font-extrabold tracking-[-0.05em] text-secondary sm:text-5xl">{welcome.hero.title}</h1><p className="mx-auto mt-base max-w-xl text-lg leading-8 text-muted-foreground">{welcome.hero.description}</p><ContentListContext field="checklist"><ol className="mx-auto mt-xxl max-w-xl text-left">{welcome.checklist.map((item) => <li key={item.label} className="flex items-center gap-3 border-b border-border py-4 text-sm font-bold text-secondary">{item.state === 'complete' ? <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"><Check size={16} /></span> : <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-background text-muted-foreground"><Circle size={10} /></span>}{item.label}</li>)}</ol></ContentListContext><a href="/dashboard" className="mt-xl inline-flex items-center justify-center gap-2 rounded-full bg-primary px-6 py-3.5 text-sm font-bold text-primary-foreground transition-transform duration-200 hover:-translate-y-0.5 hover:bg-secondary">{welcome.hero.start}<ArrowRight size={17} /></a></section></div></main>;
}

export default function WelcomePage() {
  return <><Helmet><title>{pageTitle}</title><meta name="description" content={pageDescription} /><link rel="canonical" href={`${siteUrl}/welcome`} /><meta property="og:title" content={pageTitle} /><meta property="og:description" content={pageDescription} /><meta property="og:type" content="website" /><meta property="og:url" content={`${siteUrl}/welcome`} /><meta name="twitter:card" content="summary_large_image" /><meta name="twitter:title" content={pageTitle} /><meta name="twitter:description" content={pageDescription} /></Helmet><ProtectedRoute><WelcomeContent /></ProtectedRoute></>;
}
