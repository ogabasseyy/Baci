import { notFound } from 'next/navigation';
import { JsonLd } from '@/components/seo/json-ld';
import { TrustPolicyPageClient } from '@/components/storefront/trust/trust-policy-page-client';
import { getContactHref, getTrustRouteContext } from '../trust-route-context';

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function ShippingPageContent({ params }: PageProps) {
  const { slug } = await params;
  const context = await getTrustRouteContext(slug);

  if (!context) {
    notFound();
  }

  const shippingPolicy = context.trustProfile.shippingPolicy;

  const canonicalUrl = `${context.baseUrl}/shipping`;
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: `Shipping Policy | ${context.merchant.business_name}`,
    url: canonicalUrl,
    description:
      shippingPolicy?.summary ||
      `Shipping policy for ${context.merchant.business_name}.`,
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
        kind="shipping"
        merchantName={context.merchant.business_name}
        contactHref={getContactHref(context.merchant, context.baseUrl)}
        trustProfile={context.trustProfile}
      />
    </>
  );
}
