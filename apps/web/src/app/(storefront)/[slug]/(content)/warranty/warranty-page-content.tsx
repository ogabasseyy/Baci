import { notFound } from 'next/navigation';
import { JsonLd } from '@/components/seo/json-ld';
import { TrustPolicyPageClient } from '@/components/storefront/trust/trust-policy-page-client';
import { hasPublishableWarrantyPolicy } from '@/lib/storefront-trust/build-merchant-trust-profile';
import { getContactHref, getTrustRouteContext } from '../trust-route-context';

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function WarrantyPageContent({ params }: PageProps) {
  const { slug } = await params;
  const context = await getTrustRouteContext(slug, { requestScopedUrl: true });

  if (!context) {
    notFound();
  }

  if (!hasPublishableWarrantyPolicy(context.trustProfile)) {
    notFound();
  }

  const warrantyPolicy = context.trustProfile.warrantyPolicy;

  if (!warrantyPolicy) {
    notFound();
  }

  const canonicalUrl = `${context.baseUrl}/warranty`;
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: `Warranty Policy | ${context.merchant.business_name}`,
    url: canonicalUrl,
    description:
      warrantyPolicy.summary ||
      `Warranty policy for ${context.merchant.business_name}.`,
    isPartOf: {
      '@type': 'WebSite',
      name: context.merchant.business_name,
      url: context.baseUrl,
    },
    publisher: {
      '@type': 'Organization',
      name: context.merchant.business_name,
      url: context.baseUrl,
      ...(context.merchant.logo_url && { logo: context.merchant.logo_url }),
    },
    inLanguage: 'en',
    ...(context.merchant.updated_at
      ? { dateModified: context.merchant.updated_at }
      : {}),
  };

  return (
    <>
      <JsonLd data={jsonLd} />
      <TrustPolicyPageClient
        kind="warranty"
        ogabasseyCare={context.merchant.slug === 'ogabassey'}
        merchantName={context.merchant.business_name}
        contactHref={getContactHref(context.merchant, context.baseUrl)}
        trustProfile={context.trustProfile}
      />
    </>
  );
}
