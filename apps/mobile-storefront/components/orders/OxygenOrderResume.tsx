import { router } from 'expo-router';
import { Text, TouchableOpacity } from 'react-native';
import { getOxygenStagingProfile } from '@/lib/oxygen-staging-profile';
export function OxygenOrderResume({
  order,
}: {
  order: {
    id: string;
    payment_method?: string | null;
    payment_status?: string | null;
    shipping_status?: string | null;
  };
}) {
  if (
    !getOxygenStagingProfile() ||
    order.payment_method !== 'oxygen' ||
    ['paid', 'refunded'].includes(order.payment_status ?? '') ||
    ['cancelled', 'returned', 'refunded'].includes(order.shipping_status ?? '')
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
