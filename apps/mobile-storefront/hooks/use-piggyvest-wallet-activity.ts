import {
  type InfiniteData,
  type QueryClient,
  useInfiniteQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { fetchPiggyvestWalletActivity } from '@/lib/piggyvest-wallet-activity';
import type { PiggyvestWalletActivityPage } from '@/schemas/piggyvest-wallet-activity';
import { useAuthStore } from '@/stores/auth-store';
import { useRefetchOnRefocus } from './use-refetch-on-refocus';

/** "Show more" gets one attempt and this long, so a hung server fails fast. */
const LOAD_MORE_TIMEOUT_MS = 20_000;

/** Marks a failed "Show more" so the query never retries it. */
class LoadMoreError extends Error {}

type ActivityData = InfiniteData<PiggyvestWalletActivityPage, string | null>;

const activityKey = (merchantId?: string, userId?: string) =>
  ['piggyvest-wallet-activity', merchantId, userId] as const;

/** Drops every page after the first, so a re-read reloads only page 1. */
function keepFirstPage(
  queryClient: QueryClient,
  merchantId?: string,
  userId?: string
) {
  queryClient.setQueryData<ActivityData>(
    activityKey(merchantId, userId),
    (data) =>
      data && data.pages.length > 1
        ? {
            pages: data.pages.slice(0, 1),
            pageParams: data.pageParams.slice(0, 1),
          }
        : data
  );
}

/**
 * The PiggyVest wallet activity list, paged by the server's cursor. Keyed by
 * store and signed-in customer, so another account never sees this list.
 * Re-reads the first page when the wallet itself refreshes (refreshKey) or
 * the screen regains focus. Any re-read, and leaving the screen, drops the
 * extra pages first so only page 1 is ever reloaded.
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
  const queryClient = useQueryClient();
  const query = useInfiniteQuery({
    queryKey: activityKey(merchantId, userId),
    enabled: enabled && Boolean(merchantId && userId),
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const input = { merchantId: merchantId ?? '', userId, cursor: pageParam };
      if (pageParam === null) return fetchPiggyvestWalletActivity(input);
      try {
        return await fetchPiggyvestWalletActivity({
          ...input,
          timeoutMs: LOAD_MORE_TIMEOUT_MS,
        });
      } catch (error) {
        throw new LoadMoreError(
          error instanceof Error ? error.message : 'load more failed',
          { cause: error }
        );
      }
    },
    getNextPageParam: (page) => page.nextCursor,
    retry: (failureCount, error) =>
      !(error instanceof LoadMoreError) && failureCount < 1,
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
    keepFirstPage(queryClient, merchantId, userId);
    void refetch({ cancelRefetch: false });
  }, [
    enabled,
    refreshKey,
    refetch,
    isFetching,
    queryClient,
    merchantId,
    userId,
  ]);
  // Leaving the screen collapses the list to page 1 for the next visit.
  useEffect(
    () => () => keepFirstPage(queryClient, merchantId, userId),
    [queryClient, merchantId, userId]
  );
  // A deposit made while away shows on return, without a pull to refresh.
  useRefetchOnRefocus(() => {
    if (!enabled || isFetching) return;
    keepFirstPage(queryClient, merchantId, userId);
    void refetch({ cancelRefetch: false });
  });
  return {
    items: query.data?.pages.flatMap((page) => page.items) ?? [],
    isLoading: query.isPending && query.fetchStatus !== 'idle',
    isError: query.isError && !query.data,
    /** "Show more" failed: the rows already shown stay, with a retry. */
    loadMoreFailed: query.isFetchNextPageError,
    hasMore: query.hasNextPage,
    isLoadingMore: query.isFetchingNextPage,
    loadMore: () => void fetchNextPage({ cancelRefetch: false }),
    retry: () => {
      keepFirstPage(queryClient, merchantId, userId);
      void refetch();
    },
  };
}
