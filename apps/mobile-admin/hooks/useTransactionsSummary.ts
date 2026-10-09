import { useMonthlyTransactionCount } from '@/hooks/useMonthlyTransactionCount';
import { useTransactionReview } from '@/hooks/useTransactionReview';

interface TransactionsSummaryRange {
  endDate?: Date;
  startDate?: Date;
}

/** Range + monthly summary cards for the transactions screen. */
export function useTransactionsSummary(
  range: TransactionsSummaryRange | undefined,
  currentMonthAnchor: Date
) {
  const monthlyCountQuery = useMonthlyTransactionCount(currentMonthAnchor);
  // The range query stays enabled during search: the card renders while
  // searching, and a disabled query would not refetch on cost-edit
  // invalidations, leaving a pre-edit missing-costs value on screen. The
  // cache is warm by the time a search starts, so this costs no extra fetch
  // beyond invalidation-driven refetches.
  const {
    data: rangeOrders = [],
    error: rangeSummaryError,
    isPending: rangeSummaryPending,
    searchTruncated: rangeTruncated,
  } = useTransactionReview(range, { fetchAllRange: true });

  const missingCostCount = rangeOrders.reduce(
    (count, order) => count + order.missingCostCount,
    0
  );
  const summary = {
    // The range query has no data on a cold cache: show a placeholder
    // rather than a 0 that reads as final. A failed range query is
    // unavailable, even when the search succeeds. A truncated scan counts
    // only the fetched window, so it is marked with a plus.
    missingCosts: rangeSummaryError
      ? 'Unavailable'
      : rangeSummaryPending
        ? '--'
        : rangeTruncated
          ? `${missingCostCount}+`
          : missingCostCount,
    transactions: monthlyCountQuery.error
      ? 'Unavailable'
      : (monthlyCountQuery.data ?? '--'),
  };

  return { refetchMonthlyCount: monthlyCountQuery.refetch, summary };
}
