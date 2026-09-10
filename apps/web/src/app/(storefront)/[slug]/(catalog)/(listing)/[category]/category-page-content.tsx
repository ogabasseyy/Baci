import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import type { BreadcrumbList, CollectionPage, FAQPage } from 'schema-dts';
import { JsonLd, type JsonLdData } from '@/components/seo/json-ld';
import { CategoryPage as OgabasseyCategoryPage } from '@/components/storefront/ogabassey/pages/category-page';
import { V2ComparisonScope } from '@/components/storefront/ogabassey/providers/v2-comparison-scope';
import { CategoryHubSections } from '@/components/storefront/ogabassey/seo/category-hub-sections';
import {
  getCachedCategoryPageData,
  getMerchantByIdentifier,
} from '@/lib/cached-data';
import type { RawDbProduct } from '@/lib/normalize-product';
import type { Product as SeoProduct } from '@/lib/products';
import { resolveMerchantCurrencyConfig } from '@/lib/resolve-merchant-currency';
import {
  generateBreadcrumbSchema,
  generateCollectionPageSchema,
  generateFAQSchema,
} from '@/lib/seo-utils';
import { buildRequestScopedStoreUrl, buildStoreUrl } from '@/lib/store-url';
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
  type StorefrontCategoryProduct,
} from './category-page-content-helpers';
import { CategoryPageCrawlSummary } from './category-page-crawl-summary';
import { CategoryPageDeferredCompareLinks } from './category-page-deferred-compare-links';
import { loadCategoryHubContent } from './load-category-hub-content';

interface PageProps {
  params: Promise<{
    slug: string;
    category: string;
  }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
  /** Demote when a parent route already committed the page H1. */
  titleHeading?: 'h1' | 'h2';
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

function toCollectionSchemaProduct(
  product: StorefrontCategoryProduct
): SeoProduct {
  return {
    id: String(product.id),
    name: product.name,
    description: product.description,
    status: 'active',
    price: product.rawPrice,
    manage_stock: true,
    stock: product.stock ?? 0,
    image: product.image,
    imageLarge: product.image,
    imageHint: '',
    brand: product.brand ?? '',
    gtin: '',
    mpn: '',
    category: product.category,
    category_slug: product.category_slug,
    slug: product.slug,
    // Case-insensitive comparison: DB values can be 'Refurbished' /
    // 'refurbished' / 'REFURBISHED'. Normalising here prevents refurbished
    // products from silently falling through to the `'new'` default.
    condition: (() => {
      const normalized = product.condition?.toLowerCase();
      if (normalized === 'used') return 'used';
      if (normalized === 'open box' || normalized === 'open_box')
        return 'open_box';
      if (normalized === 'refurbished') return 'refurbished';
      return 'new';
    })(),
    product_key_specs: product.product_key_specs ?? undefined,
  };
}

export async function CategoryPageContent({
  params,
  searchParams,
  titleHeading = 'h1',
}: PageProps) {
  const { slug, category } = await params;
  const { page } = await searchParams;
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
  const data = await getCachedCategoryPageData(
    merchant.id,
    category,
    slug,
    productOffset,
    STOREFRONT_PRODUCTS_PER_PAGE
  );

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
  const hubContent = buildCategoryPageHubModel({
    data,
    categorySlug: category,
    categoryName,
    merchantBusinessName: merchant.business_name,
    storeUrl: requestScopedBaseUrl,
    products: normalizedProducts,
    guidePosts,
    brandAuthorityEntries,
  });
  const paginatedCategoryUrl =
    currentPage > 1
      ? `${baseUrl}/${category}?page=${currentPage}`
      : `${baseUrl}/${category}`;

  const collectionSchema = generateCollectionPageSchema({
    name: categoryName,
    description: hubContent.intro.description,
    url: paginatedCategoryUrl,
    products: collectionSchemaProducts,
    merchantName: merchant.business_name,
    country: merchant.country || 'NG',
    currency: resolveMerchantCurrencyConfig(merchant).code,
  }) as unknown as JsonLdData<CollectionPage>;

  const breadcrumbItems = [{ name: merchant.business_name, url: baseUrl }];
  const parent = data.category?.parent as unknown as {
    name: string;
    slug: string;
  } | null;

  if (!data.isCollection && parent) {
    breadcrumbItems.push({
      name: parent.name,
      url: `${baseUrl}/${parent.slug}`,
    });
  }

  breadcrumbItems.push({
    name: categoryName,
    url: `${baseUrl}/${category}`,
  });

  const breadcrumbSchema = generateBreadcrumbSchema(
    breadcrumbItems
  ) as unknown as JsonLdData<BreadcrumbList>;
  const faqSchema =
    hubContent.faqItems.length > 0
      ? (generateFAQSchema(
          hubContent.faqItems
        ) as unknown as JsonLdData<FAQPage>)
      : null;
  const comparisonLinks = hubContent.comparisonLinks ?? [];

  return (
    <>
      <JsonLd data={collectionSchema} />
      <JsonLd data={breadcrumbSchema} />
      {faqSchema && <JsonLd data={faqSchema} />}

      <V2ComparisonScope storageNamespace={merchant.id}>
        <OgabasseyCategoryPage
          // CategoryPage client bundle. Injected as a ReactNode slot.
          hubSections={<CategoryHubSections hub={hubContent} />}
          currentPage={categoryPageCurrentPage}
          productsArePrePaginated={productsArePrePaginated}
          categoryImage={
            !data.isCollection ? data.category?.image_url : undefined
          }
          itemsPerPage={STOREFRONT_PRODUCTS_PER_PAGE}
          products={categoryPageProducts}
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
