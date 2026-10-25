import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { CatalogListingLoading } from '@/app/(storefront)/[slug]/storefront-loading-ui';
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

async function loadIndexablePriceBandPage({
  params,
}: PriceBandPageRouteProps): Promise<{
  page: PriceBandPageModel;
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
    notFound();
  }

  return { page, resolvedParams };
}

export async function generateMetadata(
  props: PriceBandPageRouteProps
): Promise<Metadata> {
  const { page } = await loadIndexablePriceBandPage(props);

  return {
    title: { absolute: page.metaTitle },
    description: page.metaDescription,
    alternates: {
      canonical: page.canonicalUrl,
    },
    robots: getIndexableRobotsMetadata(),
  };
}

async function PriceBandPageRuntime({ params }: PriceBandPageRouteProps) {
  // Cache Components requires request-bound route params to stay behind
  // connection() so production can emit a stable static shell first.
  await connection();
  const { page, resolvedParams } = await loadIndexablePriceBandPage({ params });
  const pathPrefix = await getPriceBandStorefrontPathPrefix(
    resolvedParams.slug,
    page.merchant.slug
  );

  return <PriceBandPageContent page={{ ...page, pathPrefix }} />;
}

export default function PriceBandPage(props: PriceBandPageRouteProps) {
  return (
    <Suspense fallback={<CatalogListingLoading />}>
      <PriceBandPageRuntime {...props} />
    </Suspense>
  );
}
