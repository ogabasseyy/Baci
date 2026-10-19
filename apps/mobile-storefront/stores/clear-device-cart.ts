import * as Crypto from 'expo-crypto';
import { cartSessionStorage } from '@/lib/cart/session-storage';
import { CONFIG } from '@/lib/config';
import { mintedCheckoutGenerations } from '@/lib/minted-checkout-generations';
import { persistCheckoutGenerationDetached } from '@/lib/persist-checkout-generation';
import { useCartStore } from './cart-store';
import { useNativeSharedCartStore } from './native-shared-cart-store';
import {
  hasSharedCartWriter,
  retireSharedCartWriter,
} from './shared-cart-writer';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Account teardown clears private device state, never a shared server cart. */
export async function clearDeviceCartForAccountTeardown(): Promise<void> {
  if (!hasSharedCartWriter()) {
    // No writer is mounted (bridge not yet installed or enrollment
    // disabled since last launch): the legacy clear alone would leave
    // the shared reference and the stored account-owned proof behind,
    // so retire both explicitly for the next device owner.
    const state = useCartStore.getState();
    const configuredMerchantId =
      typeof CONFIG?.MERCHANT_ID === 'string' &&
      UUID_PATTERN.test(CONFIG.MERCHANT_ID.trim())
        ? CONFIG.MERCHANT_ID.trim()
        : undefined;
    const merchantIds = new Set(
      [
        state.sharedCartRef?.merchantId,
        useNativeSharedCartStore.getState?.()?.snapshot?.merchantId,
        configuredMerchantId,
      ].filter((id): id is string => Boolean(id))
    );
    for (const merchantId of merchantIds) {
      // Retire BEFORE erasing the only merchant reference, and let a
      // storage failure propagate with the reference intact: callers
      // catch and continue sign-out, so erasing first would leave
      // the still-active proof with no retry owner.
      if (cartSessionStorage.retire) {
        await cartSessionStorage.retire(merchantId);
      } else {
        await cartSessionStorage.remove(merchantId);
      }
    }
    await state.clearCart();
    useCartStore.setState({ sharedCartRef: undefined });
    return;
  }
  const retirement = retireSharedCartWriter();
  const checkoutGeneration = mintedCheckoutGenerations.register(
    Crypto.randomUUID()
  );
  persistCheckoutGenerationDetached(checkoutGeneration);
  // Complete the proof tombstone before erasing the merchant
  // reference: when retirement fails the rejection propagates with
  // sharedCartRef intact, so the still-active proof keeps the retry
  // owner instead of being stranded until grant expiry.
  await retirement;
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
}
