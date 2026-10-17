import * as Crypto from 'expo-crypto';
import { cartSessionStorage } from '@/lib/cart/session-storage';
import { mintedCheckoutGenerations } from '@/lib/minted-checkout-generations';
import { persistCheckoutGenerationDetached } from '@/lib/persist-checkout-generation';
import { useCartStore } from './cart-store';
import { useNativeSharedCartStore } from './native-shared-cart-store';
import {
  hasSharedCartWriter,
  retireSharedCartWriter,
} from './shared-cart-writer';

/** Account teardown clears private device state, never a shared server cart. */
export async function clearDeviceCartForAccountTeardown(): Promise<void> {
  if (!hasSharedCartWriter()) {
    // No writer is mounted (bridge not yet installed or enrollment
    // disabled since last launch): the legacy clear alone would leave
    // the shared reference and the stored account-owned proof behind,
    // so retire both explicitly for the next device owner.
    const state = useCartStore.getState();
    const merchantId = state.sharedCartRef?.merchantId;
    await state.clearCart();
    useCartStore.setState({ sharedCartRef: undefined });
    if (merchantId) {
      try {
        // Retire rather than delete: the retained proof stays
        // available for the later server revocation flush on the
        // next session establishment, instead of stranding live
        // grant authority when no writer is mounted to revoke it.
        if (cartSessionStorage.retire) {
          await cartSessionStorage.retire(merchantId);
        } else {
          await cartSessionStorage.remove(merchantId);
        }
      } catch {
        /* Storage may be unavailable; the reference is already gone. */
      }
    }
    return;
  }
  const retirement = retireSharedCartWriter();
  const checkoutGeneration = mintedCheckoutGenerations.register(
    Crypto.randomUUID()
  );
  persistCheckoutGenerationDetached(checkoutGeneration);
  useCartStore.setState({
    items: [],
    lineSequence: 0,
    cartWideNegotiationActive: false,
    sharedCartRef: undefined,
    checkoutGeneration,
    isLoading: false,
  });
  useNativeSharedCartStore.setState({
    snapshot: null,
    metadataReady: false,
    status: 'error',
    code: 'reconnect_required',
  });
  await retirement;
}
