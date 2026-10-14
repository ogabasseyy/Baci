import * as Crypto from 'expo-crypto';
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
    await useCartStore.getState().clearCart();
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
