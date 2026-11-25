import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { CatalogListingLoading } from '@/app/(storefront)/[slug]/storefront-loading-ui';
import { getIndexableRobotsMetadata } from '@/lib/seo-utils';
import { buildStoreUrl } from '@/lib/store-url';
import {
  getPriceBandStorefrontPathPrefix,
  loadPriceBandPage,
} from '@/lib/storefront-compare/load-price-band-page';
import {
  getStorefrontOpenGraphImages,
  getStorefrontTwitterImages,
} from '@/lib/storefront-social-images';
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

  let baseUrl = page.merchant ? buildStoreUrl(page.merchant) : '';
  if (!baseUrl) {
    try {
      baseUrl = new URL(page.canonicalUrl).origin;
    } catch {
      baseUrl = '';
    }
  }

  const imageCandidates = [page.products?.[0]?.image, page.merchant?.logo_url];

  return {
    title: { absolute: page.metaTitle },
    description: page.metaDescription,
    alternates: {
      canonical: page.canonicalUrl,
    },
    robots: getIndexableRobotsMetadata(),
    openGraph: {
      title: page.metaTitle,
      description: page.metaDescription,
      url: page.canonicalUrl,
      type: 'website',
      siteName: page.merchant?.business_name,
      images: getStorefrontOpenGraphImages(
        baseUrl,
        page.metaTitle,
        ...imageCandidates
      ),
    },
    twitter: {
      card: 'summary_large_image',
      title: page.metaTitle,
      description: page.metaDescription,
      images: getStorefrontTwitterImages(baseUrl, ...imageCandidates),
    },
  };
}

async function PriceBandPageRuntime({ params }: PriceBandPageRouteProps) {
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
