import AsyncStorage from '@react-native-async-storage/async-storage';
import { CHECKOUT_GENERATION_STORAGE_KEY } from '@/config/checkout-storage';

export async function clearPersistedCheckoutGeneration(): Promise<void> {
  await AsyncStorage.removeItem(CHECKOUT_GENERATION_STORAGE_KEY);
}
