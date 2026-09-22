import AsyncStorage from '@react-native-async-storage/async-storage';
import { CHECKOUT_IDEMPOTENCY_ITEM_SORT_V2_STORAGE_KEY } from '@/config/checkout-storage';
import {
  enqueueCheckoutGenerationStorage,
  resetCheckoutGenerationStorageQueue,
} from '@/lib/checkout-generation-storage-queue';
import { markCodepointCheckoutItemSort } from '@/lib/mark-codepoint-checkout-item-sort';
import { isMintedCheckoutGeneration } from '@/lib/minted-checkout-generations';
import { withCheckoutStorageTimeout } from '@/lib/with-checkout-storage-timeout';

export function usesCodepointCheckoutItemSort(
  checkoutGeneration: string
): Promise<boolean> {
  // Bound the wait behind a stuck persist: a hung store fails this attempt
  // instead of blocking checkout forever. Guessing the sort on timeout
  // could fork the idempotency key, so this fails closed. When the queued
  // read itself never settles, the queue is reset so later operations are
  // not wedged behind it; genuine failures keep their order.
  let settled = false;
  const attempt = enqueueCheckoutGenerationStorage(async () => {
    if (isMintedCheckoutGeneration(checkoutGeneration)) {
      // A minted generation is code-point sorted from birth, but its
      // marker must be durable before checkout uses it: a detached
      // persist may have failed before this first read, and after a
      // restart an unmarked UUID would fall back to locale ordering.
      // Publishing the generation to cart state is safe because this sort
      // decision is the only use, and it never reports code-point sort
      // until the marker write succeeds.
      await markCodepointCheckoutItemSort(checkoutGeneration);
      return true;
    }
    return (
      (await AsyncStorage.getItem(
        `${CHECKOUT_IDEMPOTENCY_ITEM_SORT_V2_STORAGE_KEY}:${checkoutGeneration}`
      )) !== null
    );
  });
  void attempt.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    }
  );
  return withCheckoutStorageTimeout(
    attempt,
    undefined,
    'Checkout storage read timed out'
  ).catch((error: unknown) => {
    if (!settled) {
      resetCheckoutGenerationStorageQueue();
    }
    throw error;
  });
}
