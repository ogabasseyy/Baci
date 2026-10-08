import { useQuery } from '@tanstack/react-query';
import { useMerchant } from '@/hooks/useMerchant';
import { fetchTransactionReviewWithFallbacks } from '@/lib/fetch-transaction-review-with-fallbacks';
import { filterExcludedTransactionReviewRows } from '@/lib/filter-excluded-transaction-review-rows';
import { searchTransactionReviewOrders } from '@/lib/search-transaction-review-orders';
import {
  buildTransactionReviewRangeFilters,
  mapTransactionOrderRows,
  type TransactionReviewItem,
  type TransactionReviewOrder,
  type TransactionReviewOrderRow,
} from '@/lib/transaction-review';
import { TRANSACTION_REVIEW_SELECTORS } from '@/lib/transaction-review-selectors';

interface TransactionReviewRange {
  endDate?: Date;
  startDate?: Date;
}

export type { TransactionReviewItem, TransactionReviewOrder };

export const TRANSACTION_REVIEW_LEGACY_SELECT =
  TRANSACTION_REVIEW_SELECTORS.legacy;

function mapTransactionReviewData(data: unknown) {
  return mapTransactionOrderRows(
    filterExcludedTransactionReviewRows(
      (data ?? []) as unknown as TransactionReviewOrderRow[]
    )
  );
}

export function useTransactionReview(
  range?: TransactionReviewRange,
  options: { exactDates?: boolean; search?: string } = {}
) {
  const { merchant } = useMerchant();
  const trimmedSearch = options.search?.trim() ?? '';
  const searching = trimmedSearch.length > 0;
  const startDateIso = options.exactDates
    ? range?.startDate?.toISOString()
    : range?.startDate
      ? new Date(
          Date.UTC(
            range.startDate.getUTCFullYear(),
            range.startDate.getUTCMonth(),
            range.startDate.getUTCDate(),
            0,
            0,
            0,
            0
          )
        ).toISOString()
      : undefined;
  const endDateIso = options.exactDates
    ? range?.endDate?.toISOString()
    : range?.endDate
      ? new Date(
          Date.UTC(
            range.endDate.getUTCFullYear(),
            range.endDate.getUTCMonth(),
            range.endDate.getUTCDate(),
            23,
            59,
            59,
            999
          )
        ).toISOString()
      : undefined;
  const { endDateFilter, startDateFilter } = buildTransactionReviewRangeFilters(
    startDateIso,
    endDateIso
  );

  return useQuery<TransactionReviewOrder[]>({
    queryKey: [
      'transaction-review',
      merchant?.id,
      startDateIso,
      endDateIso,
      searching ? trimmedSearch : null,
      Boolean(options.exactDates),
    ],
    queryFn: async () => {
      if (!merchant?.id) {
        throw new Error('Merchant context is not ready');
      }

      if (searching) {
        return searchTransactionReview(merchant.id, trimmedSearch);
      }

      const { data, error } = await fetchTransactionReviewWithFallbacks({
        endDateFilter,
        endDateIso,
        merchantId: merchant.id,
        startDateFilter,
        startDateIso,
      });

      if (error) {
        throw new Error(error.message);
      }

      return mapTransactionReviewData(data);
    },
    enabled: Boolean(merchant?.id),
    staleTime: 1000 * 60,
  });
}

async function searchTransactionReview(merchantId: string, search: string) {
  const searchResult = await searchTransactionReviewOrders({
    merchantId,
    search,
  });

  if (searchResult.error) {
    // Databases that predate the search RPC keep working through the
    // unbounded client-side scan until the migration lands.
    if (searchResult.errorKind === 'missing-search-function') {
      const { data, error } = await fetchTransactionReviewWithFallbacks({
        fetchAll: true,
        merchantId,
      });

      if (error) {
        throw new Error(error.message);
      }

      return mapTransactionReviewData(data);
    }

    throw new Error(searchResult.error.message);
  }

  if (searchResult.orderIds.length === 0) {
    return [];
  }

  const { data, error } = await fetchTransactionReviewWithFallbacks({
    merchantId,
    orderIds: searchResult.orderIds,
  });

  if (error) {
    throw new Error(error.message);
  }

  return mapTransactionReviewData(data);
}
