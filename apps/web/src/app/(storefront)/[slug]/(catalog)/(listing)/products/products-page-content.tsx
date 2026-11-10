import { headers } from 'next/headers';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import type { BreadcrumbList, CollectionPage } from 'schema-dts';
import { JsonLd, type JsonLdData } from '@/components/seo/json-ld';
import { ExperienceServerBoundary } from '@/components/storefront/experience/experience-server-boundary';
import { StorefrontPagination } from '@/components/storefront/ogabassey/components/StorefrontPagination';
import { OGABASSEY_MERCHANT_ID } from '@/config/ogabassey';
import {
  getRequestScopedMerchant,
  getStorefrontCategories,
} from '@/lib/cached-data';
import { getCachedStorefrontProductIndex } from '@/lib/cached-storefront-product-index';
import { formatDisplayCurrency } from '@/lib/format-display-currency';
import { resolveMerchantCurrencyConfig } from '@/lib/resolve-merchant-currency';
import { asRoute } from '@/lib/routes';
import {
  generateBreadcrumbSchema,
  generateCollectionPageSchema,
} from '@/lib/seo-utils';
import { buildStoreUrl } from '@/lib/store-url';
import { canonicalizeCategorySlug } from '@/lib/storefront-canonical-url';
import {
  parseStorefrontPageParam,
  STOREFRONT_PRODUCTS_PER_PAGE,
} from '@/lib/storefront-pagination';
import { getStorefrontPathPrefix } from '@/lib/storefront-path-prefix';
import { isValidMerchantIdentifier } from '@/lib/validation';
import { ProductIndexCard } from './product-index-card';
import { ProductsPageDeferredLinkModules } from './products-page-deferred-link-modules';

