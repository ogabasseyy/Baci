import type { CartSnapshot } from '@baci/shared/cart';
import * as Crypto from 'expo-crypto';
import { mintedCheckoutGenerations } from '@/lib/minted-checkout-generations';
import { persistCheckoutGenerationDetached } from '@/lib/persist-checkout-generation';
import { useCartStore } from '@/stores/cart-store';
import type { CartItem } from '@/stores/cart-store.types';
import { useNativeSharedCartStore } from '@/stores/native-shared-cart-store';

/** Puts a hydrated shared-cart snapshot on screen and mints a checkout generation for a new cart. */
export function publishNativeCart(
  snapshot: CartSnapshot,
  display: { items: CartItem[]; metadataReady: boolean }
): void {
  const previous = useCartStore.getState();
  const changedCart =
    previous.sharedCartRef?.merchantId !== snapshot.merchantId ||
    previous.sharedCartRef.cartId !== snapshot.cartId;
  const checkoutGeneration = changedCart
    ? mintedCheckoutGenerations.register(Crypto.randomUUID())
    : previous.checkoutGeneration;
  if (changedCart) persistCheckoutGenerationDetached(checkoutGeneration);
  useCartStore.setState({
    items: display.items,
    sharedCartRef: {
      merchantId: snapshot.merchantId,
      cartId: snapshot.cartId,
    },
    checkoutGeneration,
    cartWideNegotiationActive: false,
  });
  useNativeSharedCartStore.setState({
    snapshot,
    metadataReady: display.metadataReady,
    checkoutReview: changedCart
      ? null
      : useNativeSharedCartStore.getState().checkoutReview,
    // A failure explained for the previous cart means nothing for a new one.
    ...(changedCart ? { writeNotice: null } : {}),
  });
}
