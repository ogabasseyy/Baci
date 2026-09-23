import AsyncStorage from '@react-native-async-storage/async-storage';
import { CHECKOUT_PURCHASE_TRACKING_STORAGE_KEY } from '@/config/checkout-storage';
import { createLogger } from '@/lib/logger';

const log = createLogger('CheckoutTracking');
const REDVAULT_CONTEXT_PREFIX = `${CHECKOUT_PURCHASE_TRACKING_STORAGE_KEY}:redvault:`;

export type CheckoutPurchaseTrackingContext = {
  customerEmail?: string;
  customerPhone?: string;
  items: {
    name?: string;
    negotiatedPrice?: number | null;
    price?: number;
    product_id: string;
    quantity: number;
  }[];
  orderNumber: string;
  paymentMethod: string;
  shipping: number;
  subtotal: number;
  tax: number;
  total: number;
  userId?: string;
};

export async function saveRedvaultPurchaseTrackingContext(
  orderId: string,
  context: CheckoutPurchaseTrackingContext
) {
  if (!orderId) return;
  try {
    await AsyncStorage.setItem(
      `${REDVAULT_CONTEXT_PREFIX}${orderId}`,
      JSON.stringify(context)
    );
  } catch (error) {
    log.error('Failed to persist REDVAULT purchase tracking context:', error);
  }
}

export async function loadRedvaultPurchaseTrackingContext(orderId: string) {
  if (!orderId) return null;
  try {
    const raw = await AsyncStorage.getItem(
      `${REDVAULT_CONTEXT_PREFIX}${orderId}`
    );
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object'
      ? (parsed as CheckoutPurchaseTrackingContext)
      : null;
  } catch {
    return null;
  }
}

export async function clearRedvaultPurchaseTrackingContext(orderId: string) {
  if (!orderId) return;
  await AsyncStorage.removeItem(`${REDVAULT_CONTEXT_PREFIX}${orderId}`);
}

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
