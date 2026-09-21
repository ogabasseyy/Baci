import AsyncStorage from '@react-native-async-storage/async-storage';
import { CHECKOUT_GENERATION_STORAGE_KEY } from '@/config/checkout-storage';
import { assertCheckoutRecoveryValue } from '@/lib/assert-checkout-recovery-value';
import {
  enqueueCheckoutGenerationStorage,
  resetCheckoutGenerationStorageQueue,
} from '@/lib/checkout-generation-storage-queue';
import { markCodepointCheckoutItemSort } from '@/lib/checkout-idempotency-item-sort';
import { createLogger } from '@/lib/logger';
import { isMintedCheckoutGeneration } from '@/lib/minted-checkout-generations';
import { withCheckoutStorageTimeout } from '@/lib/with-checkout-storage-timeout';

const log = createLogger('CartStore');

async function removeAbandonedCheckoutGenerationWrite(
  abandonedGeneration: string
): Promise<void> {
  // Invalidate a timed-out write that settles late: remove the durable
  // generation only if it still holds the abandoned value. A newer persist
  // that landed later is preserved, and an empty key simply keeps the
  // in-memory identity authoritative until the next persist re-syncs it.
  const current = await AsyncStorage.getItem(CHECKOUT_GENERATION_STORAGE_KEY);
  if (current === abandonedGeneration) {
    await AsyncStorage.removeItem(CHECKOUT_GENERATION_STORAGE_KEY);
  }
}

export async function persistCheckoutGeneration(
  checkoutGeneration: string
): Promise<void> {
  assertCheckoutRecoveryValue(checkoutGeneration, 'generation');
  let settled = false;
  const attempt = enqueueCheckoutGenerationStorage(async () => {
    // Only generations minted by this build are code-point sorted. Restored
    // legacy IDs keep locale ordering even when persisted over a newer value.
    // The marker lands first so a durable generation never lacks its sort
    // version: a failed marker write rejects before the generation is
    // exposed, while a stray marker for an unwritten ID is never consulted.
    if (isMintedCheckoutGeneration(checkoutGeneration)) {
      await markCodepointCheckoutItemSort(checkoutGeneration);
    }
    await AsyncStorage.setItem(
      CHECKOUT_GENERATION_STORAGE_KEY,
      checkoutGeneration
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
  try {
    await withCheckoutStorageTimeout(attempt);
  } catch (error) {
    // A hung write must neither wedge later persists behind it nor restore
    // a stale generation when it eventually lands: reset the queue so the
    // next attempt proceeds, and invalidate the abandoned write if it
    // settles late. Genuine failures skip the reset so queued writes keep
    // their order. Callers observe the failure and retry on demand.
    if (!settled) {
      resetCheckoutGenerationStorageQueue();
      void attempt.then(
        () =>
          removeAbandonedCheckoutGenerationWrite(checkoutGeneration).catch(
            () => undefined
          ),
        () => undefined
      );
    }
    throw error;
  }
}

export function persistCheckoutGenerationDetached(
  checkoutGeneration: string
): void {
  void persistCheckoutGeneration(checkoutGeneration).catch((error) => {
    log.error('Failed to persist checkout generation:', error);
  });
}
