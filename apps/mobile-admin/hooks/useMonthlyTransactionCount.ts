import { useQuery } from '@tanstack/react-query';
import { useMerchant } from '@/hooks/useMerchant';
import { fetchTransactionReviewCount } from '@/lib/fetch-transaction-review-count';

/** Counts paid transactions in the anchor's local calendar month. */
export function useMonthlyTransactionCount(anchor: Date) {
  const { merchant } = useMerchant();
  const startDateIso = new Date(
    anchor.getFullYear(),
    anchor.getMonth(),
    1
  ).toISOString();
  const endDateIso = new Date(
    new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1).getTime() - 1
  ).toISOString();

  return useQuery<number>({
    queryKey: [
      'monthly-transaction-count',
      merchant?.id,
      startDateIso,
      endDateIso,
    ],
    queryFn: async () => {
      if (!merchant?.id) {
        throw new Error('Merchant context is not ready');
      }

      const { count, error } = await fetchTransactionReviewCount({
        endDateIso,
        merchantId: merchant.id,
        startDateIso,
      });

      if (error) {
        throw new Error(
          error.message ?? 'Failed to fetch the monthly transaction count'
        );
      }

      return count ?? 0;
    },
    enabled: Boolean(merchant?.id),
    // Same-month resumes keep the query key, so a fresh cache would skip
    // the focus refetch and hide externally completed payments.
    refetchOnWindowFocus: 'always',
    staleTime: 1000 * 60,
  });
}
