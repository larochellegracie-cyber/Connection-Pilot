import { Helmet } from '@dr.pogodin/react-helmet';
import { Link } from 'react-router';
import { ChevronDown } from 'lucide-react';
import { ProtectedRoute } from '@/lib/auth/auth-client';
import PilotDocumentReview from '@/components/PilotDocumentReview';
import BusinessProfileForm from '@/components/business/BusinessProfileForm';
import PhotosAndVoice from '@/components/marketing/PhotosAndVoice';
import WorkspaceLayout from '@/layouts/WorkspaceLayout';
import { business_profile } from 'virtual:content';

/**
 * Business information: the one place for everything Pilot knows about the business.
 *   1. Start with your website (Pilot reads it and fills the form in)
 *   2. One Business profile form: basics, location, what you do, hours, brand (logo, colours), and optional extras folded away. Saving confirms it.
 *   3. Photos and voice
 *   4. Teach Pilot from a file or a message (folded away)
 */
function BusinessProfileContent() {
  return <WorkspaceLayout><main className="grid gap-lg">
    <header className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-base">
      <div><h1 className="text-3xl font-extrabold tracking-[-0.045em] text-secondary sm:text-4xl">Business information</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">What Pilot knows about your business. Check it, change anything, and confirm.</p></div>
      <Link to="/import" className="text-sm font-bold text-primary underline-offset-4 hover:underline">Import customers and jobs with Pilot →</Link>
    </header>

    <BusinessProfileForm />

    <section aria-labelledby="photos-voice-title" className="grid gap-base">
      <h2 id="photos-voice-title" className="text-xl font-extrabold text-secondary">Photos and voice</h2>
      <PhotosAndVoice />
    </section>

    <details className="group rounded-2xl border border-border bg-card shadow-sm">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-base py-4 text-base font-extrabold text-secondary sm:px-lg">
        <span>Teach Pilot from a file or a message <span className="block text-sm font-semibold text-muted-foreground">Price lists, menus, policies, spreadsheets, or something you just want Pilot to know.</span></span>
        <ChevronDown size={18} className="shrink-0 transition group-open:rotate-180" aria-hidden="true" /></summary>
      <div className="border-t border-border p-base sm:p-lg"><PilotDocumentReview /></div>
    </details>
  </main></WorkspaceLayout>;
}

export default function BusinessProfilePage() { return <><Helmet><title>{business_profile.seo.title}</title><meta name="description" content={business_profile.seo.description} /><meta name="robots" content="noindex, nofollow" /></Helmet><ProtectedRoute><BusinessProfileContent /></ProtectedRoute></>; }
