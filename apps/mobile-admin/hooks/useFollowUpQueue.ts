import { useQueryClient } from '@tanstack/react-query';
import { getFollowUpViewState } from '@/components/customers/follow-up-view-state';
import { useFailedOrders } from '@/hooks/useFailedOrders';
import { useMerchant } from '@/hooks/useMerchant';
import { useOxygenFollowUps } from '@/hooks/useOxygenFollowUps';
import { getFollowUpActivityAt } from '@/lib/customers-failed-orders';

/**
 * Coordinates the Customers > Follow Up merchant context and queue query.
 * A missing merchant disables the queue query, so all refresh affordances must
 * refresh merchant context first rather than treating the queue as empty.
 */
export function useFollowUpQueue() {
  const queryClient = useQueryClient();
  const {
    merchant,
    isFetching: isMerchantFetching,
    isLoading: isMerchantLoading,
    error: merchantError,
  } = useMerchant();
  const {
    data: standardOrders,
    isError: isStandardError,
    isFetching: isFetchingFailed,
    isLoading: isLoadingFailed,
    refetch: refetchFailed,
  } = useFailedOrders();
  const {
    data: oxygenOrders,
    isError: isOxygenError,
    isIncomplete: isOxygenIncomplete,
    isFetching: isFetchingOxygen,
    isLoading: isLoadingOxygen,
    refetch: refetchOxygen,
  } = useOxygenFollowUps();
  const byOrderId = new Map(
    [...(standardOrders ?? []), ...(oxygenOrders ?? [])].map((order) => [
      order.id,
      order,
    ])
  );
  const failedOrders =
    standardOrders || oxygenOrders
      ? [...byOrderId.values()].sort(
          (a, b) =>
            Date.parse(getFollowUpActivityAt(b)) -
            Date.parse(getFollowUpActivityAt(a))
        )
      : undefined;
  const isFailedOrdersError =
    isStandardError || isOxygenError || Boolean(isOxygenIncomplete);

  const viewState = getFollowUpViewState({
    followUpCount: failedOrders?.length ?? 0,
    hasMerchant: Boolean(merchant?.id),
    isFollowUpError: isFailedOrdersError,
    isFollowUpLoading: isLoadingFailed || isLoadingOxygen,
    isMerchantLoading,
    merchantError: merchantError instanceof Error ? merchantError : null,
  });

  const refresh = async () => {
    const refreshes: Promise<unknown>[] = [
      queryClient.invalidateQueries({ queryKey: ['merchant'] }),
    ];

    if (merchant?.id) {
      refreshes.push(refetchFailed());
      refreshes.push(refetchOxygen());
    }

    await Promise.allSettled(refreshes);
  };

  // `isLoading` only covers the first merchant request. Refreshing a merchant
  // context that has cached data sets React Query's `isFetching` instead, so
  // this must combine both sides of the Follow Up refresh.
  const isRefreshing =
    isMerchantFetching || isFetchingFailed || isFetchingOxygen;

  return {
    failedOrders,
    isFailedOrdersError,
    isRefreshing,
    merchant,
    refresh,
    viewState,
  };
}
