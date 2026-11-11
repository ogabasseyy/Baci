import { STOREFRONT_PRODUCTS_PER_PAGE } from '@/lib/storefront-pagination';
import type { StorefrontSearchProductsPage } from '@/lib/storefront-search';
import { STOREFRONT_SEARCH_MAX_PAGE } from '@/lib/storefront-search-params';

/** Bound pagination by the ranked total and the maximum supported offset. */
export function searchPageTotalPages(
  result: StorefrontSearchProductsPage,
  searchFailed: boolean
): number {
  const count = result.totalCount ?? result.count;
  return searchFailed || count <= 0
    ? 0
    : Math.min(
        Math.ceil(count / STOREFRONT_PRODUCTS_PER_PAGE),
        STOREFRONT_SEARCH_MAX_PAGE
      );
}
