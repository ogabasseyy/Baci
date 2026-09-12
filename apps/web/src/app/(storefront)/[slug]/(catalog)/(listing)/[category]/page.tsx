import type { Metadata } from 'next';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { CatalogListingLoading } from '@/app/(storefront)/[slug]/storefront-loading-ui';
import {
  getCachedCategoryPageData,
  getCachedMerchant,
  getCachedMerchantByDomain,
} from '@/lib/cached-data';
import type { RawDbProduct } from '@/lib/normalize-product';
import {
  generateMetaDescription,
  getCanonicalStorefrontFilterSearchParams,
  getIndexableRobotsMetadata,
} from '@/lib/seo-utils';
import { buildStoreUrl } from '@/lib/store-url';
import { buildStorefrontMetadataTitle } from '@/lib/storefront-metadata-title';
import {
  buildStorefrontPageHref,
  parseStorefrontPageParam,
  STOREFRONT_PRODUCTS_PER_PAGE,
} from '@/lib/storefront-pagination';
import { buildCategorySeoDecision } from '@/lib/storefront-seo/build-category-seo-decision';
import { buildFactualStorefrontDescription } from '@/lib/storefront-seo/build-factual-storefront-description';
import { evaluateStorefrontSlugSafety } from '@/lib/storefront-slug-safety';
import {
  getStorefrontOpenGraphImages,
  getStorefrontTwitterImages,
} from '@/lib/storefront-social-images';
import { isDomainIdentifier } from '@/lib/validation';
import { CategoryPageContent } from './category-page-content';
import {
  buildCategoryPageHubModel,
  getCategoryPageProductSlots,
  isCategoryPageProductSlot,
  normalizeCategoryPageProducts,
  resolveCategoryPageName,
} from './category-page-content-helpers';

interface PageProps {
  params: Promise<{
    slug: string; // Store slug (merchant)
    category: string; // Category slug
  }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
  /** Demote when a parent route already committed the page H1. */
  titleHeading?: 'h1' | 'h2';
}

