import type { Route } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ComponentType } from 'react';
import { getMerchantByIdentifier } from '@/lib/cached-data';
import { toTemplateMerchantData } from '@/lib/merchant-template-data';
import { getStorefrontPathPrefix } from '@/lib/storefront-path-prefix';
import { getTemplate, type TemplatePageProps } from '@/templates/registry';
import { OgabasseyDeletionPolicy } from './ogabassey-deletion-policy';

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function DeleteAccountContent({ params }: PageProps) {
  const { slug } = await params;
  const merchant = await getMerchantByIdentifier(slug);

  if (!merchant) {
    notFound();
  }
  const isOgabassey = merchant.slug === 'ogabassey';
  const privacyHref = `${getStorefrontPathPrefix(await headers(), merchant)}/privacy`;

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
          <OgabasseyDeletionPolicy privacyHref={privacyHref as Route} />
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
