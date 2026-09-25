import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { type ComponentType, Suspense } from 'react';
import { JsonLd } from '@/components/seo/json-ld';
import { getMerchantByIdentifier } from '@/lib/cached-data';
import { toTemplateMerchantData } from '@/lib/merchant-template-data';
import { getTemplate, type TemplatePageProps } from '@/templates/registry';

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const merchant = await getMerchantByIdentifier(slug);

  if (!merchant) {
    return { title: 'Delete Account' };
  }

  return {
    title: `Delete Account | ${merchant.business_name}`,
    description: `Request deletion of your ${merchant.business_name} account and associated data.`,
    robots: {
      index: false,
      follow: false,
    },
    openGraph: {
      title: `Delete Account | ${merchant.business_name}`,
      description: `Request deletion of your ${merchant.business_name} account.`,
      type: 'website',
      ...(merchant.logo_url && { images: [{ url: merchant.logo_url }] }),
    },
  };
}

/** Streams JSON-LD separately while the visible page content loads. */
export default function StorefrontDeleteAccountPage({ params }: PageProps) {
  return (
    <>
      <Suspense fallback={null}>
        <DeleteAccountJsonLd params={params} />
      </Suspense>
      <DeleteAccountContent params={params} />
    </>
  );
}

/** Streams JSON-LD structured data independently of page content. */
async function DeleteAccountJsonLd({ params }: PageProps) {
  const { slug } = await params;
  const merchant = await getMerchantByIdentifier(slug);

  if (!merchant) return null;

  const isDevelopment = process.env.NODE_ENV === 'development';
  const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN || 'usebaci.com';
  const baseUrl = isDevelopment
    ? `http://localhost:3000/${merchant.slug}`
    : `https://${merchant.slug}.${rootDomain}`;

  const pageSchema = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: `Delete Account | ${merchant.business_name}`,
    url: `${baseUrl}/delete-account`,
    description: `Request deletion of your ${merchant.business_name} account.`,
    isPartOf: {
      '@type': 'WebSite',
      name: merchant.business_name,
      url: baseUrl,
    },
    publisher: {
      '@type': 'Organization',
      name: merchant.business_name,
      url: baseUrl,
      ...(merchant.logo_url && { logo: merchant.logo_url }),
    },
  };

  return <JsonLd data={pageSchema} />;
}

