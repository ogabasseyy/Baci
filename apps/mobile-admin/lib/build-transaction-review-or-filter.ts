import { TRANSACTION_REVIEW_EXCLUDED_SHIPPING_STATUSES } from './transaction-review-status';

/** Merges shipping visibility with the transaction-date range into one PostgREST `or` filter. */
export function buildTransactionReviewOrFilter({
  endDateFilter,
  includeTransactionDate,
  startDateFilter,
}: {
  endDateFilter?: string;
  includeTransactionDate: boolean;
  startDateFilter?: string;
}) {
  const visibilityFilter = `shipping_status.is.null,shipping_status.not.in.(${TRANSACTION_REVIEW_EXCLUDED_SHIPPING_STATUSES.join(',')})`;

  if (!includeTransactionDate) {
    return visibilityFilter;
  }

  const orFilters = [visibilityFilter];
  if (startDateFilter) orFilters.push(startDateFilter);
  if (endDateFilter) orFilters.push(endDateFilter);

  // Repeated .or() calls overwrite each other in PostgREST's URL parameters.
  if (orFilters.length === 1) {
    return visibilityFilter;
  }

  return `and(${orFilters.map((filter) => `or(${filter})`).join(',')})`;
}
