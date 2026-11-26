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
  // Only for the term on screen: while the next one is being typed, the last
  // one's failure is not its failure.
  const failed = current && (query.isError || query.isFetchNextPageError);
  const skipping =
    current &&
    !failed &&
    results.length === 0 &&
    query.hasNextPage &&
    pages <= MAX_EMPTY_PAGES_SKIPPED;

  // Wait for any fetch, not only a next-page one: fetchNextPage cancels a
  // refresh of cached pages that is still running, which would throw the
  // refreshed first page away and keep skipping through the old empty ones.
  useEffect(() => {
    if (skipping && !query.isFetching) query.fetchNextPage();
  }, [skipping, pages, query.isFetching, query.fetchNextPage]);

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
    // Results are on screen but the page after them failed: the list offers a
    // retry instead of asking again on every scroll to the end.
    loadMoreFailed: query.isFetchNextPageError && results.length > 0,
    loadMore: () => {
      // Not while any fetch runs: asking for the next page cancels a refresh of
      // the cached pages and keeps their outdated snapshot. One can start
      // before this render hears of it, so the request joins it instead.
      if (
        query.hasNextPage &&
        !query.isFetching &&
        !query.isFetchNextPageError
      ) {
        query.fetchNextPage({ cancelRefetch: false });
      }
    },
    /**
     * Tries the failed request again. A failed next page also reports
     * `isError`, but refetching would reload the pages already shown and never
     * ask for the one that failed, so that case is checked first.
     */
    retry: () => {
      // The tap can land as a refresh starts: join it, never cancel it.
      const join = { cancelRefetch: false };
      if (query.isError && !query.isFetchNextPageError) query.refetch(join);
      else query.fetchNextPage(join);
    },
  };
}
