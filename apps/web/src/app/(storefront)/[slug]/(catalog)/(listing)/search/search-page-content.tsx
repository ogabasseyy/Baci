import { headers } from 'next/headers';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type { BreadcrumbList, CollectionPage, WithContext } from 'schema-dts';
import { JsonLd } from '@/components/seo/json-ld';
import { StorefrontPagination } from '@/components/storefront/ogabassey/components/StorefrontPagination';
import { getRequestScopedMerchant } from '@/lib/cached-data';
import { resolveMerchantCurrencyConfig } from '@/lib/resolve-merchant-currency';
import { asRoute } from '@/lib/routes';
import { buildRequestScopedStoreUrl } from '@/lib/store-url';
import {
  buildStorefrontPageHref,
  parseStorefrontPageParam,
  STOREFRONT_PRODUCTS_PER_PAGE,
} from '@/lib/storefront-pagination';
import { getStorefrontPathPrefix } from '@/lib/storefront-path-prefix';
import {
  getStorefrontSearchProducts,
  type StorefrontSearchProductsPage,
} from '@/lib/storefront-search';
import {
  parseStorefrontSearchQueryParam,
  STOREFRONT_SEARCH_MAX_PAGE,
} from '@/lib/storefront-search-params';
import { isValidMerchantIdentifier } from '@/lib/validation';
import { ProductIndexCard } from '../products/product-index-card';
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
  const { slug } = await params;
  const { q: rawQuery, page: rawPage } = await searchParams;
  const query = parseStorefrontSearchQueryParam(rawQuery);
  const requestedPage = parseStorefrontPageParam(rawPage);

  if (!isValidMerchantIdentifier(slug)) {
    notFound();
  }

  const merchant = await getRequestScopedMerchant(slug);

  if (!merchant) {
    notFound();
  }

  const headersList = await headers();
  const pathPrefix = getStorefrontPathPrefix(headersList, merchant);
  const searchBasePath = `${pathPrefix}/search`;
  const buildSearchHref = (targetQuery: string, targetPage: number) => {
    const pageOneHref = targetQuery
      ? `${searchBasePath}?q=${encodeURIComponent(targetQuery)}`
      : searchBasePath;
    return buildStorefrontPageHref(pageOneHref, targetPage);
  };

  // Validate before searching: malformed or repeated page parameters redirect
  // to a valid page, and a page without a query collapses to the plain route.
  if (!query) {
    if (requestedPage === null || requestedPage !== 1) {
      redirect(asRoute(buildSearchHref('', 1)));
    }
  } else if (requestedPage === null) {
    redirect(asRoute(buildSearchHref(query, 1)));
  }
  const page = requestedPage ?? 1;

  let searchResult: StorefrontSearchProductsPage | null = null;
  let searchFailed = false;
  let redirectHref: string | null = null;

  if (query) {
    const fetchSearchPage = (offset: number, trackAnalytics: boolean) =>
      getStorefrontSearchProducts({
        merchantId: merchant.id,
        query,
        limit: STOREFRONT_PRODUCTS_PER_PAGE,
        offset,
        trackAnalytics,
      });

    try {
      if (page > STOREFRONT_SEARCH_MAX_PAGE) {
        // Bounded offset: resolve the true last page through a first-page
        // probe instead of issuing a giant-offset query.
        const probe = await fetchSearchPage(0, false);
        if (probe.count === 0) {
          redirectHref = buildSearchHref(query, 1);
        } else {
          const lastPage = Math.ceil(
            probe.count / STOREFRONT_PRODUCTS_PER_PAGE
          );
          redirectHref = buildSearchHref(
            query,
            Math.min(Math.max(lastPage, 1), STOREFRONT_SEARCH_MAX_PAGE)
          );
        }
      } else {
        // Only the first page counts as a new search submission; deeper page
        // views and recovery probes must not inflate submission analytics.
        searchResult = await fetchSearchPage(
          (page - 1) * STOREFRONT_PRODUCTS_PER_PAGE,
          page === 1
        );
        if (page > 1 && searchResult.products.length === 0) {
          // The RPC reports its total only on returned rows, so an empty
          // non-first page needs a first-page probe to distinguish a genuine
          // no-results state from an invalid page.
          const probe = await fetchSearchPage(0, false);
          if (probe.count === 0) {
            // A page beyond the first of an empty result set is not a
            // distinct page: normalize to the canonical first-page URL so
            // unbounded ?page=N variants never render duplicate empties.
            redirectHref = buildSearchHref(query, 1);
          } else {
            const lastPage = Math.max(
              1,
              Math.ceil(probe.count / STOREFRONT_PRODUCTS_PER_PAGE)
            );
            // The target always steps back from the requested page so a
            // pathological probe can never redirect to the same URL in a loop.
            redirectHref = buildSearchHref(query, Math.min(lastPage, page - 1));
          }
        }
      }
    } catch {
      searchFailed = true;
    }
  }

  // redirect() throws, so it runs outside the try/catch above: a failed
  // search renders the error panel instead of being swallowed here.
  if (redirectHref) {
    redirect(asRoute(redirectHref));
  }

  const effectiveResult = searchResult ?? EMPTY_SEARCH_RESULT;
  // The adapter echoes the sanitized query; fall back to the validated input
  // when the search failed so the form and error copy keep the submission.
  const searchQuery = searchResult ? searchResult.query : query;

  const allProductsHref = `${pathPrefix}/products`;
  const contactHref = `${pathPrefix}/contact`;
  const didYouMeanHref = effectiveResult.didYouMean
    ? buildSearchHref(effectiveResult.didYouMean, 1)
    : null;
  const storeUrl = buildRequestScopedStoreUrl(merchant, headersList);
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
                  basePath={buildSearchHref(searchQuery, 1)}
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
