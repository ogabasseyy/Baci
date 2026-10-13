import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { JsonLd } from '@/components/seo/json-ld';
import { CategoryPage as OgabasseyCategoryPage } from '@/components/storefront/ogabassey/pages/category-page';
import { V2ComparisonScope } from '@/components/storefront/ogabassey/providers/v2-comparison-scope';
import { CategoryHubSections } from '@/components/storefront/ogabassey/seo/category-hub-sections';
import { getMerchantByIdentifier } from '@/lib/cached-data';
import type { RawDbProduct } from '@/lib/normalize-product';
import { resolveMerchantCurrencyConfig } from '@/lib/resolve-merchant-currency';
import { buildRequestScopedStoreUrl, buildStoreUrl } from '@/lib/store-url';
import {
  buildHubPaginationBasePath,
  resolveCarriedHubSlug,
} from '@/lib/storefront-category/gaming-laptop-graphics-hubs';
import {
  parseStorefrontPageParam,
  STOREFRONT_PRODUCTS_PER_PAGE,
} from '@/lib/storefront-pagination';
import { evaluateStorefrontSlugSafety } from '@/lib/storefront-slug-safety';
import { isDomainIdentifier } from '@/lib/validation';
import { StorefrontRouteNotFoundContent } from '../../../storefront-route-not-found-content';
import {
  buildCategoryPageHubModel,
  getCategoryPageProductSlots,
  hasMaintainedCategoryCompareHubLink,
  isCategoryPageProductSlot,
  normalizeCategoryPageProducts,
  resolveCategoryPageName,
  toCollectionSchemaProduct,
} from './category-page-content-helpers';
import { buildCategoryPageContentSchemas } from './category-page-content-schema';
import { CategoryPageCrawlSummary } from './category-page-crawl-summary';
import { CategoryPageDeferredCompareLinks } from './category-page-deferred-compare-links';
import { loadGraphicsHubLinks } from './category-page-graphics-hub-links';
import { loadCategoryHubContent } from './load-category-hub-content';
import { loadFilteredCategoryPageData } from './load-filtered-category-page-data';

interface PageProps {
  params: Promise<{
    slug: string;
    category: string;
  }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
  titleHeading?: 'h1' | 'h2';
  canonicalBaseUrl?: string;
  seoPageName?: string;
  /**
   * Curated hub pages pass facet-derived graphics values (not raw query
   * strings), so the untrusted-request cardinality cap is lifted for them.
   */
  trustedGraphics?: boolean;
  /** Curated hub slug; validates hub-token transitions from the hub. */
  hubSlug?: string;
}
function renderCategoryNotFoundContent({
  slug,
  title = 'Category not found',
  message = 'This category is unavailable or has moved.',
}: {
  slug: string;
  title?: string;
  message?: string;
}) {
  return (
    <StorefrontRouteNotFoundContent
      backHref={isDomainIdentifier(slug) ? '/' : `/${slug}`}
      message={message}
      title={title}
    />
  );
}

