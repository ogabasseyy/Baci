import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { CatalogListingLoading } from '@/app/(storefront)/[slug]/storefront-loading-ui';
import { getIndexableRobotsMetadata } from '@/lib/seo-utils';
import { buildStoreUrl } from '@/lib/store-url';
import {
  buildStorefrontPageHref,
  parseStorefrontPageParam,
} from '@/lib/storefront-pagination';
import { CategoryPageContent } from '../../category-page-content';
import { GamingGraphicsHubIntro } from './gaming-graphics-hub-intro';
import { loadGamingGraphicsHub } from './load-gaming-graphics-hub';

interface GamingGraphicsHubPageProps {
  params: Promise<{
    category: string;
    graphicsSlug: string;
    slug: string;
  }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

async function loadPage(props: GamingGraphicsHubPageProps) {
  const [params, searchParams] = await Promise.all([
    props.params,
    props.searchParams,
  ]);
  const currentPage = parseStorefrontPageParam(searchParams.page);
  if (!currentPage) notFound();

  const page = await loadGamingGraphicsHub({
    categorySlug: params.category,
    currentPage,
    graphicsSlug: params.graphicsSlug,
    merchantSlug: params.slug,
  });
  if (!page) notFound();

  return { page, params };
}

export async function generateMetadata(
  props: GamingGraphicsHubPageProps
): Promise<Metadata> {
  const { page } = await loadPage(props);
  const pagePrefix = page.currentPage > 1 ? `Page ${page.currentPage} | ` : '';
  const title = `${pagePrefix}${page.hub.label} Gaming Laptops Price in ${page.countryName} | ${page.merchant.business_name}`;
  const description = `Compare ${page.productCount} ${page.hub.label} gaming laptops at ${page.merchant.business_name}. Check prices, RAM, storage, processors, displays, condition and current availability in ${page.countryName}.`;

  return {
    title: { absolute: title },
    description,
    alternates: {
      canonical: buildStorefrontPageHref(
        page.canonicalBaseUrl,
        page.currentPage
      ),
    },
    robots: getIndexableRobotsMetadata(),
  };
}

export async function GamingGraphicsHubRuntime(
  props: GamingGraphicsHubPageProps
) {
  await connection();
  const { page, params } = await loadPage(props);
  const storeUrl = buildStoreUrl(page.merchant);

  return (
    <>
      <GamingGraphicsHubIntro
        availableHubs={page.availableHubs}
        categorySlug={params.category}
        countryName={page.countryName}
        currentHub={page.hub}
        merchantName={page.merchant.business_name}
        productCount={page.productCount}
        storeUrl={storeUrl}
      />
      <CategoryPageContent
        canonicalBaseUrl={page.canonicalBaseUrl}
        params={Promise.resolve({
          category: params.category,
          slug: params.slug,
        })}
        searchParams={Promise.resolve({
          graphics: page.matchingGraphics,
          page: String(page.currentPage),
        })}
        seoPageName={`${page.hub.label} Gaming Laptops`}
        titleHeading="h2"
        trustedGraphics
      />
    </>
  );
}

export default function GamingGraphicsHubPage(
  props: GamingGraphicsHubPageProps
) {
  return (
    <Suspense fallback={<CatalogListingLoading />}>
      <GamingGraphicsHubRuntime {...props} />
    </Suspense>
  );
}
