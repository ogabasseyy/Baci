import { Pressable, Text, View } from 'react-native';
import type { CartCheckoutReviewStatus } from '@/hooks/use-cart-checkout-snapshot';
import type { NativeCheckoutSnapshot } from '@/schemas/cart-checkout-snapshot';

export function CartCheckoutReviewNotice({
  status,
  review,
  onRetry,
  textColor,
}: {
  status: CartCheckoutReviewStatus;
  review: NativeCheckoutSnapshot | null;
  onRetry: () => Promise<void>;
  textColor: string;
}) {
  return (
    <>
      {status === 'error' ? (
        <View>
          <Text accessibilityRole="alert" style={{ color: textColor }}>
            We could not review your cart. Check your connection and retry
            before placing your order.
          </Text>
          <Pressable accessibilityRole="button" onPress={() => void onRetry()}>
            <Text style={{ color: textColor }}>Retry cart review</Text>
          </Pressable>
        </View>
      ) : null}
      {review?.lines.some((line) => !line.available) ? (
        <Text accessibilityRole="alert" style={{ color: textColor }}>
          Some items are unavailable. Return to your cart to update them before
          checkout.
        </Text>
      ) : review?.lines.some(
          (line) => line.priceChanged || line.negotiationInvalidated
        ) ? (
        <Text accessibilityRole="alert" style={{ color: textColor }}>
          Prices or offers changed. Review the updated items and total before
          placing your order.
        </Text>
      ) : null}
    </>
  );
}
