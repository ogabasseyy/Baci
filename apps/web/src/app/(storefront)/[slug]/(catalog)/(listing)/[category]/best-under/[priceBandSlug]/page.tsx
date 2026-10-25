import type { Metadata } from 'next';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { CatalogListingLoading } from '@/app/(storefront)/[slug]/storefront-loading-ui';
import { StorefrontRouteNotFoundContent } from '@/app/(storefront)/[slug]/storefront-route-not-found-content';
import { getIndexableRobotsMetadata } from '@/lib/seo-utils';
import {
  getPriceBandStorefrontPathPrefix,
  loadPriceBandPage,
} from '@/lib/storefront-compare/load-price-band-page';
import { PriceBandPageContent } from './price-band-page-content';

interface PriceBandPageRouteProps {
  params: Promise<{
    slug: string;
    category: string;
    priceBandSlug: string;
  }>;
}

type PriceBandPageModel = NonNullable<
  Awaited<ReturnType<typeof loadPriceBandPage>>
>;
type ResolvedPriceBandParams = Awaited<PriceBandPageRouteProps['params']>;

const PRICE_BAND_NOT_FOUND_METADATA: Metadata = {
  title: 'Price Band Guide Not Found',
  description: 'This price band guide is unavailable.',
  robots: { index: false, follow: true },
  alternates: null,
  openGraph: undefined,
  twitter: undefined,
};

async function loadIndexablePriceBandPage({
  params,
}: PriceBandPageRouteProps): Promise<{
  page: PriceBandPageModel | null;
  resolvedParams: ResolvedPriceBandParams;
}> {
  const resolvedParams = await params;
  const page = await loadPriceBandPage(
    {
      merchantSlug: resolvedParams.slug,
      categorySlug: resolvedParams.category,
      priceBandSlug: resolvedParams.priceBandSlug,
    },
    { includeRequestPathPrefix: false }
  );

  if (!page?.isIndexable) {
    return { page: null, resolvedParams };
  }

  return { page, resolvedParams };
}

export async function generateMetadata(
  props: PriceBandPageRouteProps
): Promise<Metadata> {
  const { page } = await loadIndexablePriceBandPage(props);

  if (!page) {
    return PRICE_BAND_NOT_FOUND_METADATA;
  }

  return {
    title: { absolute: page.metaTitle },
    description: page.metaDescription,
    alternates: {
      canonical: page.canonicalUrl,
    },
    robots: getIndexableRobotsMetadata(),
  };
}

export async function PriceBandPageRuntime({
  params,
}: PriceBandPageRouteProps) {
  // Cache Components requires request-bound route params to stay behind
  // connection() so production can emit a stable static shell first.
  await connection();
  const { page, resolvedParams } = await loadIndexablePriceBandPage({ params });
  const pathPrefix = await getPriceBandStorefrontPathPrefix(
    resolvedParams.slug,
    page?.merchant.slug ?? resolvedParams.slug
  );

  if (!page) {
    return (
      <StorefrontRouteNotFoundContent
        backHref={pathPrefix || '/'}
        message="This price band guide is unavailable or has moved."
        title="Price band guide not found"
      />
    );
  }

  return <PriceBandPageContent page={{ ...page, pathPrefix }} />;
}

export default function PriceBandPage(props: PriceBandPageRouteProps) {
  return (
    <Suspense fallback={<CatalogListingLoading />}>
      <PriceBandPageRuntime {...props} />
    </Suspense>
  );
}
