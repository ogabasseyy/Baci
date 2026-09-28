/**
 * Products Hook with React Query
 *
 * 2026 Best Practices:
 * - Stale-while-revalidate for optimal UX
 * - Infinite queries for pagination
 * - Prefetching for navigation optimization
 * - Automatic retry with exponential backoff for resilience
 * - Optimistic updates for instant feel
 */

import { dedupeById } from '@baci/shared/lib';
import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import {
  CONSTANT_MERCHANT_ID,
  fetchAvailableBrands,
  fetchProductsPage,
  type UseProductsOptions,
} from '@/hooks/product-utils';
import { useMerchant } from '@/hooks/use-merchant';

/**
 * Starts a next-page fetch unless one is already in flight for the active
 * query. State flags (isFetchingNextPage, isLoadingMore) update only after
 * a rerender, so two end-reached signals arriving synchronously would both
 * pass the state guards and start duplicate fetches. Each acquisition and
 * release carries the query key: a new query resets a stale lock, and an
 * obsolete request settling late (query A resolving after the shopper
 * moved to B) cannot unlock the current query's in-flight fetch.
 */
function fetchLockedNextPage(
  lockRef: { current: { key: string; inFlight: boolean } },
  key: string,
  fetchNextPage: () => Promise<unknown>
) {
  if (lockRef.current.key !== key) {
    lockRef.current = { key, inFlight: false };
  }
  if (lockRef.current.inFlight) {
    return;
  }
  lockRef.current.inFlight = true;
  const release = () => {
    if (lockRef.current.key === key) {
      lockRef.current.inFlight = false;
    }
  };
  void fetchNextPage().then(release, release);
}

export function useProducts(options: UseProductsOptions = {}) {
  const { data: merchant } = useMerchant();
  const merchantId = merchant?.id || CONSTANT_MERCHANT_ID;

  // Destructure exactly the fields consumed so TanStack Query's
  // tracked-property optimization limits re-renders to those fields.
  const {
    data,
    error,
    fetchNextPage,
    hasNextPage,
    isError,
    isFetchedAfterMount,
    isFetchNextPageError,
    isFetching,
    isFetchingNextPage,
    isLoading,
    refetch,
  } = useInfiniteQuery({
    queryKey: ['products', merchantId, options],
    queryFn: ({ pageParam = 0 }) =>
      fetchProductsPage(merchantId, options, pageParam),
    getNextPageParam: (lastPage) => lastPage.nextOffset,
    initialPageParam: 0,
    staleTime: 1000 * 60 * 2,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    placeholderData: options.search ? undefined : keepPreviousData,
    enabled: !!merchantId && options.enabled !== false,
  });

  const pendingLoadMoreRef = useRef(false);
  const nextPageLockRef = useRef({ key: '', inFlight: false });
  const pendingLoadMoreKeyRef = useRef<string | null>(null);

  // The queued bottom-reached signal is query-scoped: a signal queued for
  // query A must not fire a next-page fetch after the shopper moves to B.
  // (The in-flight lock keys itself inside fetchLockedNextPage.) Adjusted
  // inline during render so the reset lands before the drain effect runs.
  const nextPageQueryKey = JSON.stringify(['products', merchantId, options]);
  if (pendingLoadMoreKeyRef.current !== nextPageQueryKey) {
    pendingLoadMoreKeyRef.current = nextPageQueryKey;
    pendingLoadMoreRef.current = false;
  }

  useEffect(() => {
    if (!hasNextPage) {
      pendingLoadMoreRef.current = false;
      return;
    }

    if (pendingLoadMoreRef.current && !isFetching && !isFetchingNextPage) {
      pendingLoadMoreRef.current = false;
      fetchLockedNextPage(nextPageLockRef, nextPageQueryKey, fetchNextPage);
    }
  }, [
    fetchNextPage,
    hasNextPage,
    isFetching,
    isFetchingNextPage,
    nextPageQueryKey,
  ]);

  const products = dedupeById(
    data?.pages.flatMap((page) => page.products) || []
  );
  const total = data?.pages[0]?.total || 0;

  return {
    products,
    total,
    isFetchedAfterMount,
    isLoading,
    isFetching,
    isError,
    error: error?.message || null,
    // True only when the failing request was a next-page fetch (as opposed
    // to a background refetch of loaded pages), so error footers can route
    // the retry to loadMore versus refetch.
    isNextPageError: isFetchNextPageError,
    hasMore: hasNextPage || false,
    refetch,
    loadMore: () => {
      if (!hasNextPage) {
        pendingLoadMoreRef.current = false;
        return;
      }

      if (isFetchingNextPage) return;

      // TanStack Query allows only one active InfiniteQuery fetch by default;
      // queue bottom-reached requests that arrive during background refetches
      // so FlashList's one-shot end signal is not lost.
      if (isFetching) {
        pendingLoadMoreRef.current = true;
        return;
      }

      fetchLockedNextPage(nextPageLockRef, nextPageQueryKey, fetchNextPage);
    },
    isLoadingMore: isFetchingNextPage,
  };
}

export function usePrefetchProducts() {
  const queryClient = useQueryClient();
  const { data: merchant } = useMerchant();
  const merchantId = merchant?.id || CONSTANT_MERCHANT_ID;

  return (options: UseProductsOptions = {}) => {
    if (!merchantId) return;
    queryClient.prefetchInfiniteQuery({
      queryKey: ['products', merchantId, options],
      queryFn: ({ pageParam = 0 }) =>
        fetchProductsPage(merchantId, options, pageParam),
      initialPageParam: 0,
    });
  };
}

export function useProductBrands(options: UseProductsOptions = {}) {
  const { data: merchant } = useMerchant();
  const merchantId = merchant?.id || CONSTANT_MERCHANT_ID;

  const { data, error, isError, isLoading, refetch } = useQuery({
    queryKey: ['product-brands', merchantId, options],
    queryFn: () => fetchAvailableBrands(merchantId, options),
    staleTime: 1000 * 60 * 5,
    enabled: !!merchantId && options.enabled !== false,
  });

  return {
    brands: data ?? [],
    isLoading,
    isError,
    error: error?.message || null,
    refetch,
  };
}
