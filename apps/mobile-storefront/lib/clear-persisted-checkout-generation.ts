import AsyncStorage from '@react-native-async-storage/async-storage';
import { CHECKOUT_GENERATION_STORAGE_KEY } from '@/config/checkout-storage';

export async function clearPersistedCheckoutGeneration(): Promise<void> {
  // Recovery path: never queue behind a hung generation persist. Callers
  // invoke this after the persist timed out precisely because the storage
  // queue may be poisoned. Every generation *write* stays ordered through
  // the queue, so no older value can land after a newer one; only this
  // removal bypasses it, and callers bound it with a storage timeout.
  await AsyncStorage.removeItem(CHECKOUT_GENERATION_STORAGE_KEY);
}
