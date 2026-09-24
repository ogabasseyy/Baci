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
