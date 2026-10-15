import { useShallow } from 'zustand/react/shallow';
import { reviewedCheckoutItems } from '@/lib/cart/reviewed-checkout-items';
import { getCartItemEffectivePrice } from '@/lib/cart-pricing';
import { useCartStore } from '@/stores/cart-store';
import { useNativeSharedCartStore } from '@/stores/native-shared-cart-store';
import type { CheckoutPrizeSimulation } from './checkout-prize-simulation.types';

export function useCheckoutDisplayCart(
  prizeSimulation?: CheckoutPrizeSimulation
) {
  const { cartItems, cartSubtotal, clearCart } = useCartStore(
    useShallow((state) => ({
      cartItems: state.items,
      cartSubtotal: state.subtotal(),
      clearCart: state.clearCart,
    }))
  );

  const shared = useNativeSharedCartStore(
    useShallow((state) => ({
      enabled: state.enabled,
      checkoutReview: state.checkoutReview,
      snapshot: state.snapshot,
    }))
  );
  let reviewedItems = cartItems;
  if (
    shared.enabled &&
    shared.checkoutReview &&
    shared.snapshot &&
    shared.checkoutReview.merchantId === shared.snapshot.merchantId &&
    shared.checkoutReview.cartId === shared.snapshot.cartId &&
    shared.checkoutReview.cartVersion === shared.snapshot.version
  ) {
    try {
      reviewedItems = reviewedCheckoutItems(cartItems, shared.checkoutReview);
    } catch {
      /* Keep the visible cart; submission remains blocked until hydration. */
    }
  }
  const reviewedSubtotal =
    reviewedItems === cartItems
      ? cartSubtotal
      : reviewedItems.reduce(
          (sum, item) => sum + getCartItemEffectivePrice(item) * item.quantity,
          0
        );
  return {
    clearCart,
    items: prizeSimulation
      ? [prizeSimulation.item]
      : reviewedItems.map((item) =>
          item.negotiationStatus === 'accepted' ||
          item.negotiatedPrice === undefined
            ? item
            : { ...item, negotiatedPrice: undefined }
        ),
    subtotal: prizeSimulation ? 0 : reviewedSubtotal,
  };
}