function buildCategoryNotFoundMetadata(
  title = 'Category not found',
  description = 'This category is unavailable or has moved.'
): Metadata {
  return {
    title,
    description,
    // Replace root metadata alternates so soft-404 pages do not inherit a canonical.
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
}: PageProps): Promise<Metadata> {
  const { slug, category } = await params;
  // Over-long / repeatedly-encoded bot segments can never match; bail before
  // getCachedMerchant (keys on slug) or getCachedCategoryPageData ->
  // getCachedCategoryPageShellData (local `'use cache'`, keys on category and
  // queries eq('slug', category)) runs with an unbounded key.
  if (
    !evaluateStorefrontSlugSafety(slug).safe ||
    !evaluateStorefrontSlugSafety(category).safe
  ) {
    return buildCategoryNotFoundMetadata();
  }
  const resolvedSearchParams = await searchParams;
  const currentPage = parseStorefrontPageParam(resolvedSearchParams.page);

  if (!currentPage) {
    return buildCategoryNotFoundMetadata(
      'Category page not found',
      'This category page is unavailable or has moved.'
    );
  }

  // 1. Get Merchant
  const merchant = isDomainIdentifier(slug)
    ? await getCachedMerchantByDomain(slug)
    : await getCachedMerchant(slug);

  if (!merchant) {
    return {
      title: 'Store Not Found',
    };
  }

  const productOffset = (currentPage - 1) * STOREFRONT_PRODUCTS_PER_PAGE;
  const data = await getCachedCategoryPageData(
    merchant.id,
    category,
    slug,
    productOffset,
    STOREFRONT_PRODUCTS_PER_PAGE
  );

  if (!data.isCollection && data.isInactiveCategory) {
    return buildCategoryNotFoundMetadata();
  }

  // Doorway-trap stopgap (crawl-budget): a genuinely unknown/typo CATEGORY slug
  // resolves to no collection, no category row, and no fuzzy-matched products.
  // Return explicit noindex metadata so the soft-404 body cannot inherit
  // indexable parent metadata or a platform canonical.
  if (
    !data.isCollection &&
    !data.category?.id &&
    data.products.length === 0 &&
    !data.productsQueryFailed &&
    !data.categoryQueryFailed
  ) {
    return buildCategoryNotFoundMetadata();
  }

  const categoryName = resolveCategoryPageName(data, category);
  const productSlots = getCategoryPageProductSlots(data);
  const normalizedProducts = normalizeCategoryPageProducts(
    data.products as unknown as RawDbProduct[],
    undefined,
    merchant.country
  );
  const computedTotalPages = Math.max(
    1,
    Math.ceil(
      (data.productCount ?? productSlots.length) / STOREFRONT_PRODUCTS_PER_PAGE
    )
  );
  const totalPages = data.productIdsQueryFailed
    ? Math.max(computedTotalPages, currentPage)
    : computedTotalPages;

  if (!data.productIdsQueryFailed && currentPage > totalPages) {
    return buildCategoryNotFoundMetadata(
      'Category page not found',
      'This category page is unavailable or has moved.'
    );
  }

  const productSlotOffset = data.productsArePrePaginated ? 0 : productOffset;
  const paginatedProducts = normalizeCategoryPageProducts(
    productSlots
      .slice(
        productSlotOffset,
        productSlotOffset + STOREFRONT_PRODUCTS_PER_PAGE
      )
      .filter(isCategoryPageProductSlot),
    undefined,
    merchant.country
  );

  const baseUrl = buildStoreUrl(merchant);
  const canonicalFilterParams =
    getCanonicalStorefrontFilterSearchParams(resolvedSearchParams);
  const canonicalFilterQuery = canonicalFilterParams.toString();
  const categoryUrl = `${baseUrl}/${category}${canonicalFilterQuery ? `?${canonicalFilterQuery}` : ''}`;
  const hubContent = buildCategoryPageHubModel({
    data,
    categorySlug: category,
    categoryName,
    merchantBusinessName: merchant.business_name,
    storeUrl: baseUrl,
    products: normalizedProducts,
  });
  const paginatedCategoryUrl = buildStorefrontPageHref(
    categoryUrl,
    currentPage
  );

  const titleFragment = hubContent.intro.heading;
  const pageTitleFragment =
    currentPage > 1 ? `Page ${currentPage} | ${titleFragment}` : titleFragment;
  const { metadataTitle, title } = buildStorefrontMetadataTitle({
    title: pageTitleFragment,
    suffix: merchant.business_name,
    fallback: categoryName,
  });
  const fallbackDescription = buildFactualStorefrontDescription({
    businessName: merchant.business_name,
    siteDescription: null,
    siteTagline: null,
    categoryName,
    country: merchant.country,
  });
  const baseDescription =
    hubContent.intro.description.trim() || fallbackDescription;
  const pageAwareDescription =
    currentPage > 1
      ? `Page ${currentPage} of ${totalPages}: ${baseDescription}`
      : baseDescription;
  const pageAwareFallback =
    currentPage > 1
      ? `Page ${currentPage} of ${totalPages}: ${fallbackDescription}`
      : fallbackDescription;
  const description = generateMetaDescription(pageAwareDescription, 160, {
    minLength: 110,
    fallback: pageAwareFallback,
  });
  const firstProductImage = paginatedProducts[0]?.image || null;
  const socialImageCandidates = [firstProductImage, merchant.logo_url];
  const categoryQueryFailed =
    'categoryQueryFailed' in data && data.categoryQueryFailed === true;
  const existingRobots = getIndexableRobotsMetadata(resolvedSearchParams);
  const baseRobots =
    existingRobots && typeof existingRobots === 'object' ? existingRobots : {};
  const baseGoogleBot =
    typeof baseRobots.googleBot === 'object' ? baseRobots.googleBot : {};
  const categoryDecision = buildCategorySeoDecision({
    isStorePublished: merchant.is_published === true,
    isAvailable:
      !categoryQueryFailed &&
      (data.isCollection || data.isInactiveCategory === false),
    querySucceeded: !data.productsQueryFailed && !categoryQueryFailed,
    activeProductCount: data.productCount ?? productSlots.length,
  });
  const finalIndex =
    baseRobots.index === true &&
    !data.productsQueryFailed &&
    categoryDecision.index;

  return {
    title: metadataTitle,
    description,
    alternates: {
      canonical: paginatedCategoryUrl,
    },
    robots: {
      ...baseRobots,
      index: finalIndex,
      follow: true,
      googleBot: { ...baseGoogleBot, index: finalIndex, follow: true },
    },
    openGraph: {
      title,
      description,
      url: paginatedCategoryUrl,
      type: 'website',
      siteName: merchant.business_name,
      images: getStorefrontOpenGraphImages(
        baseUrl,
        categoryName,
        ...socialImageCandidates
      ),
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: getStorefrontTwitterImages(baseUrl, ...socialImageCandidates),
    },
  };
}

async function CategoryListingRuntime(props: PageProps) {
  // Keep tenant/domain listing work request-bound while the page prerenders a
  // Suspense fallback shell. Cache Components rejects route-level dynamic flags.
  await connection();

  return <CategoryPageContent {...props} />;
}

export default function CategoryPageRoute(props: PageProps) {
  return (
    <Suspense fallback={<CatalogListingLoading />}>
      <CategoryListingRuntime {...props} />
    </Suspense>
  );
}