interface PageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function ProductsPageContent({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const resolvedSearchParams = await searchParams;
  const currentPage = parseStorefrontPageParam(resolvedSearchParams.page);

  if (!currentPage) {
    notFound();
  }

  if (!isValidMerchantIdentifier(slug)) {
    notFound();
  }

  const merchant = await getRequestScopedMerchant(slug);

  if (!merchant) {
    notFound();
  }

  const headersList = await headers();

  const showMaintainedLinkModules = merchant.id === OGABASSEY_MERCHANT_ID;

  const [categoryResult, currentProductIndex] = await Promise.all([
    getStorefrontCategories(merchant.id),
    getCachedStorefrontProductIndex(merchant.id, {
      page: currentPage,
      limit: STOREFRONT_PRODUCTS_PER_PAGE,
    }),
  ]);
  const { categories } = categoryResult;
  const totalPages = Math.max(1, currentProductIndex.totalPages || 1);

  if (!currentProductIndex.hasError && currentPage > totalPages) {
    notFound();
  }

  const baseUrl = buildStoreUrl(merchant);
  const pathPrefix = getStorefrontPathPrefix(headersList, merchant);
  const description =
    merchant.site_description ||
    `Browse all products available at ${merchant.business_name}.`;
  const displayCategories = Array.from(
    new Map(
      categories
        .filter((category) => category.is_active !== false)
        .map((category) => {
          const canonicalSlug = canonicalizeCategorySlug(category.slug);
          if (canonicalSlug === null) {
            return null;
          }
          // Replace the raw slug with its canonical form so downstream link
          // rendering always targets the canonical category URL, even when the
          // retained duplicate happened to have odd casing or whitespace.
          return {
            ...category,
            slug: canonicalSlug,
            canonicalSlug,
          };
        })
        .filter(
          (category): category is NonNullable<typeof category> =>
            category !== null
        )
        // Key by the canonical (trimmed + lowercased) form of the merchant's
        // stored slug. This preserves distinct merchant-defined categories such
        // as `samsung` and `smartphones` so they each resolve to their own
        // category page, while still collapsing case/whitespace duplicates.
        .map((category) => [category.canonicalSlug, category])
    ).values()
  );
  const productsPageUrl =
    currentPage > 1
      ? `${baseUrl}/products?page=${currentPage}`
      : `${baseUrl}/products`;
  const breadcrumbSchema: JsonLdData<BreadcrumbList> = generateBreadcrumbSchema(
    [
      { name: merchant.business_name, url: baseUrl },
      { name: 'Products', url: productsPageUrl },
    ]
  );
  const payoutCurrency = resolveMerchantCurrencyConfig(merchant).code;
  const collectionSchema: JsonLdData<CollectionPage> =
    generateCollectionPageSchema({
      name: 'Products',
      description,
      url: productsPageUrl,
      products: currentProductIndex.products,
      merchantName: merchant.business_name,
      currency: payoutCurrency,
    });
  const formatProductPrice = (amount: number) =>
    formatDisplayCurrency(amount, payoutCurrency, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
  const rangeStart =
    currentProductIndex.totalCount === 0
      ? 0
      : (currentPage - 1) * STOREFRONT_PRODUCTS_PER_PAGE + 1;
  const rangeEnd =
    currentProductIndex.totalCount === 0
      ? 0
      : rangeStart + currentProductIndex.products.length - 1;

  return (
    <ExperienceServerBoundary
      merchant={merchant}
      path="/products"
      fallback={
        <>
          <JsonLd data={collectionSchema} />
          <JsonLd data={breadcrumbSchema} />

          <div className="min-h-screen bg-[color-mix(in_srgb,var(--store-background,#ffffff)_94%,var(--store-background-text,#111827)_6%)] pb-20 pt-6">
            <div className="mx-auto max-w-[1400px] px-4 md:px-6">
              <nav
                aria-label="Breadcrumb"
                className="flex items-center gap-2 text-sm text-store-background-text/55"
              >
                <ol className="flex flex-wrap items-center gap-2">
                  <li>
                    <Link
                      href={asRoute(pathPrefix || '/')}
                      prefetch={false}
                      className="transition-colors hover:text-store-primary"
                    >
                      Home
                    </Link>
                  </li>
                  <li className="flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className="text-store-background-text/40"
                    >
                      /
                    </span>
                    <span
                      aria-current="page"
                      className="font-medium text-store-background-text"
                    >
                      Products
                    </span>
                  </li>
                </ol>
              </nav>

              <div className="mt-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
                <div className="space-y-2">
                  <h1 className="text-3xl font-bold text-store-background-text md:text-4xl">
                    Products
                  </h1>
                  <p className="max-w-2xl text-sm text-store-background-text/60 md:text-base">
                    {description}
                  </p>
                </div>

                <p
                  aria-live="polite"
                  className="text-sm text-store-background-text/50"
                >
                  Showing {rangeStart}-{rangeEnd} of{' '}
                  {currentProductIndex.totalCount} products
                </p>
              </div>

              {displayCategories.length > 0 && (
                <section className="mt-8 rounded-3xl border border-store-background-text/10 bg-store-background p-5 shadow-sm">
                  <h2 className="text-lg font-semibold text-store-background-text">
                    Browse Categories
                  </h2>
                  <div className="mt-4 flex flex-wrap gap-3">
                    {displayCategories.map((category) => (
                      <Link
                        key={category.id}
                        href={asRoute(`${pathPrefix}/${category.slug}`)}
                        prefetch={false}
                        className="rounded-full border border-store-background-text/10 bg-store-background px-4 py-2 text-sm font-medium text-store-background-text transition-colors hover:border-store-primary hover:text-store-primary"
                      >
                        {category.name}
                      </Link>
                    ))}
                  </div>
                </section>
              )}

              {currentProductIndex.products.length === 0 ? (
                <div className="mt-10 rounded-3xl border border-store-background-text/10 bg-store-background px-6 py-16 text-center shadow-sm">
                  <h2 className="text-xl font-semibold text-store-background-text">
                    No products available
                  </h2>
                  <p className="mt-2 text-sm text-store-background-text/55">
                    This storefront does not have any published products yet.
                  </p>
                </div>
              ) : (
                <>
                  <section
                    aria-labelledby="products-catalog-heading"
                    className="mt-10"
                  >
                    <h2 id="products-catalog-heading" className="sr-only">
                      Product Catalog
                    </h2>
                    {/* biome-ignore lint/a11y/useSemanticElements: WAI-ARIA group container for product cards with aria-posinset and aria-setsize */}
                    <div
                      role="group"
                      aria-labelledby="products-catalog-heading"
                      className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4"
                    >
                      {currentProductIndex.products.map((product, index) => (
                        <ProductIndexCard
                          key={product.id}
                          formattedPrice={formatProductPrice(product.price)}
                          pathPrefix={pathPrefix}
                          posInSet={rangeStart + index}
                          product={product}
                          setSize={currentProductIndex.totalCount}
                        />
                      ))}
                    </div>
                  </section>

                  <StorefrontPagination
                    ariaLabel="Products pagination"
                    basePath={`${pathPrefix}/products`}
                    crawlDiscoveryAllPagesThreshold={20}
                    crawlDiscoveryLabel="Browse product index pages"
                    crawlDiscoveryMaxLinks={24}
                    crawlDiscoveryPageLabel="Products page"
                    currentPage={currentPage}
                    totalPages={totalPages}
                  />
                </>
              )}
              {/* These links are independently streamed SEO enrichment. Keep them
              after the catalog so their late arrival cannot push painted cards. */}
              {showMaintainedLinkModules && currentPage === 1 && (
                <Suspense fallback={null}>
                  <ProductsPageDeferredLinkModules
                    baseUrl={baseUrl}
                    categories={displayCategories}
                    merchantId={merchant.id}
                    pathPrefix={pathPrefix}
                    productTotalPages={totalPages}
                  />
                </Suspense>
              )}
            </div>
          </div>
        </>
      }
    />
  );
}
