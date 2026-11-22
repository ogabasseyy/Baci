import { useQuery } from '@tanstack/react-query';
import { inboxCustomerKey } from '@/lib/inbox-query-keys';
import { fetchInboxCustomer } from '@/lib/merchant-inbox-api';

/** The signed-in customer behind one chat; null data for a guest chat. */
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
    staleTime: 60_000,
  });
}
