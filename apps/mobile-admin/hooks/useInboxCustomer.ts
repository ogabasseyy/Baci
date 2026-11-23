import { useQuery } from '@tanstack/react-query';
import { inboxCustomerKey } from '@/lib/inbox-query-keys';
import { fetchInboxCustomer } from '@/lib/merchant-inbox-api';

/**
 * The signed-in customer behind one chat; null data for a guest chat. Polled
 * so the card follows the shopper without reopening the conversation.
 */
export function useInboxCustomer({
  conversationId,
  merchantId,
}: {
  conversationId: number;
  merchantId: string | undefined;
}) {
  return useQuery({
    enabled: !!merchantId,
    queryFn: () => fetchInboxCustomer(conversationId),
    queryKey: inboxCustomerKey(merchantId, conversationId),
    // The shopper can sign in, out or switch account while the chat is open, so
    // it is checked now and then: every minute for a known customer, every two
    // for a guest chat (each check reads the chat engine). It also refreshes
    // whenever the chat's own queries are invalidated.
    refetchInterval: (query) => (query.state.data ? 60_000 : 120_000),
    staleTime: 30_000,
  });
}
