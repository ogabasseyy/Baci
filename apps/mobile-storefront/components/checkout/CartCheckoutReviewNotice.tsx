import { Pressable, Text, View } from 'react-native';
import type { CartCheckoutReviewStatus } from '@/hooks/use-cart-checkout-snapshot';

export function CartCheckoutReviewNotice({
  status,
  onRetry,
  textColor,
}: {
  status: CartCheckoutReviewStatus;
  onRetry: () => Promise<void>;
  textColor: string;
}) {
  if (status !== 'error') return null;
  return (
    <View>
      <Text accessibilityRole="alert" style={{ color: textColor }}>
        We could not review your cart. Check your connection and retry before
        placing your order.
      </Text>
      <Pressable accessibilityRole="button" onPress={() => void onRetry()}>
        <Text style={{ color: textColor }}>Retry cart review</Text>
      </Pressable>
    </View>
  );
}
