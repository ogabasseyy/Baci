import AsyncStorage from '@react-native-async-storage/async-storage';
import { CHECKOUT_GENERATION_STORAGE_KEY } from '@/config/checkout-storage';

export async function clearPersistedCheckoutGeneration(): Promise<void> {
  // Recovery path: never queue behind a hung generation persist. Callers
  // invoke this after the persist timed out precisely because the storage
  // queue may be stuck; the persist itself resets the queue and invalidates
  // the abandoned write if it settles late, so a slow write can neither
  // block this removal nor restore a stale generation.
  await AsyncStorage.removeItem(CHECKOUT_GENERATION_STORAGE_KEY);
}
