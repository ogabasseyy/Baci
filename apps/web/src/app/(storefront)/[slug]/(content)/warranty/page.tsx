import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { ContentRouteLoading } from '@/app/(storefront)/[slug]/storefront-loading-ui';
import {
  generateMetaDescription,
  getIndexableRobotsMetadata,
} from '@/lib/seo-utils';
import { hasPublishableWarrantyPolicy } from '@/lib/storefront-trust/build-merchant-trust-profile';
import { getTrustRouteContext } from '../trust-route-context';
import { WarrantyPageContent } from './warranty-page-content';

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const context = await getTrustRouteContext(slug);

  if (!context) {
    return { title: 'Warranty Policy' };
  }

  if (!hasPublishableWarrantyPolicy(context.trustProfile)) {
    notFound();
  }

  const warrantyPolicy = context.trustProfile.warrantyPolicy;

  if (!warrantyPolicy) {
    notFound();
  }

  const canonicalUrl = `${context.baseUrl}/warranty`;
  const description = generateMetaDescription(
    warrantyPolicy.summary
      ? `${warrantyPolicy.summary} Warranty policy for ${context.merchant.business_name}.`
      : `Warranty policy for ${context.merchant.business_name}.`
  );

  return {
    title: { absolute: `Warranty Policy | ${context.merchant.business_name}` },
    description,
    alternates: {
      canonical: canonicalUrl,
    },
    twitter: {
      card: 'summary',
      title: `Warranty Policy | ${context.merchant.business_name}`,
      description: description,
    },
    openGraph: {
      title: `Warranty Policy | ${context.merchant.business_name}`,
      description,
      type: 'website',
      url: canonicalUrl,
      ...(context.merchant.logo_url && {
        images: [{ url: context.merchant.logo_url }],
      }),
    },
    robots: getIndexableRobotsMetadata(),
  };
}

export default function WarrantyPage({ params }: PageProps) {
  return (
    <Suspense fallback={<ContentRouteLoading />}>
      <WarrantyPageContent params={params} />
    </Suspense>
  );
}
