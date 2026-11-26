import { useInfiniteQuery } from '@tanstack/react-query';
import { useMerchant } from '@/hooks/useMerchant';
import { inboxRefetchInterval } from '@/lib/inbox-paging';
import { inboxViewKey } from '@/lib/inbox-query-keys';
import { fetchInboxConversations } from '@/lib/merchant-inbox-api';
import type {
  InboxConversationsPage,
  InboxView,
} from '@/schemas/merchant-inbox';

/** Shopper chats for one view, paged by the web API. */
export function useInboxConversations(view: InboxView = 'needs_reply') {
  const { merchant } = useMerchant();

  return useInfiniteQuery({
    enabled: !!merchant?.id,
    initialPageParam: 1,
    getNextPageParam: (lastPage: InboxConversationsPage) =>
      lastPage.hasMore ? lastPage.page + 1 : undefined,
    queryFn: ({ pageParam }: { pageParam: number }) =>
      fetchInboxConversations(pageParam, view),
    queryKey: inboxViewKey(merchant?.id, view),
    refetchInterval: (query) =>
      inboxRefetchInterval(query.state.data?.pages.length ?? 0),
    staleTime: 10_000,
  });
}
