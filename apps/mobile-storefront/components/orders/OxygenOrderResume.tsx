import { router } from 'expo-router';
import { Text, TouchableOpacity } from 'react-native';
import { z } from 'zod';
import { getOxygenMobileProfile } from '@/lib/oxygen-mobile-profile';
import { isClosedOxygenShippingStatus } from '@/services/oxygen/oxygen-order-status';
import { useAuthStore } from '@/stores/auth-store';

// History shows funded orders through the regular order details and receipt when available.
// This button opens the actionable financing flow for unpaid orders.
export function OxygenOrderResume({
  order,
}: {
  order: {
    id: string;
    customer_id?: string | null;
    merchant_id?: string | null;
    payment_method?: string | null;
    payment_status?: string | null;
    shipping_status?: string | null;
  };
}) {
  const profile = getOxygenMobileProfile();
  const userId = useAuthStore((state) => state.user?.id);
  const customer = useAuthStore((state) => state.customer);
  if (
    !profile ||
    !userId ||
    !customer ||
    customer.user_id !== userId ||
    customer.merchant_id !== profile.merchantId ||
    customer.id !== order.customer_id ||
    profile.merchantId !== order.merchant_id ||
    !z.uuid().safeParse(order.id).success ||
    order.payment_method !== 'oxygen' ||
    order.payment_status !== 'unpaid' ||
    isClosedOxygenShippingStatus(order.shipping_status)
  )
    return null;
  return (
    <TouchableOpacity
      accessibilityRole="button"
      onPress={() =>
        router.push({
          pathname: '/oxygen-checkout',
          params: { orderId: order.id },
        })
      }
      style={{ padding: 16 }}
    >
      <Text>Continue saved Oxygen checkout</Text>
    </TouchableOpacity>
  );
}
