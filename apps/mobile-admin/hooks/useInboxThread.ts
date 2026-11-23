import { useInfiniteQuery } from '@tanstack/react-query';
import { useMerchant } from '@/hooks/useMerchant';
import { inboxThreadKey } from '@/lib/inbox-query-keys';
import { fetchInboxThread } from '@/lib/merchant-inbox-api';
import { sortInboxMessages } from '@/lib/merchant-inbox-format';
import type { InboxThreadPage } from '@/schemas/merchant-inbox';

/**
 * One conversation. Page 0 is the newest messages; "load earlier" fetches the
 * page before the oldest one the server told us about.
 */
export function useInboxThread(conversationId: number) {
  const { merchant } = useMerchant();

  const query = useInfiniteQuery({
    enabled: !!merchant?.id,
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (lastPage: InboxThreadPage) =>
      lastPage.hasOlder && lastPage.nextBefore
        ? lastPage.nextBefore
        : undefined,
    queryFn: ({ pageParam }: { pageParam: number | undefined }) =>
      fetchInboxThread(conversationId, pageParam),
    queryKey: inboxThreadKey(merchant?.id, conversationId),
    refetchInterval: 15_000,
    staleTime: 5_000,
  });

  const seen = new Set<number>();
  const messages = sortInboxMessages(
    (query.data?.pages ?? []).flatMap((page) => page.messages)
  ).filter((message) => {
    if (seen.has(message.id)) return false;
    seen.add(message.id);
    return true;
  });

  return {
    ...query,
    conversation: query.data?.pages[0]?.conversation ?? null,
    messages,
    merchantId: merchant?.id,
  };
}
