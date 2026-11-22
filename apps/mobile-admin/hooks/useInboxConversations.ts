import { useInfiniteQuery } from '@tanstack/react-query';
import { useMerchant } from '@/hooks/useMerchant';
import { inboxConversationsKey } from '@/lib/inbox-query-keys';
import { fetchInboxConversations } from '@/lib/merchant-inbox-api';
import type { InboxConversationsPage } from '@/schemas/merchant-inbox';

/** Shopper conversations, newest activity first, paged by the web API. */
export function useInboxConversations() {
  const { merchant } = useMerchant();

  return useInfiniteQuery({
    enabled: !!merchant?.id,
    initialPageParam: 1,
    getNextPageParam: (lastPage: InboxConversationsPage) =>
      lastPage.hasMore ? lastPage.page + 1 : undefined,
    queryFn: ({ pageParam }: { pageParam: number }) =>
      fetchInboxConversations(pageParam),
    queryKey: inboxConversationsKey(merchant?.id),
    refetchInterval: 30_000,
    staleTime: 10_000,
  });
}
