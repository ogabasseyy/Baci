import { useQuery } from '@tanstack/react-query';
import { CONSTANT_MERCHANT_ID } from '@/hooks/product-utils';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth-store';

export function useHomeOrderShortcuts(enabled: boolean) {
  const userId = useAuthStore((state) => state.user?.id);
  const merchantId = useAuthStore(
    (state) => state.merchantId || CONSTANT_MERCHANT_ID
  );

  const { data, isError } = useQuery({
    queryKey: ['home-order-shortcuts', merchantId, userId],
    enabled: Boolean(enabled && merchantId && userId),
    staleTime: 0,
    queryFn: async () => {
      if (!userId || !merchantId) return null;

      const ownedOrders = () =>
        supabase
          .from('orders')
          .select('id, customers!inner(user_id)')
          .eq('customers.user_id', userId)
          .eq('merchant_id', merchantId);

      const [orders, awaitingShipment] = await Promise.all([
        ownedOrders().limit(1),
        ownedOrders().in('shipping_status', ['pending', 'processing']).limit(1),
      ]);
      if (orders.error) throw orders.error;
      if (awaitingShipment.error) throw awaitingShipment.error;

      return {
        receipts: Boolean(orders.data?.length),
        tracking: Boolean(awaitingShipment.data?.length),
      };
    },
  });

  return enabled && userId && !isError ? data : undefined;
}
