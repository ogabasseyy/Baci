import AsyncStorage from '@react-native-async-storage/async-storage';
import { CHECKOUT_GENERATION_STORAGE_KEY } from '@/config/checkout-storage';

export async function clearPersistedCheckoutGeneration(): Promise<void> {
  // Recovery path: never queue behind a hung generation persist. Callers
  // invoke this after the persist timed out precisely because the storage
  // queue may be stuck. Every generation *write* stays ordered through the
  // queue, and callers compensate an abandoned write when it eventually
  // settles (see removeAbandonedCheckoutGenerationWrite), so a late write
  // can neither block this removal nor restore a stale generation.
  await AsyncStorage.removeItem(CHECKOUT_GENERATION_STORAGE_KEY);
}

export async function removeAbandonedCheckoutGenerationWrite(
  abandonedGeneration: string
): Promise<void> {
  // Invalidate a timed-out write that settles late: remove the durable
  // generation only if it still holds the abandoned value. A newer persist
  // that landed later is preserved.
  const current = await AsyncStorage.getItem(CHECKOUT_GENERATION_STORAGE_KEY);
  if (current === abandonedGeneration) {
    await AsyncStorage.removeItem(CHECKOUT_GENERATION_STORAGE_KEY);
  }
}
