import { Helmet } from '@dr.pogodin/react-helmet';
import { PhoneCall, ShieldCheck, Sparkles } from 'lucide-react';
import { ProtectedRoute } from '@/lib/auth/auth-client';
import WorkspaceLayout from '@/layouts/WorkspaceLayout';
import { phone_ai_receptionist } from 'virtual:content';

function AiReceptionistContent() {
  return <WorkspaceLayout><main className="grid gap-xl">
    <section className="rounded-3xl border border-border bg-card p-base shadow-sm sm:p-xl">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm font-bold text-primary">{phone_ai_receptionist.hero.eyebrow}</p>
        <span className="rounded-full bg-accent px-3 py-1 text-xs font-extrabold text-primary">{phone_ai_receptionist.receptionist.badge}</span>
      </div>
      <h1 className="mt-sm text-3xl font-extrabold tracking-tight text-secondary sm:text-4xl">{phone_ai_receptionist.hero.title}</h1>
      <p className="mt-base max-w-2xl text-base leading-7 text-muted-foreground">{phone_ai_receptionist.hero.description}</p>
    </section>

    <section className="rounded-2xl border border-border bg-card p-base shadow-sm sm:p-xl" aria-labelledby="voice-receptionist-title">
      <div className="flex flex-col gap-base sm:flex-row sm:items-start sm:justify-between">
        <div className="flex gap-3"><span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground"><PhoneCall className="h-6 w-6" aria-hidden="true" /></span><div><h2 id="voice-receptionist-title" className="text-2xl font-extrabold text-secondary">{phone_ai_receptionist.receptionist.title}</h2><p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">{phone_ai_receptionist.receptionist.description}</p></div></div>
        <button type="button" disabled aria-disabled="true" className="inline-flex min-w-44 cursor-not-allowed items-center justify-center gap-2 rounded-full border border-border bg-muted px-5 py-3 text-sm font-bold text-muted-foreground"><ShieldCheck className="h-4 w-4" />{phone_ai_receptionist.receptionist.disabledAction}</button>
      </div>
      <p className="mt-xl rounded-xl bg-muted p-base text-sm leading-6 text-secondary">{phone_ai_receptionist.receptionist.note}</p>
    </section>

    <section aria-labelledby="voice-availability-title"><div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-primary"><Sparkles className="h-5 w-5" aria-hidden="true" /></span><div><h2 id="voice-availability-title" className="text-xl font-extrabold text-secondary">{phone_ai_receptionist.availability.title}</h2><p className="mt-1 text-sm text-muted-foreground">The feature remains visible while voice phone service is being prepared.</p></div></div><div className="mt-base grid grid-cols-1 gap-base md:grid-cols-3">{phone_ai_receptionist.availability.items.map((item) => <article key={item.id} className="rounded-2xl border border-border bg-card p-base shadow-sm"><h3 className="font-extrabold text-secondary">{item.title}</h3><p className="mt-sm text-sm leading-6 text-muted-foreground">{item.description}</p></article>)}</div></section>
  </main></WorkspaceLayout>;
}

export default function AiReceptionistPage() { return <><Helmet><title>{phone_ai_receptionist.seo.title}</title><meta name="description" content={phone_ai_receptionist.seo.description} /><meta name="robots" content="noindex, nofollow" /></Helmet><ProtectedRoute><AiReceptionistContent /></ProtectedRoute></>; }
