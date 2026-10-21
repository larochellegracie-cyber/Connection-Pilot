import { Helmet } from '@dr.pogodin/react-helmet';
import { type ReactElement } from 'react';
import { ScrollRestoration, useLocation } from 'react-router';

import HomepageSameAsJsonLd from '@/components/HomepageSameAsJsonLd';
import PilotChatWidget from '@/components/PilotChatWidget';
import Footer from '@/layouts/parts/Footer';
import Header from '@/layouts/parts/Header';
import Website from '@/layouts/Website';
import WorkspaceLayout from '@/layouts/WorkspaceLayout';
import { CartProvider } from '@/contexts/cart-context';

/**
 * Root layout component that wraps all pages with consistent header and footer.
 *
 * To customize the header or footer, directly edit the Header.tsx and Footer.tsx
 * files in the layouts/parts directory.
 *
 * Site-wide <title> and <meta> live in the <Helmet> below. Individual pages can
 * override them by rendering their own <Helmet> — last-mounted wins.
 */
interface RootLayoutProps {
  children: ReactElement;
}

export default function RootLayout({ children }: RootLayoutProps) {
  const location = useLocation();
  // Keep all authenticated operations routes out of the public-site chrome.
  // Most render WorkspaceLayout themselves; Phone connection is the one route
  // that receives it here. The shared predicate also owns the global Pilot chat.
  const isWorkspaceRoute = location.pathname.startsWith('/dashboard') || [
    '/assistant',
    '/business-profile',
    '/calendar',
    '/customers',
    '/finance',
    '/insights',
    '/jobs',
    '/leads',
    '/messages',
    '/notifications',
    '/phone-connection',
    '/profile',
    '/scheduling',
    '/settings',
    '/subscription',
  ].includes(location.pathname);
  const isOnboardingRoute = location.pathname === '/onboarding';
  const needsWorkspaceShell = location.pathname === '/phone-connection';

  return (
    <CartProvider>
      <Website>
        <Helmet>
          <title>Connection Pilot | AI Business Operating Platform</title>
          <meta name="description" content="Connection Pilot brings your customers, sales, jobs, scheduling, finances, and business tools together so you know what to do next." />
        </Helmet>
        <HomepageSameAsJsonLd />
        <ScrollRestoration />
        {!isWorkspaceRoute && !isOnboardingRoute && <Header />}
        {needsWorkspaceShell ? <WorkspaceLayout>{children}</WorkspaceLayout> : children}
        {!isWorkspaceRoute && !isOnboardingRoute && <Footer />}
        {isWorkspaceRoute && <PilotChatWidget />}
      </Website>
    </CartProvider>
  );
}
