import { useQuery } from '@tanstack/react-query';
import { useMerchant } from '@/hooks/useMerchant';
import { fetchTransactionReviewWithFallbacks } from '@/lib/fetch-transaction-review-with-fallbacks';
import { filterExcludedTransactionReviewRows } from '@/lib/filter-excluded-transaction-review-rows';
import {
  searchTransactionReviewOrders,
  TRANSACTION_REVIEW_SEARCH_LIMIT,
} from '@/lib/search-transaction-review-orders';
import {
  buildTransactionReviewRangeFilters,
  filterTransactionOrders,
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
  options: { enabled?: boolean; exactDates?: boolean; search?: string } = {}
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

  const query = useQuery({
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

      return { orders: mapTransactionReviewData(data), searchTruncated: false };
    },
    enabled: Boolean(merchant?.id) && options.enabled !== false,
    staleTime: 1000 * 60,
  });

  return {
    ...query,
    data: query.data?.orders,
    searchTruncated: query.data?.searchTruncated ?? false,
  };
}

async function searchTransactionReview(merchantId: string, search: string) {
  const searchResult = await searchTransactionReviewOrders({
    merchantId,
    search,
  });

  if (searchResult.error) {
    // Databases that predate the search RPC keep working through the
    // client-side scan until the migration lands. The scan stays complete so
    // older matches are not silently dropped on unmigrated databases; the
    // displayed results are still capped with a truncation notice.
    if (searchResult.errorKind === 'missing-search-function') {
      const { data, error } = await fetchTransactionReviewWithFallbacks({
        fetchAll: true,
        merchantId,
      });

      if (error) {
        throw new Error(error.message);
      }

      const orders = filterTransactionOrders(
        mapTransactionReviewData(data),
        search
      );

      return {
        orders: orders.slice(0, TRANSACTION_REVIEW_SEARCH_LIMIT),
        searchTruncated: orders.length > TRANSACTION_REVIEW_SEARCH_LIMIT,
      };
    }

    throw new Error(searchResult.error.message);
  }

  if (searchResult.orderIds.length === 0) {
    return { orders: [], searchTruncated: false };
  }

  const { data, error } = await fetchTransactionReviewWithFallbacks({
    merchantId,
    orderIds: searchResult.orderIds,
  });

  if (error) {
    throw new Error(error.message);
  }

  // The truncation signal comes from the pre-refinement id count: refinement
  // can only shrink the set, so post-refinement length would hide capped
  // results.
  const orders = filterTransactionOrders(
    mapTransactionReviewData(data),
    search
  );

  return {
    orders: orders.slice(0, TRANSACTION_REVIEW_SEARCH_LIMIT),
    searchTruncated:
      searchResult.orderIds.length > TRANSACTION_REVIEW_SEARCH_LIMIT,
  };
}
