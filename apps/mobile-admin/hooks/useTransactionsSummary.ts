import { useMonthlyTransactionCount } from '@/hooks/useMonthlyTransactionCount';
import { useTransactionReview } from '@/hooks/useTransactionReview';

interface TransactionsSummaryRange {
  endDate?: Date;
  startDate?: Date;
}

/** Range + monthly summary cards for the transactions screen. */
export function useTransactionsSummary(
  range: TransactionsSummaryRange | undefined,
  searching: boolean,
  currentMonthAnchor: Date
) {
  const monthlyCountQuery = useMonthlyTransactionCount(currentMonthAnchor);
  const {
    data: rangeOrders = [],
    error: rangeSummaryError,
    isPending: rangeSummaryPending,
  } = useTransactionReview(range, {
    enabled: !searching,
  });

  const summary = {
    // The range query has no data on a cold cache (or while disabled during
    // search): show a placeholder rather than a 0 that reads as final. A
    // failed range query is unavailable, even when the search succeeds.
    missingCosts: rangeSummaryError
      ? 'Unavailable'
      : rangeSummaryPending
        ? '--'
        : rangeOrders.reduce(
            (count, order) => count + order.missingCostCount,
            0
          ),
    transactions: monthlyCountQuery.error
      ? 'Unavailable'
      : (monthlyCountQuery.data ?? '--'),
  };

  return { refetchMonthlyCount: monthlyCountQuery.refetch, summary };
}
