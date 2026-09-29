import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { BreadcrumbList, CollectionPage, WithContext } from 'schema-dts';
import { JsonLd } from '@/components/seo/json-ld';
import { StorefrontPagination } from '@/components/storefront/ogabassey/components/StorefrontPagination';
import { resolveMerchantCurrencyConfig } from '@/lib/resolve-merchant-currency';
import { asRoute } from '@/lib/routes';
import { STOREFRONT_PRODUCTS_PER_PAGE } from '@/lib/storefront-pagination';
import type { StorefrontSearchProductsPage } from '@/lib/storefront-search';
import { STOREFRONT_SEARCH_MAX_PAGE } from '@/lib/storefront-search-params';
import { ProductIndexCard } from '../products/product-index-card';
import {
  buildSearchHref,
  buildSearchSubmissionHref,
  loadSearchPageData,
} from './search-page-data';
import { SearchPageErrorPanel } from './search-page-error-panel';
import { SearchPageForm } from './search-page-form';
import { SearchPageNoResultsPanel } from './search-page-no-results-panel';
import { getPriceFormatter } from './search-page-price';
import { buildSearchPageSchemas } from './search-page-schema';
import { SearchPageStartPanel } from './search-page-start-panel';
import { formatSearchSummary } from './search-page-summary';

export interface SearchPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{
    q?: string | string[];
    page?: string | string[];
  }>;
}

const EMPTY_SEARCH_RESULT: StorefrontSearchProductsPage = {
  count: 0,
  didYouMean: null,
  productIds: [],
  products: [],
  query: '',
};

export async function SearchPageContent({
  params,
  searchParams,
}: SearchPageProps) {
  const {
    merchant,
    page,
    pathPrefix,
    query,
    redirectHref,
    searchBasePath,
    searchFailed,
    searchResult,
    storeUrl,
  } = await loadSearchPageData({ params, searchParams });

  if (redirectHref) {
    redirect(asRoute(redirectHref));
  }

  const effectiveResult = searchResult ?? EMPTY_SEARCH_RESULT;
  // The adapter echoes the sanitized query; fall back to the validated input
  // when the search failed so the form and error copy keep the submission.
  const searchQuery = searchResult ? searchResult.query : query;

  const allProductsHref = `${pathPrefix}/products`;
  const contactHref = `${pathPrefix}/contact`;
  // A did-you-mean follow is a fresh submission, so it keeps the
  // page-less submission URL (and its render is tracked as one).
  const didYouMeanHref = effectiveResult.didYouMean
    ? buildSearchSubmissionHref(searchBasePath, effectiveResult.didYouMean)
    : null;
  const pageUrl = searchQuery
    ? `${storeUrl}/search?q=${encodeURIComponent(searchQuery)}${page > 1 ? `&page=${page}` : ''}`
    : `${storeUrl}/search`;
  const merchantCurrency = resolveMerchantCurrencyConfig(merchant).code;
  const priceFormatter = getPriceFormatter(merchantCurrency);
  const visibleCount = searchFailed ? 0 : effectiveResult.products.length;
  // Pagination never advertises pages the bounded offset cannot serve.
  const totalPages =
    searchFailed || effectiveResult.count <= 0
      ? 0
      : Math.min(
          Math.ceil(effectiveResult.count / STOREFRONT_PRODUCTS_PER_PAGE),
          STOREFRONT_SEARCH_MAX_PAGE
        );
  const { breadcrumbSchema, searchResultsSchema } = buildSearchPageSchemas({
    businessName: merchant.business_name,
    merchantCurrency,
    page,
    pageUrl,
    products: effectiveResult.products,
    searchFailed,
    searchQuery,
    storeUrl,
    visibleCount,
  });

  const summaryText = searchFailed
    ? `We couldn't load results for “${query}”.`
    : formatSearchSummary({
        query: searchQuery,
        totalCount: effectiveResult.count,
        visibleCount,
        page,
      });

  return (
    <>
      <JsonLd
        data={breadcrumbSchema as unknown as WithContext<BreadcrumbList>}
      />
      <JsonLd
        data={searchResultsSchema as unknown as WithContext<CollectionPage>}
      />
      <div className="min-h-screen bg-[color-mix(in_srgb,var(--store-background,#ffffff)_94%,var(--store-background-text,#111827)_6%)] pb-20 pt-6">
        <div className="mx-auto max-w-[1400px] px-4 md:px-6">
          <nav className="flex items-center gap-2 text-sm text-store-background-text/55">
            <Link
              href={asRoute(pathPrefix || '/')}
              prefetch={false}
              className="transition-colors hover:text-store-primary"
            >
              Home
            </Link>
            <span aria-hidden="true">/</span>
            <span className="font-medium text-store-background-text">
              Search
            </span>
          </nav>

          <div className="mt-6 space-y-2">
            <h1 className="text-3xl font-bold text-store-background-text md:text-4xl">
              Search Results
            </h1>
            <p className="max-w-2xl text-sm text-store-background-text/60 md:text-base">
              {summaryText}
            </p>
          </div>

          <SearchPageForm action={searchBasePath} defaultQuery={query} />

          {!searchFailed && effectiveResult.didYouMean && didYouMeanHref && (
            <p className="mt-4 text-sm text-store-background-text/55">
              Did you mean{' '}
              <Link
                href={asRoute(didYouMeanHref)}
                className="font-medium text-store-primary underline-offset-4 hover:underline"
              >
                {effectiveResult.didYouMean}
              </Link>
              ?
            </p>
          )}

          {searchFailed ? (
            <SearchPageErrorPanel
              allProductsHref={allProductsHref}
              query={query}
            />
          ) : searchQuery ? (
            effectiveResult.products.length > 0 ? (
              <>
                <div className="mt-10 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
                  {effectiveResult.products.map((product) => (
                    <ProductIndexCard
                      key={product.id}
                      formattedPrice={priceFormatter.format(product.price)}
                      pathPrefix={pathPrefix}
                      product={product}
                    />
                  ))}
                </div>
                <StorefrontPagination
                  ariaLabel="Search results pagination"
                  basePath={buildSearchHref(searchBasePath, searchQuery, 1)}
                  currentPage={page}
                  totalPages={totalPages}
                />
              </>
            ) : (
              <SearchPageNoResultsPanel
                allProductsHref={allProductsHref}
                contactHref={contactHref}
                searchQuery={searchQuery}
              />
            )
          ) : (
            <SearchPageStartPanel />
          )}
        </div>
      </div>
    </>
  );
}
