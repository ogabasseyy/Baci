import { useEffect } from 'react';
import { useInboxConversations } from '@/hooks/useInboxConversations';
import { MAX_AUTO_PAGES } from '@/lib/inbox-paging';
import { uniqueConversations } from '@/lib/merchant-inbox-unique';

/**
 * How many shopper chats are waiting for the store's reply (0 while loading or
 * on error). Any non-empty page reports more behind it, so the pages are
 * followed to their end to get an exact number; `hasMore` stays true only while
 * that is under way or past the page limit, when the number may be higher.
 */
export function useWaitingChatCount(): { count: number; hasMore: boolean } {
  const { data, fetchNextPage, hasNextPage, isError, isFetching } =
    useInboxConversations('needs_reply');
  const pages = data?.pages.length ?? 0;
  const loadOn =
    !!hasNextPage && !isError && !isFetching && pages < MAX_AUTO_PAGES;

  // The Messages list loads the same query: join its fetch, never restart it.
  useEffect(() => {
    if (loadOn) fetchNextPage({ cancelRefetch: false });
  }, [loadOn, fetchNextPage, pages]);

  return {
    count: uniqueConversations(
      data?.pages.flatMap((page) => page.conversations) ?? []
    ).length,
    hasMore: !!hasNextPage,
  };
}
