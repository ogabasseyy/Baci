import AsyncStorage from '@react-native-async-storage/async-storage';
import { CHECKOUT_GENERATION_STORAGE_KEY } from '@/config/checkout-storage';
import { assertCheckoutRecoveryValue } from '@/lib/assert-checkout-recovery-value';

export async function readPersistedCheckoutGeneration(): Promise<
  string | null
> {
  const existing = await AsyncStorage.getItem(CHECKOUT_GENERATION_STORAGE_KEY);
  if (existing === null) return null;
  assertCheckoutRecoveryValue(existing, 'generation');
  return existing;
}
