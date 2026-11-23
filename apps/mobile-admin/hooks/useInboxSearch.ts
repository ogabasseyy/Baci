import { useInfiniteQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useMerchant } from '@/hooks/useMerchant';
import { inboxSearchKey } from '@/lib/inbox-query-keys';
import { searchInbox } from '@/lib/merchant-inbox-api';
import type { InboxSearchResponse } from '@/schemas/merchant-inbox';

export const INBOX_SEARCH_MIN_LENGTH = 2;
const DEBOUNCE_MS = 350;
/**
 * The chat engine searches the whole account and the server keeps only this
 * store's chats, so a page can come back empty while later pages have matches.
 * Empty pages are skipped automatically, up to this many.
 */
const MAX_EMPTY_PAGES_SKIPPED = 5;

/** Searches chats once the person pauses typing; shorter terms search nothing. */
export function useInboxSearch(rawTerm: string) {
  const { merchant } = useMerchant();
  const [term, setTerm] = useState('');
  const trimmed = rawTerm.trim();

  useEffect(() => {
    const timer = setTimeout(() => setTerm(trimmed), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [trimmed]);

  const active = term.length >= INBOX_SEARCH_MIN_LENGTH;
  const query = useInfiniteQuery({
    enabled: !!merchant?.id && active,
    initialPageParam: 1,
    getNextPageParam: (lastPage: InboxSearchResponse) =>
      lastPage.hasMore ? lastPage.page + 1 : undefined,
    queryFn: ({ pageParam }: { pageParam: number }) =>
      searchInbox(term, pageParam),
    queryKey: inboxSearchKey(merchant?.id, term),
    staleTime: 30_000,
  });

  // Only results for the term on screen: never a stale list from the last one.
  const current = active && term === trimmed;
  const seen = new Set<number>();
  const results = current
    ? (query.data?.pages ?? [])
        .flatMap((page) => page.results)
        .filter(({ conversation }) => {
          if (seen.has(conversation.id)) return false;
          seen.add(conversation.id);
          return true;
        })
    : [];
  const pages = query.data?.pages.length ?? 0;
  // A failed page keeps its data and `hasNextPage`: stop auto-skipping there
  // (the retry is the person's), or the same failing request would repeat.
  const failed = query.isError || query.isFetchNextPageError;
  const skipping =
    current &&
    !failed &&
    results.length === 0 &&
    query.hasNextPage &&
    pages <= MAX_EMPTY_PAGES_SKIPPED;

  useEffect(() => {
    if (skipping && !query.isFetchingNextPage) query.fetchNextPage();
  }, [skipping, pages, query.isFetchingNextPage, query.fetchNextPage]);

  return {
    // Typing but not searched yet, or still looking through empty pages.
    isPending:
      trimmed.length >= INBOX_SEARCH_MIN_LENGTH &&
      !failed &&
      (!current || query.isLoading || !!skipping),
    // With results already on screen a later page failing is not an error state.
    isError: failed && results.length === 0,
    results,
    hasMore: !!query.hasNextPage,
    isLoadingMore: query.isFetchingNextPage,
    loadMore: () => {
      if (query.hasNextPage && !query.isFetchingNextPage) query.fetchNextPage();
    },
    /**
     * Tries the failed request again. A failed next page also reports
     * `isError`, but refetching would reload the pages already shown and never
     * ask for the one that failed, so that case is checked first.
     */
    retry: () => {
      if (query.isError && !query.isFetchNextPageError) query.refetch();
      else query.fetchNextPage();
    },
  };
}
