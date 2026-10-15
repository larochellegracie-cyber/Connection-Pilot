import { RouteObject } from 'react-router';
import { lazy } from 'react';
import HomePage from './pages/index';
import SolutionsPage from './pages/solutions';
import HowItWorksPage from './pages/how-it-works';
import GetStartedPage from './pages/get-started';
import OnboardingPage from './pages/onboarding';
import WelcomePage from './pages/welcome';
import FeaturesPage from './pages/features';
import PricingPage from './pages/pricing';
import AboutPage from './pages/about';
import DashboardPage from './pages/dashboard';
import AssistantPage from './pages/assistant';
import AiReceptionistPage from './pages/ai-receptionist';
import { CustomerManagementPublicPage, FaqsPublicPage, HelpPublicPage, PilotPublicPage, ReceptionistPublicPage } from './pages/public-resources';
import CalendarPage from './pages/calendar';
import NotificationsPage from './pages/notifications';
import BusinessProfilePage from './pages/business-profile';
import BookingRulesPage from './pages/booking-rules';
import PhoneConnectionPage from './pages/phone-connection';
import ProfilePage from './pages/profile';
import SettingsPage from './pages/settings';
import HelpPage from './pages/help';
import MessagesPage from './pages/messages';
import CustomerProfilePage from './pages/customer-profile';
import CustomersPage from './pages/customers';
import LeadsPage from './pages/leads';
import JobsPage from './pages/jobs';
import FinancePage from './pages/finance';
import ConnectionsPage from './pages/connections';
import EmployeesPage from './pages/employees';
import SchedulingPage from './pages/scheduling';
import SubscriptionPage from './pages/subscription';
import MarketingPage from './pages/marketing';
import ContactPage from './pages/contact';
import AuthPage from './pages/auth/AuthPage';
import { ForgotPasswordPage, ResetPasswordPage } from './pages/auth/PasswordResetPage';
import CartPage from './pages/cart';
import CheckoutSuccess from './pages/checkout/success';
import CheckoutCancel from './pages/checkout/cancel';
// Eager import so renderToString doesn't hit a Suspense boundary on 404 routes
// and abort to client rendering. The prod 404 page is tiny; the dev-tools
// variant stays lazy because it pulls in dev-only code we don't want in
// production bundles.
import ProdNotFoundPage from './pages/_404';

const NotFoundPage = ProdNotFoundPage;

export const routes: RouteObject[] = [
  {
    path: '/',
    element: <HomePage />,
  },
  {
    path: '/solutions',
    element: <SolutionsPage />,
  },
  {
    path: '/how-it-works',
    element: <HowItWorksPage />,
  },
  {
    path: '/get-started',
    element: <GetStartedPage />,
  },
  {
    path: '/onboarding',
    element: <OnboardingPage />,
  },
  {
    path: '/welcome',
    element: <WelcomePage />,
  },
  {
    path: '/features',
    element: <FeaturesPage />,
  },
  {
    path: '/pricing',
    element: <PricingPage />,
  },
  {
    path: '/about',
    element: <AboutPage />,
  },
  {
    path: '/dashboard',
    element: <DashboardPage />,
  },
  {
    path: '/assistant',
    element: <AssistantPage />,
  },
  {
    path: '/calendar',
    element: <CalendarPage />,
  },
  {
    path: '/pilot',
    element: <PilotPublicPage />,
  },
  {
    path: '/ai-receptionist',
    element: <ReceptionistPublicPage />,
  },
  {
    path: '/customer-management',
    element: <CustomerManagementPublicPage />,
  },
  {
    path: '/faqs',
    element: <FaqsPublicPage />,
  },
  {
    path: '/dashboard/ai-receptionist',
    element: <AiReceptionistPage />,
  },
  {
    path: '/notifications',
    element: <NotificationsPage />,
  },
  {
    path: '/customers',
    element: <CustomersPage />,
  },
  {
    path: '/leads',
    element: <LeadsPage />,
  },
  {
    path: '/jobs',
    element: <JobsPage />,
  },
  {
    path: '/finance',
    element: <FinancePage />,
  },
  {
    path: '/connections',
    element: <ConnectionsPage />,
  },
  {
    path: '/employees',
    element: <EmployeesPage />,
  },
  {
    path: '/scheduling',
    element: <SchedulingPage />,
  },
  {
    path: '/subscription',
    element: <SubscriptionPage />,
  },
  {
    path: '/business-profile',
    element: <BusinessProfilePage />,
  },
  {
    path: '/dashboard/booking-rules',
    element: <BookingRulesPage />,
  },
  {
    path: '/phone-connection',
    element: <PhoneConnectionPage />,
  },
  {
    path: '/profile',
    element: <ProfilePage />,
  },
  {
    path: '/settings',
    element: <SettingsPage />,
  },
  {
    path: '/messages',
    element: <MessagesPage />,
  },
  {
    path: '/help',
    element: <HelpPublicPage />,
  },
  {
    path: '/dashboard/help',
    element: <HelpPage />,
  },
  {
    path: '/dashboard/customers/:customerId',
    element: <CustomerProfilePage />,
  },
  {
    path: '/cart',
    element: <CartPage />,
  },
  {
    path: '/checkout/success',
    element: <CheckoutSuccess />,
  },
  {
    path: '/checkout/cancel',
    element: <CheckoutCancel />,
  },
  {
    path: '/marketing',
    element: <MarketingPage />,
  },
  {
    path: '/contact',
    element: <ContactPage />,
  },
  {
    path: '/login',
    element: <AuthPage mode="login" />,
  },
  {
    path: '/signup',
    element: <AuthPage mode="signup" />,
  },
  {
    path: '/forgot-password',
    element: <ForgotPasswordPage />,
  },
  {
    path: '/reset-password',
    element: <ResetPasswordPage />,
  },
  {
    id: 'airo-not-found',
    path: '*',
    element: <NotFoundPage />,
  },
];

// Types for type-safe navigation
export type Path = '/' | '/how-it-works' | '/pilot' | '/ai-receptionist' | '/customer-management' | '/faqs' | '/help' | '/get-started' | '/onboarding' | '/welcome' | '/features' | '/pricing' | '/about' | '/business-profile' | '/phone-connection' | '/login' | '/calendar' | '/assistant';

export type Params = Record<string, string | undefined>;
