import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { ContentRouteLoading } from '@/app/(storefront)/[slug]/storefront-loading-ui';
import { getMerchantByIdentifier } from '@/lib/cached-data';
import { hasPublishableFaqContent } from '@/lib/has-publishable-faq-content';
import { getIndexableRobotsMetadata } from '@/lib/seo-utils';
import { buildStoreUrl } from '@/lib/store-url';
import { FAQContent } from './faq-content';
import { FAQJsonLd } from './faq-json-ld';

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const merchant = await getMerchantByIdentifier(slug);

  if (!merchant) {
    notFound();
  }

  const canonicalUrl = `${buildStoreUrl(merchant)}/faq`;

  return {
    title: 'FAQ',
    description: `Frequently asked questions about ${merchant.business_name}.`,
    twitter: {
      card: 'summary',
      title: `FAQ | ${merchant.business_name}`,
      description: `Frequently asked questions about ${merchant.business_name}.`,
    },
    openGraph: {
      title: `FAQ | ${merchant.business_name}`,
      description: `Find answers to common questions about ${merchant.business_name}.`,
      type: 'website',
      url: canonicalUrl,
      ...(merchant.logo_url && { images: [{ url: merchant.logo_url }] }),
    },
    alternates: {
      canonical: canonicalUrl,
    },
    robots: hasPublishableFaqContent(merchant)
      ? getIndexableRobotsMetadata()
      : { index: false, follow: true },
  };
}

/** Streams FAQ JSON-LD separately while the visible page content loads. */
export default function FAQPage({ params }: PageProps) {
  return (
    <>
      <Suspense fallback={null}>
        <FAQJsonLd params={params} />
      </Suspense>
      <Suspense fallback={<ContentRouteLoading />}>
        <FAQContent params={params} />
      </Suspense>
    </>
  );
}
