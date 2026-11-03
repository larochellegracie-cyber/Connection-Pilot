import { Helmet } from '@dr.pogodin/react-helmet';
import { useNavigate } from 'react-router';
import { ProtectedRoute } from '@/lib/auth/auth-client';
import WorkspaceLayout from '@/layouts/WorkspaceLayout';
import MarketingWorkspace from '@/components/marketing/MarketingWorkspace';

/** Marketing: create, ideas, library and calendar. Everything about the business itself (website, logo, colours, hours, services, contact, photos) lives on Business information. */
export default function MarketingPage() {
  const navigate = useNavigate();
  return (
    <ProtectedRoute>
      <WorkspaceLayout>
        <Helmet>
          <title>Marketing — Connection Pilot</title>
          <meta name="description" content="Pilot Marketing: content ideas, posts, short videos and a content calendar built from what Pilot knows about your business." />
          <meta name="robots" content="noindex" />
        </Helmet>
        <MarketingWorkspace onGoToBusiness={() => navigate('/business-profile')} />
      </WorkspaceLayout>
    </ProtectedRoute>
  );
}
