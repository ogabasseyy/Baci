import { TRANSACTION_REVIEW_EXCLUDED_SHIPPING_STATUSES } from './transaction-review-status';

/** Merges shipping visibility with the transaction-date range into one PostgREST `or` filter. */
export function buildTransactionReviewOrFilter({
  cursor,
  endDateFilter,
  includeTransactionDate,
  startDateFilter,
}: {
  cursor?: { createdAt: string; id: string };
  endDateFilter?: string;
  includeTransactionDate: boolean;
  startDateFilter?: string;
}) {
  const visibilityFilter = `shipping_status.is.null,shipping_status.not.in.(${TRANSACTION_REVIEW_EXCLUDED_SHIPPING_STATUSES.join(',')})`;

  const orFilters = [visibilityFilter];
  if (includeTransactionDate) {
    if (startDateFilter) orFilters.push(startDateFilter);
    if (endDateFilter) orFilters.push(endDateFilter);
  }
  if (cursor) {
    // Keyset page after (created_at, id) desc: the id tiebreak keeps paging
    // exact when rows share a timestamp.
    orFilters.push(
      `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`
    );
  }

  // Repeated .or() calls overwrite each other in PostgREST's URL parameters.
  if (orFilters.length === 1) {
    return visibilityFilter;
  }

  return `and(${orFilters.map((filter) => `or(${filter})`).join(',')})`;
}
