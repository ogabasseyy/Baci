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
    // The shopper can sign in, out or switch account while the chat is open.
    refetchInterval: 30_000,
    staleTime: 20_000,
  });
}
