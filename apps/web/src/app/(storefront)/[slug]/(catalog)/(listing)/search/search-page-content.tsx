import {
  buildRefinedSearchHref,
  emptySearchRefinements,
  hasActiveSearchRefinements,
} from '@baci/shared/lib';
import { redirect } from 'next/navigation';
import type { BreadcrumbList, CollectionPage, WithContext } from 'schema-dts';
import { JsonLd } from '@/components/seo/json-ld';
import { StorefrontPagination } from '@/components/storefront/ogabassey/components/StorefrontPagination';
import { V2ComparisonScope } from '@/components/storefront/ogabassey/providers/v2-comparison-scope';
import { SearchQueryDraftSession } from '@/components/storefront/search-refinements/search-query-draft';
import { SearchRefinementControls } from '@/components/storefront/search-refinements/search-refinement-controls';
import { SearchSubmissionLink } from '@/components/storefront/search-submission-link';
import { resolveMerchantCurrencyConfig } from '@/lib/resolve-merchant-currency';
import { asRoute } from '@/lib/routes';
import { STOREFRONT_PRODUCTS_PER_PAGE } from '@/lib/storefront-pagination';
import type { StorefrontSearchProductsPage } from '@/lib/storefront-search';
import { STOREFRONT_SEARCH_MAX_PAGE } from '@/lib/storefront-search-params';
import { ProductIndexCard } from '../products/product-index-card';
import { SearchCompareButton, SearchComparisonTray } from './search-comparison';
import { SearchComparisonSession } from './search-comparison-session';
import { SearchPageBreadcrumb } from './search-page-breadcrumb';
import { loadSearchPageData } from './search-page-data';
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
    [key: string]: string | string[] | undefined;
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
    refinements = emptySearchRefinements(),
    invalidFilters = false,
    facets = {
      brands: [],
      categories: [],
      conditions: [],
      processors: [],
      minPrice: null,
      maxPrice: null,
    },
    facetError = false,
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
  const pageUrl = buildRefinedSearchHref(
    `${storeUrl}/search`,
    searchQuery,
    refinements,
    page > 1 ? page : undefined
  );
  const merchantCurrency = resolveMerchantCurrencyConfig(merchant).code;
  const priceFormatter = getPriceFormatter(merchantCurrency);
  const visibleCount = searchFailed ? 0 : effectiveResult.products.length;
  // Pagination never advertises pages the bounded offset cannot serve.
  // The empty guard stays on the visible count (no rows, no pages) while
  // the division uses the unadjusted total: skipped rows stay ranked.
  const totalPages =
    searchFailed || effectiveResult.count <= 0
      ? 0
      : Math.min(
          Math.ceil(
            (effectiveResult.totalCount ?? effectiveResult.count) /
              STOREFRONT_PRODUCTS_PER_PAGE
          ),
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
    <V2ComparisonScope storageNamespace={merchant.id}>
      <SearchComparisonSession scope={query}>
        <SearchQueryDraftSession key={query} initialQuery={query}>
          <JsonLd
            data={breadcrumbSchema as unknown as WithContext<BreadcrumbList>}
          />
          <JsonLd
            data={searchResultsSchema as unknown as WithContext<CollectionPage>}
          />
          <div className="min-h-screen bg-[color-mix(in_srgb,var(--store-background,#ffffff)_94%,var(--store-background-text,#111827)_6%)] pb-8 pt-6">
            <div className="mx-auto max-w-[1400px] px-4 md:px-6">
              <SearchPageBreadcrumb pathPrefix={pathPrefix} />

              <div className="mt-6 space-y-2">
                <h1 className="text-3xl font-bold text-store-background-text md:text-4xl">
                  Search Results
                </h1>
                <p className="max-w-2xl text-sm text-store-background-text/60 md:text-base">
                  {summaryText}
                </p>
              </div>

              {/* Keyed by route query so client-side navigation remounts the
          form and draft session, resetting the controlled input and any
          validation error for the new results. */}
              <SearchPageForm
                key={query}
                action={searchBasePath}
                defaultQuery={query}
                pathPrefix={pathPrefix}
                currency={merchantCurrency}
                assistEnabled={
                  process.env.STOREFRONT_SEARCH_ASSIST_ENABLED === 'true'
                }
                redOutline={merchant.slug === 'ogabassey'}
                refinements={refinements}
                suggestionProducts={
                  !searchFailed && merchant.slug === 'ogabassey'
                    ? effectiveResult.products.map((product) => ({
                        price: product.price,
                        condition:
                          product.searchMatch?.condition ?? product.condition,
                      }))
                    : []
                }
              />

              {!searchFailed && effectiveResult.didYouMean && (
                <p className="mt-4 text-sm text-store-background-text/55">
                  Did you mean{' '}
                  <SearchSubmissionLink
                    pathPrefix={pathPrefix}
                    query={effectiveResult.didYouMean}
                    source="did-you-mean"
                    className="font-medium text-store-primary underline-offset-4 hover:underline"
                  >
                    {effectiveResult.didYouMean}
                  </SearchSubmissionLink>
                  ?
                </p>
              )}

              {query && !searchFailed && (
                <SearchComparisonTray
                  currency={merchantCurrency}
                  products={effectiveResult.products}
                  pathPrefix={pathPrefix}
                  merchantId={merchant.id}
                />
              )}
              {query && (
                <SearchRefinementControls
                  currency={merchantCurrency}
                  key={query}
                  query={query}
                  basePath={searchBasePath}
                  criteria={refinements}
                  brands={facets.brands}
                  categories={facets.categories}
                  conditions={facets.conditions}
                  processors={facets.processors ?? []}
                  facetError={facetError}
                  invalidFilters={invalidFilters}
                >
                  {invalidFilters ? (
                    <div role="alert" className="p-6">
                      Invalid filters. Edit filters or clear them to continue.
                    </div>
                  ) : searchFailed ? (
                    <SearchPageErrorPanel
                      allProductsHref={allProductsHref}
                      query={query}
                    />
                  ) : searchQuery ? (
                    effectiveResult.products.length > 0 ? (
                      <>
                        <div className="mt-4 grid grid-cols-2 gap-4 xl:grid-cols-3">
                          {effectiveResult.products.map((product) => (
                            <div key={product.id}>
                              <ProductIndexCard
                                formattedPrice={
                                  product.searchMatch &&
                                  product.searchMatch.price === undefined
                                    ? 'Price unavailable'
                                    : priceFormatter.format(product.price)
                                }
                                pathPrefix={pathPrefix}
                                product={product}
                                modern
                                footer={
                                  <SearchCompareButton
                                    compact
                                    product={product}
                                    price={
                                      product.searchMatch &&
                                      product.searchMatch.price === undefined
                                        ? 'Price unavailable'
                                        : priceFormatter.format(product.price)
                                    }
                                  />
                                }
                              />
                            </div>
                          ))}
                        </div>
                        <StorefrontPagination
                          ariaLabel="Search results pagination"
                          basePath={buildRefinedSearchHref(
                            searchBasePath,
                            searchQuery,
                            refinements,
                            1
                          )}
                          currentPage={page}
                          totalPages={totalPages}
                        />
                      </>
                    ) : (
                      <SearchPageNoResultsPanel
                        merchantSlug={merchant.slug}
                        allProductsHref={allProductsHref}
                        contactHref={contactHref}
                        searchQuery={searchQuery}
                        hasActiveRefinements={hasActiveSearchRefinements(
                          refinements
                        )}
                      />
                    )
                  ) : (
                    <SearchPageStartPanel />
                  )}
                </SearchRefinementControls>
              )}
              {!query && <SearchPageStartPanel />}
            </div>
          </div>
        </SearchQueryDraftSession>
      </SearchComparisonSession>
    </V2ComparisonScope>
  );
}
