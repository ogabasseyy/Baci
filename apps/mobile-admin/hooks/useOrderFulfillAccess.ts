import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { useMerchant } from '@/hooks/useMerchant';
import { supabase } from '@/lib/supabase';
import {
  deniedOrderFulfillAccess,
  type OrderFulfillAccess,
  OrderFulfillAccessRowSchema,
  ownerOrderFulfillAccess,
  resolveOrderFulfillAccess,
} from '@/schemas/order-fulfill-access';

async function fetchOrderFulfillAccess(
  merchantId: string
): Promise<OrderFulfillAccess> {
  const { data, error } = await supabase.rpc('get_user_access');
  if (error) throw new Error('Unable to load order access');

  const rows = OrderFulfillAccessRowSchema.array().safeParse(data ?? []);
  if (!rows.success)
    throw new Error('Received an invalid order access response');

  // get_user_access returns one merchant; when it is not the merchant this
  // screen shows, the server would refuse too, so deny instead of throwing.
  const row = rows.data.find((access) => access.merchant_id === merchantId);
  return row ? resolveOrderFulfillAccess(row) : deniedOrderFulfillAccess;
}

/**
 * Order shipping permissions for the signed-in user. The owner passes at once,
 * with no request; staff get their orders.fulfill and orders.edit grants. Both
 * stay false while loading and on any error, and the server re-checks them.
 */
export function useOrderFulfillAccess(): OrderFulfillAccess {
  const { user } = useAuth();
  const { merchant } = useMerchant();
  const userId = user?.id;
  const merchantId = merchant?.id;
  const isOwner = Boolean(userId && merchant?.user_id === userId);

  const query = useQuery({
    queryKey: ['order-fulfill-access', userId, merchantId],
    queryFn: () => {
      if (!merchantId) throw new Error('No active merchant');
      return fetchOrderFulfillAccess(merchantId);
    },
    enabled: Boolean(userId && merchantId) && !isOwner,
    retry: false,
    staleTime: 1000 * 60 * 5,
  });

  if (isOwner) return ownerOrderFulfillAccess;
  return query.data ?? deniedOrderFulfillAccess;
}
