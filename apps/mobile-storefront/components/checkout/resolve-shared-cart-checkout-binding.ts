import { Alert } from 'react-native';
import { reviewedCheckoutItems } from '@/lib/cart/reviewed-checkout-items';
import type { CartCheckoutBinding } from '@/schemas/cart-checkout-binding';
import type { CartItem } from '@/stores/cart-store.types';
import { useNativeSharedCartStore } from '@/stores/native-shared-cart-store';

/**
 * Canonical carts submit only the reviewed lines under the final
 * server binding; a stale review returns to the review step and a
 * canonical cart never downgrades to legacy checkout after an error.
 * Returns null when submission must stop (the shopper has been routed
 * back to review); legacy carts pass through with no binding.
 */
export function resolveSharedCartCheckoutBinding(input: {
  itemsSnapshot: CartItem[];
  setStep: (step: 'review') => void;
}): { binding?: CartCheckoutBinding; items: CartItem[] } | null {
  const sharedState = useNativeSharedCartStore.getState();
  if (!sharedState.enabled) {
    return { items: input.itemsSnapshot };
  }
  const review = sharedState.checkoutReview;
  const live = sharedState.snapshot;
  if (
    !review ||
    !live ||
    review.merchantId !== live.merchantId ||
    review.cartId !== live.cartId ||
    review.cartVersion !== live.version
  ) {
    Alert.alert(
      'Cart is syncing',
      'We need to review your cart before placing your order. Retry the cart review if checking fails.'
    );
    input.setStep('review');
    return null;
  }
  const binding: CartCheckoutBinding = {
    cart_id: review.cartId,
    checkout_session_id: review.checkoutSessionId,
    checkout_generation: review.generation,
    cart_version: review.cartVersion,
  };
  if (review.lines.some((line) => !line.available)) {
    Alert.alert(
      'Update your cart',
      'Some items are unavailable. Return to your cart and remove or update them before checkout.'
    );
    input.setStep('review');
    return null;
  }
  let items: CartItem[];
  try {
    items = reviewedCheckoutItems(input.itemsSnapshot, review);
  } catch {
    input.setStep('review');
    return null;
  }
  if (!items.length) {
    input.setStep('review');
    return null;
  }
  return { binding, items };
}