export async function CategoryPageContent({
  canonicalBaseUrl,
  params,
  searchParams,
  seoPageName,
  titleHeading = 'h1',
  trustedGraphics = false,
  hubSlug,
}: PageProps) {
  const { slug, category } = await params;
  const { graphics, graphicsHub, page } = await searchParams;
  const merchant = await getMerchantByIdentifier(slug);

  if (!merchant) {
    notFound();
  }

  if (!evaluateStorefrontSlugSafety(category).safe) {
    return renderCategoryNotFoundContent({ slug });
  }

  const currentPage = parseStorefrontPageParam(page);

  if (!currentPage) {
    return renderCategoryNotFoundContent({
      slug,
      title: 'Category page not found',
      message: 'This category page is unavailable or has moved.',
    });
  }

  const productOffset = (currentPage - 1) * STOREFRONT_PRODUCTS_PER_PAGE;
  const { data, graphicsOptions, selectedGraphics } =
    await loadFilteredCategoryPageData({
      category,
      merchantId: merchant.id,
      productLimit: STOREFRONT_PRODUCTS_PER_PAGE,
      productOffset,
      rawGraphics: graphics,
      storeSlug: slug,
      trustedGraphics,
      trustedHubSlug: typeof graphicsHub === 'string' ? graphicsHub : undefined,
    });

  if (!data.isCollection && data.isInactiveCategory) {
    return renderCategoryNotFoundContent({ slug });
  }

  if (
    !data.isCollection &&
    !data.category?.id &&
    data.products.length === 0 &&
    !data.productsQueryFailed &&
    !data.categoryQueryFailed
  ) {
    return renderCategoryNotFoundContent({ slug });
  }

  const { guidePosts, brandAuthorityEntries } = await loadCategoryHubContent({
    merchantId: merchant.id,
    categorySlug: category,
    categoryData: data,
  });

  const productSlots = getCategoryPageProductSlots(data);
  const products = data.products as unknown as RawDbProduct[];
  const computedTotalPages = Math.max(
    1,
    Math.ceil(
      (data.productCount ?? productSlots.length) / STOREFRONT_PRODUCTS_PER_PAGE
    )
  );
  const totalPages = data.productIdsQueryFailed
    ? Math.max(computedTotalPages, currentPage)
    : computedTotalPages;
  const pageStartIndex = data.productsArePrePaginated ? 0 : productOffset;

  if (!data.productIdsQueryFailed && currentPage > totalPages) {
    return renderCategoryNotFoundContent({
      slug,
      title: 'Category page not found',
      message: 'This category page is unavailable or has moved.',
    });
  }

  const categoryName = resolveCategoryPageName(data, category);
  const normalizedProducts = normalizeCategoryPageProducts(
    products,
    category,
    merchant.country
  );
  const paginatedNormalizedProducts = normalizeCategoryPageProducts(
    productSlots
      .slice(pageStartIndex, pageStartIndex + STOREFRONT_PRODUCTS_PER_PAGE)
      .filter(isCategoryPageProductSlot),
    category,
    merchant.country
  );
  const categoryPageProducts = data.productsQueryFailed
    ? paginatedNormalizedProducts
    : normalizedProducts;
  const categoryPageCurrentPage = currentPage;
  const productsArePrePaginated =
    data.productsArePrePaginated ||
    (data.productsQueryFailed && !data.productIdsQueryFailed);
  const collectionSchemaProducts = paginatedNormalizedProducts.map(
    toCollectionSchemaProduct
  );

  const baseUrl = buildStoreUrl(merchant);
  const requestScopedBaseUrl = buildRequestScopedStoreUrl(
    merchant,
    await headers()
  );
  const graphicsHubLinks = await loadGraphicsHubLinks({
    category,
    graphicsOptions,
    requestScopedBaseUrl,
    slug,
    store: merchant,
  });
  const hubContent = buildCategoryPageHubModel({
    data,
    categorySlug: category,
    categoryName,
    merchantBusinessName: merchant.business_name,
    storeUrl: requestScopedBaseUrl,
    products: normalizedProducts,
    ...(graphicsHubLinks.length > 0
      ? { comparisonLinks: graphicsHubLinks }
      : {}),
    guidePosts,
    brandAuthorityEntries,
  });
  const canonicalCategoryUrl = canonicalBaseUrl ?? `${baseUrl}/${category}`;
  const paginatedCategoryUrl =
    currentPage > 1
      ? `${canonicalCategoryUrl}?page=${currentPage}`
      : canonicalCategoryUrl;

  const parent = data.category?.parent as unknown as {
    name: string;
    slug: string;
  } | null;
  const { breadcrumbSchema, collectionSchema, faqSchema } =
    buildCategoryPageContentSchemas({
      baseUrl,
      canonicalCategoryUrl,
      categoryName,
      country: merchant.country,
      currencyCode: resolveMerchantCurrencyConfig(merchant).code,
      hubContent,
      isCollection: data.isCollection,
      merchantBusinessName: merchant.business_name,
      paginatedCategoryUrl,
      parent,
      products: collectionSchemaProducts,
      seoPageName,
    });
  const comparisonLinks = hubContent.comparisonLinks ?? [];

  return (
    <>
      <JsonLd data={collectionSchema} />
      <JsonLd data={breadcrumbSchema} />
      {faqSchema && <JsonLd data={faqSchema} />}

      <V2ComparisonScope storageNamespace={merchant.id}>
        <OgabasseyCategoryPage
          hubSections={<CategoryHubSections hub={hubContent} />}
          hubSlug={resolveCarriedHubSlug({
            graphicsOptions,
            hubSlug,
            rawGraphics: graphics,
            trustedHubSlug:
              typeof graphicsHub === 'string' ? graphicsHub : undefined,
          })}
          // Curated hub pages keep their own pagination route
          // (/gaming-laptops/graphics/[slug]?page=N) instead of the generic
          // listing pagination path (?graphics=...), which is noindex.
          paginationBasePath={buildHubPaginationBasePath({
            baseUrl,
            canonicalBaseUrl,
            requestScopedBaseUrl,
          })}
          currentPage={categoryPageCurrentPage}
          productsArePrePaginated={productsArePrePaginated}
          categoryImage={
            !data.isCollection ? data.category?.image_url : undefined
          }
          itemsPerPage={STOREFRONT_PRODUCTS_PER_PAGE}
          products={categoryPageProducts}
          graphicsOptions={graphicsOptions}
          selectedGraphics={selectedGraphics}
          titleHeading={titleHeading}
          totalProductCount={
            productsArePrePaginated
              ? (data.productCount ?? productSlots.length)
              : undefined
          }
        />
      </V2ComparisonScope>
      <CategoryPageCrawlSummary
        categoryName={categoryName}
        merchantName={merchant.business_name}
        productNames={categoryPageProducts.map((product) => product.name)}
      />
      {!data.isCollection &&
      !hasMaintainedCategoryCompareHubLink(comparisonLinks, category) ? (
        <Suspense fallback={null}>
          <CategoryPageDeferredCompareLinks
            storeUrl={requestScopedBaseUrl}
            merchantId={merchant.id}
            categorySlug={category}
            categoryName={categoryName}
          />
        </Suspense>
      ) : null}
    </>
  );
}
