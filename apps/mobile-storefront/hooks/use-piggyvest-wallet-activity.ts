import { useInfiniteQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { fetchPiggyvestWalletActivity } from '@/lib/piggyvest-wallet-activity';
import { useAuthStore } from '@/stores/auth-store';

/**
 * The PiggyVest wallet activity list, paged by the server's cursor. Keyed by
 * store and signed-in customer, so another account never sees this list.
 * Re-reads the first page when the wallet itself refreshes (refreshKey).
 */
export function usePiggyvestWalletActivity({
  merchantId,
  enabled,
  refreshKey,
}: {
  merchantId?: string;
  enabled: boolean;
  refreshKey?: number;
}) {
  const userId = useAuthStore((state) => state.user?.id);
  const query = useInfiniteQuery({
    queryKey: ['piggyvest-wallet-activity', merchantId, userId],
    enabled: enabled && Boolean(merchantId && userId),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      fetchPiggyvestWalletActivity({
        merchantId: merchantId ?? '',
        userId,
        cursor: pageParam,
      }),
    getNextPageParam: (page) => page.nextCursor,
    retry: 1,
  });
  const { refetch, fetchNextPage, isFetching } = query;
  const lastKey = useRef(refreshKey);
  useEffect(() => {
    if (!enabled || lastKey.current === refreshKey) return;
    // bugfix (Fable walk): a wallet refresh used to cancel an in-flight
    // "Show more" and re-read page 1 without the cursor. Skip while any
    // read is running, and never cancel one.
    if (isFetching) return;
    lastKey.current = refreshKey;
    void refetch({ cancelRefetch: false });
  }, [enabled, refreshKey, refetch, isFetching]);
  return {
    items: query.data?.pages.flatMap((page) => page.items) ?? [],
    isLoading: query.isPending && query.fetchStatus !== 'idle',
    isError: query.isError && !query.data,
    /** "Show more" failed: the rows already shown stay, with a retry. */
    loadMoreFailed: query.isFetchNextPageError,
    hasMore: query.hasNextPage,
    isLoadingMore: query.isFetchingNextPage,
    loadMore: () => void fetchNextPage({ cancelRefetch: false }),
    retry: () => void refetch(),
  };
}
