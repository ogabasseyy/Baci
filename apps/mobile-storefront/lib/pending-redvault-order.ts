import AsyncStorage from '@react-native-async-storage/async-storage';
import { CHECKOUT_PENDING_REDVAULT_ORDER_STORAGE_KEY } from '@/config/checkout-storage';

export type PersistedRedvaultOrder = {
  orderId: string;
  checkoutGeneration: string;
  createdAt: string;
};

export type ValidatePersistedRedvaultOrder = (
  orderId: string
) => Promise<unknown>;

// Mirror of the web pending-order resolver: these server states mean the
// fenced order can no longer capture, so the fence may clear and checkout
// may proceed.
const TERMINAL_PAYMENT_STATUSES = new Set([
  'paid',
  'bnpl_approved',
  'refunded',
]);

const TERMINAL_SHIPPING_STATUSES = new Set([
  'processing',
  'shipped',
  'out_for_delivery',
  'delivered',
  'completed',
  'cancelled',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readRecord(record: unknown): PersistedRedvaultOrder | null {
  if (!isRecord(record)) return null;
  if (
    typeof record.orderId !== 'string' ||
    typeof record.checkoutGeneration !== 'string' ||
    typeof record.createdAt !== 'string'
  ) {
    return null;
  }
  return {
    orderId: record.orderId,
    checkoutGeneration: record.checkoutGeneration,
    createdAt: record.createdAt,
  };
}

export async function readPersistedRedvaultOrder(): Promise<PersistedRedvaultOrder | null> {
  const raw = await AsyncStorage.getItem(
    CHECKOUT_PENDING_REDVAULT_ORDER_STORAGE_KEY
  );
  if (!raw) return null;
  try {
    return readRecord(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

export async function persistPendingRedvaultOrder(
  record: PersistedRedvaultOrder
): Promise<void> {
  await AsyncStorage.setItem(
    CHECKOUT_PENDING_REDVAULT_ORDER_STORAGE_KEY,
    JSON.stringify(record)
  );
}

export async function clearPersistedRedvaultOrder(): Promise<void> {
  await AsyncStorage.removeItem(CHECKOUT_PENDING_REDVAULT_ORDER_STORAGE_KEY);
}

export type ResolvePersistedRedvaultOrderResult =
  | { readonly blocked: false }
  | { readonly blocked: true; readonly orderId: string };

/**
 * Resolves a persisted REDVAULT fence before a non-REDVAULT submit. The
 * REDVAULT lane uses a suffixed idempotency identity, so without this check
 * a relaunched app would open a second order while the first still fences
 * inventory (and may capture). Returns blocked while the server order is
 * unresolved; clears and releases once it is terminal. A record from a
 * rotated generation is inert: it can neither match this checkout's
 * identity nor be revived, so it clears without blocking. Validation
 * failures throw, failing closed like the web resolver.
 */
export async function resolvePersistedRedvaultOrder({
  checkoutGeneration,
  validateOrder,
}: {
  checkoutGeneration: string;
  validateOrder: ValidatePersistedRedvaultOrder;
}): Promise<ResolvePersistedRedvaultOrderResult> {
  const persisted = await readPersistedRedvaultOrder();
  if (!persisted) return { blocked: false };
  if (persisted.checkoutGeneration !== checkoutGeneration) {
    await clearPersistedRedvaultOrder();
    return { blocked: false };
  }
  const validated = await validateOrder(persisted.orderId);
  const orderState =
    isRecord(validated) && isRecord(validated.order) ? validated.order : null;
  const paymentStatus =
    typeof orderState?.payment_status === 'string'
      ? orderState.payment_status
      : '';
  const shippingStatus =
    typeof orderState?.shipping_status === 'string'
      ? orderState.shipping_status
      : '';
  if (
    TERMINAL_PAYMENT_STATUSES.has(paymentStatus) ||
    TERMINAL_SHIPPING_STATUSES.has(shippingStatus)
  ) {
    await clearPersistedRedvaultOrder();
    return { blocked: false };
  }
  return { blocked: true, orderId: persisted.orderId };
}