export async function DeleteAccountContent({ params }: PageProps) {
  const { slug } = await params;
  const merchant = await getMerchantByIdentifier(slug);

  if (!merchant) {
    notFound();
  }
  const isOgabassey = merchant.slug === 'ogabassey';
  const privacyHref =
    process.env.NODE_ENV === 'development'
      ? `/${merchant.slug}/privacy`
      : '/privacy';

  // Resolve template component server-side for SEO (H1 in SSR HTML)
  const templateId = merchant.template_id;
  let DeleteAccountComponent: ComponentType<TemplatePageProps> | null = null;
  if (templateId && templateId !== 'default' && templateId !== 'puck') {
    const template = getTemplate(templateId);
    if (template) {
      // try/catch only guards the async component load; the JSX itself is
      // constructed outside so render errors flow to the route error boundary.
      try {
        const components = await template.getComponents();
        DeleteAccountComponent = components.DeleteAccount ?? null;
      } catch (error) {
        console.error(
          'Failed to load DeleteAccount component for template',
          templateId,
          ':',
          error
        );
      }
    }
  }

  if (DeleteAccountComponent) {
    return (
      <DeleteAccountComponent
        merchant={toTemplateMerchantData(merchant)}
        storeSlug={merchant.slug}
        isPreview={false}
      />
    );
  }

  // Fallback: inline content
  return (
    <div className="max-w-3xl mx-auto px-4 py-12 sm:py-16">
      {/* Header */}
      <div className="text-center mb-12">
        <h1 className="text-3xl font-bold text-gray-900 mb-4">
          Delete Your Account
        </h1>
        <p className="text-gray-600 text-lg">
          We&apos;re sorry to see you go. This page explains how to request
          deletion of your account with {merchant.business_name} and what
          happens to your data.
        </p>
      </div>

      {/* Steps Section */}
      <section className="mb-12">
        <h2 className="text-xl font-semibold text-gray-900 mb-6">
          How to Request Account Deletion
        </h2>
        <div className="space-y-6">
          <div className="flex gap-4">
            <div className="shrink-0 size-8 rounded-full flex items-center justify-center font-semibold text-white bg-slate-900">
              1
            </div>
            <div>
              <h3 className="font-medium text-gray-900">
                Log into Your Account
              </h3>
              <p className="text-gray-600 mt-1">
                Visit{' '}
                <Link href="/" className="text-primary underline font-medium">
                  {merchant.business_name}
                </Link>{' '}
                and sign in to your account.
              </p>
            </div>
          </div>

          <div className="flex gap-4">
            <div className="shrink-0 size-8 rounded-full flex items-center justify-center font-semibold text-white bg-slate-900">
              2
            </div>
            <div>
              <h3 className="font-medium text-gray-900">
                Navigate to Account Settings
              </h3>
              <p className="text-gray-600 mt-1">
                Go to <strong>My Account</strong> &rarr;{' '}
                <strong>Settings</strong>.
              </p>
            </div>
          </div>

          <div className="flex gap-4">
            <div className="shrink-0 size-8 rounded-full flex items-center justify-center font-semibold text-white bg-slate-900">
              3
            </div>
            <div>
              <h3 className="font-medium text-gray-900">
                Request Account Deletion
              </h3>
              <p className="text-gray-600 mt-1">
                Find the &ldquo;Delete Account&rdquo; option and confirm your
                request.
              </p>
            </div>
          </div>

          <div className="flex gap-4">
            <div className="shrink-0 size-8 rounded-full flex items-center justify-center font-semibold text-white bg-slate-900">
              4
            </div>
            <div>
              <h3 className="font-medium text-gray-900">
                Alternative: Email Us
              </h3>
              <p className="text-gray-600 mt-1">
                If you cannot access your account, email us at{' '}
                <a
                  href={`mailto:${merchant.email}`}
                  className="text-primary underline"
                >
                  {merchant.email}
                </a>{' '}
                with your registered email address and we will process your
                request.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Data Deletion Section */}
      <section className="mb-12">
        <h2 className="text-xl font-semibold text-gray-900 mb-6">
          What Data is Deleted
        </h2>
        {isOgabassey ? (
          <div className="bg-gray-50 rounded-lg p-6 space-y-4 text-gray-600">
            <p>
              After a verified request, we remove account profile details, saved
              addresses, wishlist items, and cart contents when they are no
              longer needed. Personal data without a longer legal basis is
              deleted or de-identified no later than six calendar months after
              its purpose ends.
            </p>
            <p>
              Tax-relevant accounting and transaction records must be kept for
              at least six years after the relevant year of assessment under
              section 31(5) of the Nigeria Tax Administration Act, 2025. We
              restrict access to records retained for legal purposes. See our{' '}
              <Link href={privacyHref} className="text-primary underline">
                Privacy Policy
              </Link>{' '}
              for details and contact us if you need a copy of your data.
            </p>
          </div>
        ) : (
          <div className="bg-gray-50 rounded-lg p-6">
            <h3 className="font-medium text-gray-900 mb-3">
              Immediately Deleted:
            </h3>
            <ul className="list-disc list-inside text-gray-600 space-y-2 mb-6">
              <li>Your profile information (name, email, phone number)</li>
              <li>Saved addresses</li>
              <li>Wishlist items</li>
              <li>Shopping cart contents</li>
            </ul>

            <h3 className="font-medium text-gray-900 mb-3">
              Retained for Legal/Business Purposes (90 days):
            </h3>
            <ul className="list-disc list-inside text-gray-600 space-y-2 mb-6">
              <li>
                Order history (for refunds, disputes, and warranty claims)
              </li>
              <li>Transaction records (legal/tax compliance)</li>
            </ul>

            <h3 className="font-medium text-gray-900 mb-3">
              Permanently Retained (Anonymized):
            </h3>
            <ul className="list-disc list-inside text-gray-600 space-y-2">
              <li>
                Aggregated analytics data (e.g., total orders, no personal
                identifiers)
              </li>
            </ul>
          </div>
        )}
      </section>

      {/* Contact Section */}
      <section className="text-center border-t pt-8">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">Questions?</h2>
        <p className="text-gray-600">
          Contact our support team at{' '}
          <a
            href={`mailto:${merchant.email}`}
            className="text-primary underline"
          >
            {merchant.email}
          </a>
        </p>
      </section>
    </div>
  );
}
