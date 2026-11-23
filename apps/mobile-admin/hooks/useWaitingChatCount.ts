import { useInboxConversations } from '@/hooks/useInboxConversations';

/**
 * How many shopper chats are waiting for the store's reply (0 while loading or
 * on error). Only the pages loaded so far are counted, so `hasMore` says the
 * true number may be higher.
 */
export function useWaitingChatCount(): { count: number; hasMore: boolean } {
  const { data, hasNextPage } = useInboxConversations('needs_reply');
  return {
    count: data?.pages.flatMap((page) => page.conversations).length ?? 0,
    hasMore: !!hasNextPage,
  };
}
