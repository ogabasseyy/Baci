import { headers } from 'next/headers';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type { BreadcrumbList, CollectionPage, WithContext } from 'schema-dts';
import { JsonLd } from '@/components/seo/json-ld';
import { StorefrontPagination } from '@/components/storefront/ogabassey/components/StorefrontPagination';
import { getRequestScopedMerchant } from '@/lib/cached-data';
import { resolveMerchantCurrencyConfig } from '@/lib/resolve-merchant-currency';
import { asRoute } from '@/lib/routes';
import { generateBreadcrumbSchema, getProductUrl } from '@/lib/seo-utils';
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

export interface SearchPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{
    q?: string | string[];
    page?: string | string[];
  }>;
}

const RESULT_COUNT_FORMATTER = new Intl.NumberFormat('en-NG');

const priceFormatterCache = new Map<string, Intl.NumberFormat>();

function getPriceFormatter(currency: string): Intl.NumberFormat {
  let formatter = priceFormatterCache.get(currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat('en-NG', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    });
    priceFormatterCache.set(currency, formatter);
  }
  return formatter;
}

function formatResultCount(count: number) {
  return RESULT_COUNT_FORMATTER.format(count);
}

function formatSearchSummary({
  query,
  totalCount,
  visibleCount,
  page,
}: {
  query: string;
  totalCount: number;
  visibleCount: number;
  page: number;
}) {
  if (!query) {
    return 'Enter a search term to browse matching products.';
  }

  if (totalCount === 0 || visibleCount === 0) {
    return `No results found for “${query}”`;
  }

  if (totalCount > visibleCount) {
    if (page <= 1) {
      return `Showing first ${formatResultCount(visibleCount)} of ${formatResultCount(totalCount)} results for “${query}”`;
    }

    const rangeStart = (page - 1) * STOREFRONT_PRODUCTS_PER_PAGE + 1;
    const rangeEnd = rangeStart + visibleCount - 1;
    return `Showing ${formatResultCount(rangeStart)}–${formatResultCount(rangeEnd)} of ${formatResultCount(totalCount)} results for “${query}”`;
  }

  return `${formatResultCount(totalCount)} result${totalCount === 1 ? '' : 's'} for “${query}”`;
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
          searchResult = probe;
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
            searchResult = probe;
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
  const totalPages =
    searchFailed || effectiveResult.count <= 0
      ? 0
      : Math.ceil(effectiveResult.count / STOREFRONT_PRODUCTS_PER_PAGE);
  const breadcrumbSchema = generateBreadcrumbSchema([
    { name: merchant.business_name, url: storeUrl },
    { name: 'Search Results', url: pageUrl },
  ]);
  const positionOffset = (page - 1) * STOREFRONT_PRODUCTS_PER_PAGE;
  const searchResultsSchema = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: searchQuery
      ? `Search results for ${searchQuery}`
      : `Search results | ${merchant.business_name}`,
    url: pageUrl,
    mainEntity: {
      '@type': 'ItemList',
      itemListElement: searchFailed
        ? []
        : effectiveResult.products.map((product, index) => {
            const productUrl = `${storeUrl}${getProductUrl(product)}`;

            return {
              '@type': 'ListItem',
              position: positionOffset + index + 1,
              item: {
                '@type': 'Product',
                name: product.name,
                url: productUrl || undefined,
                image: product.imageLarge || product.image || undefined,
                offers: {
                  '@type': 'Offer',
                  price: product.price,
                  priceCurrency: merchantCurrency,
                  url: productUrl || undefined,
                },
              },
            };
          }),
    },
    numberOfItems: visibleCount,
  };

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

          <form
            method="get"
            action={searchBasePath}
            aria-label="Edit search"
            className="mt-6 flex max-w-xl gap-2"
          >
            <label htmlFor="search-page-input" className="sr-only">
              Search products
            </label>
            <input
              id="search-page-input"
              name="q"
              type="search"
              defaultValue={query}
              placeholder="Search products…"
              maxLength={200}
              autoComplete="off"
              className="min-w-0 flex-1 rounded-xl border border-store-background-text/15 bg-store-background px-4 py-2.5 text-sm text-store-background-text placeholder:text-store-background-text/40 focus:border-store-primary focus:outline-hidden"
            />
            <button
              type="submit"
              className="shrink-0 rounded-xl bg-store-primary px-4 py-2.5 text-sm font-semibold text-store-primary-text transition hover:opacity-90"
            >
              Search
            </button>
          </form>

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
            <div className="mt-10 rounded-3xl border border-store-background-text/10 bg-store-background px-6 py-16 text-center shadow-sm">
              <h2 className="text-xl font-semibold text-store-background-text">
                Search is temporarily unavailable
              </h2>
              <p className="mt-2 text-sm text-store-background-text/55">
                We couldn&apos;t load results for “{query}”. Try again in a
                moment.
              </p>
              <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                <Link
                  href={asRoute(buildSearchHref(query, page))}
                  prefetch={false}
                  className="rounded-md bg-store-primary px-4 py-2 text-sm font-semibold text-store-primary-text transition hover:opacity-90"
                >
                  Try again
                </Link>
                <Link
                  href={asRoute(allProductsHref)}
                  prefetch={false}
                  className="rounded-md border border-store-background-text/15 px-4 py-2 text-sm font-semibold text-store-background-text transition hover:border-store-primary hover:text-store-primary"
                >
                  View all products
                </Link>
              </div>
            </div>
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
              <div className="mt-10 rounded-3xl border border-store-background-text/10 bg-store-background px-6 py-16 text-center shadow-sm">
                <h2 className="text-xl font-semibold text-store-background-text">
                  No products found
                </h2>
                <p className="mt-2 text-sm text-store-background-text/55">
                  We could not find any products matching “{searchQuery}”.
                </p>
                <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                  <Link
                    href={asRoute(allProductsHref)}
                    prefetch={false}
                    className="rounded-md bg-store-primary px-4 py-2 text-sm font-semibold text-store-primary-text transition hover:opacity-90"
                  >
                    View all products
                  </Link>
                  <Link
                    href={asRoute(contactHref)}
                    prefetch={false}
                    className="rounded-md border border-store-background-text/15 px-4 py-2 text-sm font-semibold text-store-background-text transition hover:border-store-primary hover:text-store-primary"
                  >
                    Contact support
                  </Link>
                </div>
              </div>
            )
          ) : (
            <div className="mt-10 rounded-3xl border border-store-background-text/10 bg-store-background px-6 py-16 text-center shadow-sm">
              <h2 className="text-xl font-semibold text-store-background-text">
                Start a search
              </h2>
              <p className="mt-2 text-sm text-store-background-text/55">
                Enter a product name or keyword to see matching items.
              </p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
