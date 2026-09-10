import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { getOgabasseyStaticParams } from '@/app/(storefront)/[slug]/ogabassey-static-params';
import { STOREFRONT_METADATA_CACHE_BUCKET_QUERY_PARAM } from '@/config/storefront-metadata-cache-bots';
import {
  getCachedCategoryPageData,
  getRequestScopedMerchant,
  getStorefrontCategories,
} from '@/lib/cached-data';
import {
  generateMetaDescription,
  getIndexableRobotsMetadata,
} from '@/lib/seo-utils';
import { buildStoreUrl } from '@/lib/store-url';
import { canonicalizeCategorySlug } from '@/lib/storefront-canonical-url';
import { buildStorefrontMetadataTitle } from '@/lib/storefront-metadata-title';
import { isValidMerchantIdentifier } from '@/lib/validation';
import CategoryPageRoute, {
  generateMetadata as generateCategoryMetadata,
} from '../[category]/page';
import { CompareHubIntro } from './compare-hub-intro';
import { buildCompareIndexSections } from './compare-index-discovery';
import { CompareIndexFallback } from './compare-index-fallback';
import { ComparePageContent } from './compare-page-content';

interface CompareIndexPageProps {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

const COMPARE_CATEGORY_SLUG = 'compare';

export function generateStaticParams(): Array<{ slug: string }> {
  return getOgabasseyStaticParams();
}

const COMPARE_HUB_IGNORED_SEARCH_PARAM_KEYS = new Set([
  STOREFRONT_METADATA_CACHE_BUCKET_QUERY_PARAM,
]);

function hasActiveCompareCategory(
  categories: {
    is_active?: boolean | null;
    slug: string | null | undefined;
  }[]
) {
  return categories.some(
    (category) =>
      category.is_active !== false &&
      canonicalizeCategorySlug(category.slug) === COMPARE_CATEGORY_SLUG
  );
}

function buildCompareCategoryPageProps(
  slug: string,
  searchParams: CompareIndexPageProps['searchParams'] = Promise.resolve({})
) {
  return {
    params: Promise.resolve({
      slug,
      category: COMPARE_CATEGORY_SLUG,
    }),
    searchParams,
  };
}

async function hasCompareHubSearchParams(
  searchParams: CompareIndexPageProps['searchParams']
) {
  const resolvedSearchParams = await (searchParams ?? Promise.resolve({}));
  return Object.keys(resolvedSearchParams).some(
    (key) => !COMPARE_HUB_IGNORED_SEARCH_PARAM_KEYS.has(key)
  );
}

function buildCompareNotFoundMetadata(): Metadata {
  const title = 'Compare products page not found';
  const description = 'This compare products page is unavailable or has moved.';

  return {
    title,
    description,
    alternates: null,
    robots: { index: false, follow: true },
    openGraph: {
      title,
      description,
    },
    twitter: {
      card: 'summary',
      title,
      description,
    },
  };
}

export async function generateMetadata({
  params,
  searchParams,
}: CompareIndexPageProps): Promise<Metadata> {
  const { slug } = await params;

  if (!isValidMerchantIdentifier(slug)) {
    notFound();
  }

  const merchant = await getRequestScopedMerchant(slug);

  if (!merchant) {
    return buildCompareNotFoundMetadata();
  }

  const storeUrl = buildStoreUrl(merchant);
  const { categories, queryFailed } = await getStorefrontCategories(
    merchant.id
  );

  if (!queryFailed && hasActiveCompareCategory(categories)) {
    return generateCategoryMetadata(
      buildCompareCategoryPageProps(slug, searchParams)
    );
  }

  const sections = await buildCompareIndexSections({
    categories,
    getCategoryPageData: (categorySlug, productOffset, productLimit) =>
      getCachedCategoryPageData(
        merchant.id,
        categorySlug,
        merchant.slug,
        productOffset,
        productLimit
      ),
    linksPerCategoryLimit: 1,
    storeUrl,
    totalLinkLimit: 1,
  });
  const hasCompareSections = sections.length > 0;
  const hasQueryParams = await hasCompareHubSearchParams(searchParams);
  const { metadataTitle: title, title: compareTitle } =
    buildStorefrontMetadataTitle({
      title: `Compare products | ${merchant.business_name}`,
      fallback: 'Compare products',
    });
  const description = generateMetaDescription(
    `Compare ${merchant.business_name} products by category, specs, pricing, condition, warranty, and buying fit.`,
    160,
    {
      minLength: 110,
      fallback: `Compare products from ${merchant.business_name} by specs, price, category, and buying priorities before checkout.`,
    }
  );

  return {
    title,
    description,
    alternates: {
      canonical: `${storeUrl}/compare`,
    },
    robots:
      !queryFailed && hasCompareSections && !hasQueryParams
        ? getIndexableRobotsMetadata()
        : { index: false, follow: true },
    openGraph: {
      title: compareTitle,
      description,
      url: `${storeUrl}/compare`,
      type: 'website',
      siteName: merchant.business_name,
    },
    twitter: {
      card: 'summary',
      title: compareTitle,
      description,
    },
  };
}

async function CompareIndexRuntime(props: CompareIndexPageProps) {
  await connection();
  const { slug } = await props.params;

  if (!isValidMerchantIdentifier(slug)) {
    notFound();
  }

  const merchant = await getRequestScopedMerchant(slug);

  if (merchant) {
    const { categories, queryFailed } = await getStorefrontCategories(
      merchant.id
    );

    if (!queryFailed && hasActiveCompareCategory(categories)) {
      return (
        <CategoryPageRoute
          titleHeading="h2"
          {...buildCompareCategoryPageProps(slug, props.searchParams)}
        />
      );
    }
  }

  return <ComparePageContent omitIntro {...props} />;
}

export default function CompareIndexPage(props: CompareIndexPageProps) {
  return (
    <>
      <CompareHubIntro />
      <Suspense fallback={<CompareIndexFallback hideIntro />}>
        <CompareIndexRuntime {...props} />
      </Suspense>
    </>
  );
}
