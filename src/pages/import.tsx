import { Helmet } from '@dr.pogodin/react-helmet';
import { useNavigate } from 'react-router';
import { Sparkles } from 'lucide-react';
import { ProtectedRoute } from '@/lib/auth/auth-client';
import WorkspaceLayout from '@/layouts/WorkspaceLayout';
import PilotImport from '@/components/PilotImport';

function ImportContent() {
  const navigate = useNavigate();
  return <WorkspaceLayout><main className="grid gap-4">
    <section className="cp-hero px-6 py-5"><p className="cp-eyebrow">Import with Pilot</p><h1 className="mt-1 flex items-center gap-2 text-2xl font-extrabold tracking-[-0.04em] text-white sm:text-[1.75rem]"><Sparkles size={22} aria-hidden="true" />Let Pilot set up your business</h1><p className="mt-1 text-sm text-[#C9D8F5]">Upload the customers, invoices, jobs, employees or price lists you already have. Pilot organizes them and you review everything before it is added.</p></section>
    <PilotImport onFinished={() => navigate('/dashboard')} finishLabel="Go to Home" onCancel={() => navigate('/business-profile')} />
  </main></WorkspaceLayout>;
}

export default function ImportPage() {
  return <><Helmet><title>Import with Pilot</title><meta name="description" content="Upload your existing business information and let Pilot organize it." /><meta name="robots" content="noindex, nofollow" /></Helmet><ProtectedRoute><ImportContent /></ProtectedRoute></>;
}
