import { STOREFRONT_PRODUCTS_PER_PAGE } from '@/lib/storefront-pagination';

const RESULT_COUNT_FORMATTER = new Intl.NumberFormat('en-NG');

function formatResultCount(count: number) {
  return RESULT_COUNT_FORMATTER.format(count);
}

export function formatSearchSummary({
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
