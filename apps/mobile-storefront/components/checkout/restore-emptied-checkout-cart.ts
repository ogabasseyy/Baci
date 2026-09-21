import { useCartStore } from '@/stores/cart-store';
import type { CartItem } from '@/stores/cart-store.types';

/**
 * Restores the checkout snapshot when a failed submit emptied the cart.
 * Best-effort: restore failures never mask the original submit error.
 */
export async function restoreEmptiedCheckoutCart({
  cartWideNegotiationActive,
  checkoutGeneration,
  itemsSnapshot,
}: {
  cartWideNegotiationActive: boolean;
  checkoutGeneration: string;
  itemsSnapshot: CartItem[];
}): Promise<void> {
  const cartStore = useCartStore.getState();
  if (cartStore.items.length !== 0) {
    return;
  }
  try {
    await cartStore.restoreItems(
      itemsSnapshot,
      cartWideNegotiationActive,
      checkoutGeneration
    );
  } catch (restoreError) {
    void restoreError;
  }
}
