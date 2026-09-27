import { applyCheckoutCreditSnapshot } from '@/lib/checkout-attempt-credit-snapshot';
import { createLogger } from '@/lib/logger';
import { markCodepointCheckoutItemSort } from '@/lib/mark-codepoint-checkout-item-sort';
import { mintedCheckoutGenerations } from '@/lib/minted-checkout-generations';
import { withCheckoutStorageTimeout } from '@/lib/with-checkout-storage-timeout';
import { useCartStore } from '@/stores/cart-store';
import type { CartItem } from '@/stores/cart-store.types';

const log = createLogger('Checkout');

/**
 * Restores the checkout snapshot when a failed submit emptied the cart.
 * Best-effort: restore failures never mask the original submit error.
 */
export async function restoreEmptiedCheckoutCart({
  cartWideNegotiationActive,
  checkoutGeneration,
  creditFields,
  hadSortMarker,
  itemsSnapshot,
}: {
  cartWideNegotiationActive: boolean;
  checkoutGeneration: string;
  creditFields?: Record<string, unknown>;
  hadSortMarker?: boolean;
  itemsSnapshot: CartItem[];
}): Promise<void> {
  const cartStore = useCartStore.getState();
  if (cartStore.items.length !== 0) {
    return;
  }
  // The clear path released this generation's frozen credit snapshot and
  // sort marker. The marker is restored FIRST and the cart is left empty
  // unless the required marker is durable: a code-point-era generation
  // restored without its marker would retry under locale ordering and
  // fork the idempotency key, while a durable marker with no cart behind
  // it is inert (per-generation keys are never consulted for another
  // generation's checkout). The marker is restored only when it existed
  // before cleanup: a legacy generation was keyed with locale ordering,
  // and marking it now would fork its key on retry. When the pre-cleanup
  // state could not be captured, the minted registry covers the
  // same-process case (it is empty after a restart, so restored current
  // generations must pass their captured state). The marker write is
  // bounded so a hung store cannot latch checkout recovery forever.
  const shouldRestoreMarker =
    hadSortMarker ?? mintedCheckoutGenerations.isRegistered(checkoutGeneration);
  try {
    if (shouldRestoreMarker) {
      await withCheckoutStorageTimeout(
        markCodepointCheckoutItemSort(checkoutGeneration)
      );
    }
    if (creditFields) {
      await applyCheckoutCreditSnapshot(creditFields, checkoutGeneration);
    }
    // Re-read the live cart: the marker and credit restores above can
    // pend while the shopper adds a new item, and restoring the old
    // snapshot over it would rewind the new cart and its generation.
    if (useCartStore.getState().items.length !== 0) {
      return;
    }
    await cartStore.restoreItems(
      itemsSnapshot,
      cartWideNegotiationActive,
      checkoutGeneration
    );
  } catch (recoveryError) {
    log.error(
      'Failed to restore checkout recovery data after cart rollback:',
      recoveryError
    );
  }
}
