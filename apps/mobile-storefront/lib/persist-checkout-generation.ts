import AsyncStorage from '@react-native-async-storage/async-storage';
import { CHECKOUT_GENERATION_STORAGE_KEY } from '@/config/checkout-storage';
import { assertCheckoutRecoveryValue } from '@/lib/assert-checkout-recovery-value';
import {
  enqueueCheckoutGenerationStorage,
  resetCheckoutGenerationStorageQueue,
} from '@/lib/checkout-generation-storage-queue';
import { createLogger } from '@/lib/logger';
import { markCodepointCheckoutItemSort } from '@/lib/mark-codepoint-checkout-item-sort';
import { isMintedCheckoutGeneration } from '@/lib/minted-checkout-generations';
import { withCheckoutStorageTimeout } from '@/lib/with-checkout-storage-timeout';

const log = createLogger('CartStore');

// Monotonic write identity: a same-generation retry can complete while an
// earlier attempt for that generation is still pending, so the value alone
// cannot tell a stale late write from a valid newer one.
let checkoutGenerationWriteSequence = 0;
let lastCompletedCheckoutGenerationWriteSequence = 0;
let lastCompletedCheckoutGenerationWriteValue: string | null = null;

async function compensateAbandonedCheckoutGenerationWrite(
  abandonedGeneration: string,
  abandonedWriteSequence: number
): Promise<void> {
  // Runs on the storage queue so the read and repair below are atomic with
  // respect to every other queued write: a newer generation can neither
  // land between them nor be deleted by this compensation.
  const latestSequence = lastCompletedCheckoutGenerationWriteSequence;
  const latestValue = lastCompletedCheckoutGenerationWriteValue;
  if (
    latestSequence > abandonedWriteSequence &&
    latestValue === abandonedGeneration
  ) {
    // A newer persist completed with the same value: the stored record is
    // valid regardless of which attempt wrote it last.
    return;
  }
  const current = await AsyncStorage.getItem(CHECKOUT_GENERATION_STORAGE_KEY);
  if (current !== abandonedGeneration) {
    return;
  }
  if (latestSequence > abandonedWriteSequence && latestValue !== null) {
    // The late write clobbered a newer completed identity: restore the
    // authoritative value instead of leaving the key empty.
    await AsyncStorage.setItem(CHECKOUT_GENERATION_STORAGE_KEY, latestValue);
    return;
  }
  await AsyncStorage.removeItem(CHECKOUT_GENERATION_STORAGE_KEY);
}

export async function persistCheckoutGeneration(
  checkoutGeneration: string
): Promise<void> {
  assertCheckoutRecoveryValue(checkoutGeneration, 'generation');
  const writeSequence = ++checkoutGenerationWriteSequence;
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
    // A late write must not rewind this fence: an older attempt settling
    // after a newer write keeps the newer identity authoritative.
    if (writeSequence > lastCompletedCheckoutGenerationWriteSequence) {
      lastCompletedCheckoutGenerationWriteSequence = writeSequence;
      lastCompletedCheckoutGenerationWriteValue = checkoutGeneration;
    }
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
    // next attempt proceeds, and compensate the abandoned write if it
    // settles late. The compensation is enqueued when the write lands, on
    // whatever queue is current then, so its read and repair serialize
    // with newer writes. Genuine failures skip the reset so queued writes
    // keep their order. Callers observe the failure and retry on demand.
    if (!settled) {
      resetCheckoutGenerationStorageQueue();
      void attempt.then(
        () =>
          enqueueCheckoutGenerationStorage(() =>
            compensateAbandonedCheckoutGenerationWrite(
              checkoutGeneration,
              writeSequence
            )
          ).catch(() => undefined),
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
