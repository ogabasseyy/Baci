import { useQuery } from '@tanstack/react-query';
import { useMerchant } from '@/hooks/useMerchant';
import { fetchTransactionReviewWithFallbacks } from '@/lib/fetch-transaction-review-with-fallbacks';
import { filterExcludedTransactionReviewRows } from '@/lib/filter-excluded-transaction-review-rows';
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

export function useTransactionReview(range?: TransactionReviewRange) {
  const { merchant } = useMerchant();
  const startDateIso = range?.startDate
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
  const endDateIso = range?.endDate
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
    queryKey: ['transaction-review', merchant?.id, startDateIso, endDateIso],
    queryFn: async () => {
      if (!merchant?.id) {
        throw new Error('Merchant context is not ready');
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

      return mapTransactionOrderRows(
        filterExcludedTransactionReviewRows(
          (data ?? []) as unknown as TransactionReviewOrderRow[]
        )
      );
    },
    enabled: Boolean(merchant?.id),
    staleTime: 1000 * 60,
  });
}
