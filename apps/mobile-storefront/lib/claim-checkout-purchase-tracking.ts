import AsyncStorage from '@react-native-async-storage/async-storage';
import { CHECKOUT_PURCHASE_TRACKING_STORAGE_KEY } from '@/config/checkout-storage';
import { createLogger } from '@/lib/logger';

const log = createLogger('CheckoutTracking');

function parseTrackedOrderIds(raw: string | null): string[] {
  if (!raw) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(
      (value): value is string => typeof value === 'string' && value.length > 0
    );
  } catch {
    return [];
  }
}

export async function claimCheckoutPurchaseTracking(
  orderId: string
): Promise<boolean> {
  if (!orderId) {
    return false;
  }
  try {
    const stored = parseTrackedOrderIds(
      await AsyncStorage.getItem(CHECKOUT_PURCHASE_TRACKING_STORAGE_KEY)
    );
    if (stored.includes(orderId)) {
      return false;
    }
    await AsyncStorage.setItem(
      CHECKOUT_PURCHASE_TRACKING_STORAGE_KEY,
      JSON.stringify([...stored, orderId])
    );
    return true;
  } catch (error) {
    log.error('Failed to persist checkout purchase tracking claims:', error);
    return false;
  }
}
