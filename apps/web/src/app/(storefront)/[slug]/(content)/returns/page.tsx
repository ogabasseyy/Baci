import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ContentRouteLoading } from '@/app/(storefront)/[slug]/storefront-loading-ui';
import {
  generateMetaDescription,
  getIndexableRobotsMetadata,
} from '@/lib/seo-utils';
import { getTrustRouteContext } from '../trust-route-context';
import { ReturnsPageContent } from './returns-page-content';

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const context = await getTrustRouteContext(slug);

  if (!context) {
    return { title: 'Returns Policy' };
  }

  const returnPolicy = context.trustProfile.returnPolicy;

  const canonicalUrl = `${context.baseUrl}/returns`;
  const description = generateMetaDescription(
    returnPolicy?.summary
      ? `${returnPolicy.summary} Returns policy for ${context.merchant.business_name}.`
      : `Returns policy for ${context.merchant.business_name}.`
  );

  return {
    title: `Returns Policy | ${context.merchant.business_name}`,
    description,
    alternates: {
      canonical: canonicalUrl,
    },
    openGraph: {
      title: `Returns Policy | ${context.merchant.business_name}`,
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

export default function ReturnsPage({ params }: PageProps) {
  return (
    <Suspense fallback={<ContentRouteLoading />}>
      <ReturnsPageContent params={params} />
    </Suspense>
  );
}
