import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import {
  type CachedMerchant,
  getRequestScopedMerchant,
} from '@/lib/cached-data';
import { buildRequestScopedStoreUrl } from '@/lib/store-url';
import {
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
import { buildSearchHref } from './search-page-href';

export interface SearchPageDataInput {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{
    q?: string | string[];
    page?: string | string[];
  }>;
}

export interface SearchPageData {
  merchant: CachedMerchant;
  page: number;
  pathPrefix: string;
  query: string;
  redirectHref: string | null;
  searchBasePath: string;
  searchFailed: boolean;
  searchResult: StorefrontSearchProductsPage | null;
  storeUrl: string;
}

/**
 * Loads everything the search results page needs: validated merchant,
 * query and page, the fetched result page (or failure flag), and a
 * redirect target when the URL needs normalization. Throws notFound for
 * unknown merchants; the caller issues redirectHref (redirect() throws, so
 * it must run outside the fetch try/catch: a failed search renders the
 * error panel instead of being swallowed here).
 */
export async function loadSearchPageData({
  params,
  searchParams,
}: SearchPageDataInput): Promise<SearchPageData> {
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
  const storeUrl = buildRequestScopedStoreUrl(merchant, headersList);
  const href = (targetQuery: string, targetPage: number) =>
    buildSearchHref(searchBasePath, targetQuery, targetPage);

  // Validate before searching: malformed or repeated page parameters redirect
  // to a valid page, and a page without a query collapses to the plain route.
  if (!query) {
    if (requestedPage === null || requestedPage !== 1) {
      return {
        merchant,
        page: 1,
        pathPrefix,
        query,
        redirectHref: href('', 1),
        searchBasePath,
        searchFailed: false,
        searchResult: null,
        storeUrl,
      };
    }
  } else if (requestedPage === null) {
    return {
      merchant,
      page: 1,
      pathPrefix,
      query,
      redirectHref: href(query, 1),
      searchBasePath,
      searchFailed: false,
      searchResult: null,
      storeUrl,
    };
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
          redirectHref = href(query, 1);
        } else {
          const lastPage = Math.ceil(
            probe.count / STOREFRONT_PRODUCTS_PER_PAGE
          );
          redirectHref = href(
            query,
            Math.min(Math.max(lastPage, 1), STOREFRONT_SEARCH_MAX_PAGE)
          );
        }
      } else {
        // Only an explicit search-submission entry counts as a new search:
        // submission URLs never carry a page parameter, while every
        // pagination link and page-1 redirect target does. Inferring from
        // the page number would recount page 1 after paging forward and
        // back; deeper page views and recovery probes stay untracked.
        searchResult = await fetchSearchPage(
          (page - 1) * STOREFRONT_PRODUCTS_PER_PAGE,
          rawPage === undefined
        );
        if (page > 1 && searchResult.products.length === 0) {
          // The RPC reports its total only on returned rows, so an empty
          // non-first page needs a first-page probe to distinguish a genuine
          // no-results state from an invalid page.
          const probe = await fetchSearchPage(0, false);
          if (probe.count === 0) {
            // A page beyond the first of an empty result set is not a
            // distinct page: normalize to the explicit first-page URL so
            // unbounded ?page=N variants never render duplicate empties
            // (and the landing never counts as a fresh submission).
            redirectHref = href(query, 1);
          } else {
            const lastPage = Math.max(
              1,
              Math.ceil(probe.count / STOREFRONT_PRODUCTS_PER_PAGE)
            );
            // The target always steps back from the requested page so a
            // pathological probe can never redirect to the same URL in a loop.
            redirectHref = href(query, Math.min(lastPage, page - 1));
          }
        }
      }
    } catch {
      searchFailed = true;
    }
  }

  return {
    merchant,
    page,
    pathPrefix,
    query,
    redirectHref,
    searchBasePath,
    searchFailed,
    searchResult,
    storeUrl,
  };
}
