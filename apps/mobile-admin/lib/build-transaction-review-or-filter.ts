import { TRANSACTION_REVIEW_EXCLUDED_SHIPPING_STATUSES } from './transaction-review-status';

/** Merges shipping visibility with the transaction-date range into one PostgREST `or` filter. */
export function buildTransactionReviewOrFilter({
  cursor,
  endDateFilter,
  includeTransactionDate,
  phase,
  startDateFilter,
}: {
  cursor?: { createdAt: string; id: string; transactionDate?: string };
  endDateFilter?: string;
  includeTransactionDate: boolean;
  phase?: 'dated' | 'undated';
  startDateFilter?: string;
}) {
  const visibilityFilter = `shipping_status.is.null,shipping_status.not.in.(${TRANSACTION_REVIEW_EXCLUDED_SHIPPING_STATUSES.join(',')})`;

  const orFilters = [visibilityFilter];
  if (includeTransactionDate) {
    if (startDateFilter) orFilters.push(startDateFilter);
    if (endDateFilter) orFilters.push(endDateFilter);
  }
  if (phase === 'dated') {
    // Dated phase of the legacy scan: undated rows follow in their own
    // phase, since a nulls-last keyset cannot page across the null boundary.
    orFilters.push('transaction_date.not.is.null');
  } else if (phase === 'undated') {
    orFilters.push('transaction_date.is.null');
  }
  if (cursor) {
    // Keyset page after (transaction_date, created_at, id) desc when the
    // cursor carries a transaction date, else (created_at, id) desc: the
    // tiebreaks keep paging exact when rows share a timestamp.
    orFilters.push(
      cursor.transactionDate
        ? `transaction_date.lt.${cursor.transactionDate},and(transaction_date.eq.${cursor.transactionDate},created_at.lt.${cursor.createdAt}),and(transaction_date.eq.${cursor.transactionDate},created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`
        : `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`
    );
  }

  // Repeated .or() calls overwrite each other in PostgREST's URL parameters.
  if (orFilters.length === 1) {
    return visibilityFilter;
  }

  return `and(${orFilters.map((filter) => `or(${filter})`).join(',')})`;
}
