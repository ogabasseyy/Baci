import { router } from 'expo-router';
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
    void shared.refresh?.().catch(() => undefined);
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
