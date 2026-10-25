import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { CatalogListingLoading } from '@/app/(storefront)/[slug]/storefront-loading-ui';
import { StorefrontRouteNotFoundContent } from '@/app/(storefront)/[slug]/storefront-route-not-found-content';
import { getIndexableRobotsMetadata } from '@/lib/seo-utils';
import { buildStoreUrl } from '@/lib/store-url';
import {
  buildStorefrontPageHref,
  parseStorefrontPageParam,
} from '@/lib/storefront-pagination';
import { getStorefrontPathPrefix } from '@/lib/storefront-path-prefix';
import { isDomainIdentifier } from '@/lib/validation';
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

const GRAPHICS_HUB_NOT_FOUND_METADATA: Metadata = {
  title: 'Graphics Hub Not Found',
  description: 'This graphics hub is unavailable.',
  robots: { index: false, follow: true },
  alternates: null,
  openGraph: undefined,
  twitter: undefined,
};

async function loadPage(props: GamingGraphicsHubPageProps) {
  const [params, searchParams] = await Promise.all([
    props.params,
    props.searchParams,
  ]);
  const currentPage = parseStorefrontPageParam(searchParams.page);
  if (!currentPage) return { page: null, params, searchParams };

  const page = await loadGamingGraphicsHub({
    categorySlug: params.category,
    currentPage,
    graphicsSlug: params.graphicsSlug,
    merchantSlug: params.slug,
  });
  if (!page) return { page: null, params, searchParams };

  return { page, params, searchParams };
}

export async function generateMetadata(
  props: GamingGraphicsHubPageProps
): Promise<Metadata> {
  const { page, searchParams } = await loadPage(props);

  if (
    !page?.hub ||
    ('isIndexable' in page && !page.isIndexable) ||
    ('isIndexable' in page.hub && !page.hub.isIndexable)
  ) {
    return GRAPHICS_HUB_NOT_FOUND_METADATA;
  }

  const pagePrefix = page.currentPage > 1 ? `Page ${page.currentPage} | ` : '';
  const title = `${pagePrefix}${page.hub.label} Gaming Laptops Price in ${page.countryName} | ${page.merchant.business_name}`;
  const description = `Compare ${page.productCount} ${page.hub.label} gaming laptops at ${page.merchant.business_name}. Check prices, RAM, storage, processors, displays, condition and current availability in ${page.countryName}.`;
  // The hub loader ignores query filters: hub graphics arrive via the path
  // slug, so any graphics selection renders a duplicate of the canonical hub
  // URL and must be noindexed. Only `page` is hub-owned (pagination
  // canonicalizes it). A hub token is minted for listing transitions, never
  // for hub URLs, so its presence also marks a duplicate.
  const { page: _hubPage, ...hubFilters } = searchParams;
  const hubToken = searchParams.graphicsHub;
  const hasHubToken =
    (typeof hubToken === 'string' && hubToken.trim() !== '') ||
    (Array.isArray(hubToken) && hubToken.some((entry) => entry.trim() !== ''));
  const baseRobots = getIndexableRobotsMetadata(hubFilters);
  const baseRobotsObject =
    baseRobots != null && typeof baseRobots === 'object' ? baseRobots : null;
  const baseIndex = baseRobotsObject != null && baseRobotsObject.index === true;
  const baseGoogleBot =
    baseRobotsObject != null && typeof baseRobotsObject.googleBot === 'object'
      ? baseRobotsObject.googleBot
      : {};
  // Unpublished stores render the unpublished screen from the layout, so the
  // hub must never be indexable even when inventory resolves.
  const indexable =
    baseIndex && !hasHubToken && page.merchant.is_published === true;

  return {
    title: { absolute: title },
    description,
    alternates: {
      canonical: buildStorefrontPageHref(
        page.canonicalBaseUrl,
        page.currentPage
      ),
    },
    robots: {
      ...(baseRobotsObject ?? {}),
      index: indexable,
      follow: true,
      googleBot: { ...baseGoogleBot, index: indexable, follow: true },
    },
  };
}

export async function GamingGraphicsHubRuntime(
  props: GamingGraphicsHubPageProps
) {
  await connection();
  const { page, params } = await loadPage(props);

  if (
    !page?.hub ||
    ('isIndexable' in page && !page.isIndexable) ||
    ('isIndexable' in page.hub && !page.hub.isIndexable)
  ) {
    const headersList = await headers();
    const pathPrefix = isDomainIdentifier(params.slug)
      ? ''
      : getStorefrontPathPrefix(headersList, page?.merchant ?? params.slug);
    return (
      <StorefrontRouteNotFoundContent
        backHref={pathPrefix || '/'}
        message="This graphics hub is unavailable or has moved."
        title="Graphics hub not found"
      />
    );
  }

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
        hubSlug={page.hub.slug}
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
