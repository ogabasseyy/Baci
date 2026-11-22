import { withTimeout } from '@baci/shared';
import { router } from 'expo-router';
import { logger } from '@/lib/logger';
import type { CartCheckoutBinding } from '@/schemas/cart-checkout-binding';
import { type CartItem, useCartStore } from '@/stores/cart-store';
import { useNativeSharedCartStore } from '@/stores/native-shared-cart-store';
import { clearAndPersistCheckoutCart } from './checkout-cart-persistence';

function cartLineValue(item: CartItem) {
  return JSON.stringify(item, (_key, value: unknown) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value).sort(([left], [right]) =>
            left.localeCompare(right)
          )
        )
      : value
  );
}

export async function completeOxygenCheckout({
  clearCart,
  generation,
  itemsSnapshot,
  orderId,
  sharedCartBinding,
}: {
  clearCart: () => void | Promise<void>;
  generation: string;
  itemsSnapshot: CartItem[];
  orderId: string;
  sharedCartBinding?: CartCheckoutBinding;
}) {
  const live = useCartStore.getState();
  const shared = useNativeSharedCartStore.getState();
  if (sharedCartBinding) {
    // The bound order already consumed its cart atomically on the server.
    // Never send a second clear that could target a new server cart.
    // Give the cart a chance to catch up without holding a saved order
    // behind an offline refresh. The cart can retry its own synchronization.
    if (shared.refresh) {
      try {
        await withTimeout(shared.refresh(), 1_000);
      } catch {
        logger.warn(
          'Checkout',
          'Shared cart refresh failed after saving the Oxygen order'
        );
      }
    }
  } else if (
    !shared.enabled &&
    live.checkoutGeneration === generation &&
    live.items.length === itemsSnapshot.length &&
    live.items.every((item, index) => {
      const submitted = itemsSnapshot[index];
      return (
        submitted !== undefined &&
        cartLineValue(item) === cartLineValue(submitted)
      );
    })
  ) {
    await clearAndPersistCheckoutCart(clearCart);
  }
  // The order is pending and can be resumed from order history. A settled
  // purchase and standard confirmation are handled by the financing flow.
  router.replace({ pathname: '/oxygen-checkout', params: { orderId } });
}
