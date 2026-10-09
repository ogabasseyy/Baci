import { fetchTransactionReviewWithFallbacks } from './fetch-transaction-review-with-fallbacks';
import { filterExcludedTransactionReviewRows } from './filter-excluded-transaction-review-rows';
import {
  mapTransactionOrderRows,
  type TransactionReviewOrderRow,
} from './transaction-review';

export function mapTransactionReviewData(data: unknown) {
  return mapTransactionOrderRows(
    filterExcludedTransactionReviewRows(
      (data ?? []) as unknown as TransactionReviewOrderRow[]
    )
  );
}

interface TransactionReviewRangeQuery {
  endDateFilter?: string;
  endDateIso?: string;
  fetchAll?: boolean;
  merchantId: string;
  startDateFilter?: string;
  startDateIso?: string;
}

/** Fetches one browse window, or the full bounded range for summaries. */
export async function fetchTransactionReviewRange({
  fetchAll,
  ...filters
}: TransactionReviewRangeQuery) {
  const { data, error, truncated } = await fetchTransactionReviewWithFallbacks({
    ...filters,
    ...(fetchAll ? { fetchAll } : {}),
  });

  if (error) {
    throw new Error(error.message);
  }

  return { orders: mapTransactionReviewData(data), truncated };
}
