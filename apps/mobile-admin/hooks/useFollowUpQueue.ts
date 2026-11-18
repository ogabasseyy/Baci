import { useQueryClient } from '@tanstack/react-query';
import { getFollowUpViewState } from '@/components/customers/follow-up-view-state';
import type { FailedOrder } from '@/hooks/useFailedOrders';
import { useFailedOrders } from '@/hooks/useFailedOrders';
import { useMerchant } from '@/hooks/useMerchant';
import { useOxygenFollowUps } from '@/hooks/useOxygenFollowUps';
import { getFollowUpActivityAt } from '@/lib/customers-failed-orders';

function parseFollowUpActivityTime(order: FailedOrder): number {
  const time = Date.parse(getFollowUpActivityAt(order));
  return Number.isFinite(time) ? time : Number.NEGATIVE_INFINITY;
}

function compareFollowUpOrdersDesc(a: FailedOrder, b: FailedOrder): number {
  const timeA = parseFollowUpActivityTime(a);
  const timeB = parseFollowUpActivityTime(b);
  if (timeA === timeB) return 0;
  return timeB > timeA ? 1 : -1;
}

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
  // The badge counts queue entries, not unique customers. Keep distinct Oxygen
  // orders visible even when another source has the same customer email.
  const byOrderId = new Map(
    [...(standardOrders ?? []), ...(oxygenOrders ?? [])].map((order) => [
      order.id,
      order,
    ])
  );
  // SQL fair sharing controls admission to its bounded result. Display order is
  // activity-based here; the list groups Needs review entries first.
  const failedOrders =
    standardOrders || oxygenOrders
      ? [...byOrderId.values()].sort(compareFollowUpOrdersDesc)
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
