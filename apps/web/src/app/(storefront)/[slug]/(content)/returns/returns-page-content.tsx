import { notFound } from 'next/navigation';
import type { WebPage, WithContext } from 'schema-dts';
import { JsonLd } from '@/components/seo/json-ld';
import { TrustPolicyPageClient } from '@/components/storefront/trust/trust-policy-page-client';
import { getContactHref, getTrustRouteContext } from '../trust-route-context';

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function ReturnsPageContent({ params }: PageProps) {
  const { slug } = await params;
  const context = await getTrustRouteContext(slug, { requestScopedUrl: true });

  if (!context) {
    notFound();
  }

  const returnPolicy = context.trustProfile.returnPolicy;

  const canonicalUrl = `${context.baseUrl}/returns`;
  const jsonLd: WithContext<WebPage> = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: `Returns Policy | ${context.merchant.business_name}`,
    url: canonicalUrl,
    description:
      returnPolicy?.summary ||
      `Returns policy for ${context.merchant.business_name}.`,
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
        kind="returns"
        ogabasseyCare={context.merchant.slug === 'ogabassey'}
        merchantName={context.merchant.business_name}
        contactHref={getContactHref(context.merchant, context.baseUrl)}
        trustProfile={context.trustProfile}
      />
    </>
  );
}
