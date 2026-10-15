/**
 * Checkout Cancel Page
 *
 * Displayed when user cancels Stripe checkout.
 * No payment was made.
 *
 * URL: /checkout/cancel
 */
import { Helmet } from '@dr.pogodin/react-helmet';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
const siteUrl = 'https://connectionpilot.net';
const cancelTitle = 'Checkout Canceled | Connection Pilot';
const cancelDescription = 'Your Connection Pilot checkout was canceled. You can return to pricing whenever you are ready.';
const ogImage = `${siteUrl}/airo-assets/images/pages/home/customer-service-team`;
const cancelJsonLd = { '@context': 'https://schema.org', '@type': 'WebPage', '@id': `${siteUrl}/checkout/cancel#webpage`, name: cancelTitle, url: `${siteUrl}/checkout/cancel`, isPartOf: { '@id': `${siteUrl}/#website` }, about: { '@id': `${siteUrl}/#organization` } };

export default function CheckoutCancel() {
  const { t } = useTranslation();
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4"><Helmet><title>{cancelTitle}</title><meta name="description" content={cancelDescription} /><link rel="canonical" href={`${siteUrl}/checkout/cancel`} /><meta property="og:title" content={cancelTitle} /><meta property="og:description" content={cancelDescription} /><meta property="og:image" content={ogImage} /><meta property="og:url" content={`${siteUrl}/checkout/cancel`} /><meta property="og:type" content="website" /><meta name="twitter:card" content="summary_large_image" /><meta name="twitter:image" content={ogImage} /><script type="application/ld+json">{JSON.stringify(cancelJsonLd).replace(/</g, '\\u003c')}</script></Helmet>
      <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center">
        {/* Cancel Icon */}
        <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-6">
          <svg
            className="w-8 h-8 text-gray-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </div>

        <h1 className="text-2xl font-bold text-gray-900 mb-2">{t('stripe.payment_cancelled_title')}</h1>

        <p className="text-gray-600 mb-6">
          {t('stripe.payment_cancelled_message')}
        </p>

        <div className="space-y-3">
          <Link
            to="/pricing"
            className="block w-full bg-blue-600 text-white py-3 px-4 rounded-lg font-medium hover:bg-blue-700 transition-colors"
          >
            {t('stripe.btn_continue_shopping')}
          </Link>

          <Link
            to="/pricing"
            className="block w-full bg-gray-100 text-gray-700 py-3 px-4 rounded-lg font-medium hover:bg-gray-200 transition-colors"
          >
            {t('stripe.btn_go_home')}
          </Link>
        </div>

        <p className="mt-6 text-sm text-gray-500">
          {t('stripe.need_help_text')}{' '}
          <a href="mailto:support@example.com" className="text-blue-600 hover:underline">
            {t('stripe.contact_support_link')}
          </a>
        </p>
      </div>
    </div>
  );
}

