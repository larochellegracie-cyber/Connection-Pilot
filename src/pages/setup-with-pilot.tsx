import { useState } from 'react';
import { Helmet } from '@dr.pogodin/react-helmet';
import { useNavigate, useSearchParams } from 'react-router';
import { Sparkles } from 'lucide-react';
import { ProtectedRoute } from '@/lib/auth/auth-client';
import PilotAvatar from '@/components/PilotAvatar';
import PilotImport from '@/components/PilotImport';

function SetupContent() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  // Arriving from the setup questions with files to bring in goes straight to the import.
  const arrivedWithAnswers = params.get('import') === '1';
  const [importing, setImporting] = useState(arrivedWithAnswers);
  const toDashboard = () => navigate('/dashboard', { replace: true });
  return <main className="min-h-screen bg-[hsl(var(--canvas))] px-5 py-10"><div className="mx-auto grid max-w-3xl gap-5">
    <section className="cp-hero px-6 py-7 text-center sm:px-10">
      <div className="mb-3 flex justify-center"><PilotAvatar size="lg" state="idle" /></div>
      <h1 className="text-3xl font-extrabold tracking-[-0.04em] text-white">{arrivedWithAnswers ? 'Let’s organize your information' : 'Welcome to Connection Pilot 👋'}</h1>
      <p className="mt-2 text-lg font-bold text-white">{arrivedWithAnswers ? 'Upload what you have and Pilot will sort it out.' : 'Let’s get your business set up.'}</p>
      <p className="mx-auto mt-2 max-w-xl text-sm text-[#C9D8F5]">You can upload the business information you already have and Pilot will organize it for you. You review everything before anything is added.</p>
      {!importing && <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
        <button type="button" onClick={() => setImporting(true)} className="inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-bold text-primary-foreground shadow-sm hover:brightness-110"><Sparkles size={16} aria-hidden="true" />Let Pilot set up my business</button>
        <button type="button" onClick={toDashboard} className="rounded-xl border border-white/25 px-6 py-3 text-sm font-bold text-white hover:bg-white/10">I’ll set it up myself</button>
      </div>}
    </section>
    {importing && <PilotImport onFinished={toDashboard} onCancel={() => setImporting(false)} />}
    {importing && <p className="text-center text-sm"><button type="button" onClick={toDashboard} className="font-bold text-primary underline">Skip for now and go to my dashboard</button></p>}
  </div></main>;
}

export default function SetupWithPilotPage() {
  return <><Helmet><title>Set up with Pilot</title><meta name="robots" content="noindex, nofollow" /></Helmet><ProtectedRoute><SetupContent /></ProtectedRoute></>;
}
