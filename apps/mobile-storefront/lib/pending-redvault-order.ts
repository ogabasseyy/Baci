import AsyncStorage from '@react-native-async-storage/async-storage';
import { CHECKOUT_PENDING_REDVAULT_ORDER_STORAGE_KEY } from '@/config/checkout-storage';

export type PersistedRedvaultOrder = {
  orderId: string;
  checkoutGeneration: string;
  createdAt: string;
  /**
   * Order-bound proof for sessionless validation/cancellation. Records
   * written before this field existed stay valid; guests holding one cannot
   * resolve the fence and fail closed until it clears another way.
   */
  trackingToken?: string;
  /**
   * Customer email the fenced order was created with. The server requires
   * replayed initializations to match the order snapshot, so the mutable
   * form email must not be submitted when it changed after an app restart.
   * Records written before this field existed replay with the form email.
   */
  customerEmail?: string;
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

// Terminal, but money committed: the fence clears yet checkout must NOT
// resume with the unchanged cart — that would open a second order for
// merchandise already paid for.
const PAID_PAYMENT_STATUSES = new Set(['paid', 'bnpl_approved']);
// Shipping states that prove fulfillment progressed. They are NOT proof of
// payment on their own (see below), but a line that reached them without
// payment proof or a terminal unpaid state stays blocked: its hosted
// attempt may still capture.
const PROGRESSED_SHIPPING_STATUSES = new Set([
  'processing',
  'shipped',
  'out_for_delivery',
  'delivered',
  'completed',
]);
const TERMINAL_UNPAID_PAYMENT_STATUSES = new Set([
  'refunded',
  'cancelled',
  'canceled',
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
    ...(typeof record.trackingToken === 'string' && record.trackingToken
      ? { trackingToken: record.trackingToken }
      : {}),
    ...(typeof record.customerEmail === 'string' && record.customerEmail
      ? { customerEmail: record.customerEmail }
      : {}),
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

/**
 * Clears the persisted fence, retrying transient storage failures. A paid
 * fence left behind by a failed removal hijacks the next checkout (the
 * resolver reports it as paidOrderId and the new cart is discarded), so
 * post-verification cleanup retries before degrading to best-effort.
 */
export async function clearPersistedRedvaultOrderWithRetry(
  attempts = 3
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await clearPersistedRedvaultOrder();
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

export type ResolvePersistedRedvaultOrderResult =
  | { readonly blocked: false; readonly paidOrderId?: string }
  | { readonly blocked: true; readonly orderId: string };

/**
 * Resolves a persisted REDVAULT fence before a non-REDVAULT submit. The
 * REDVAULT lane uses a suffixed idempotency identity, so without this check
 * a relaunched app would open a second order while the first still fences
 * inventory (and may capture). Returns blocked while the server order is
 * unresolved; clears and releases once it is terminal. A paid fence clears
 * but reports paidOrderId so the caller routes to the completed order
 * instead of resuming checkout with the unchanged cart. The old order is
 * validated against the server even when the cart generation rotated: its
 * Paystack URL can still capture funds, so the fence clears only once the
 * server order is terminal. Validation failures throw, failing closed like
 * the web resolver.
 */
export async function resolvePersistedRedvaultOrder({
  validateOrder,
}: {
  validateOrder: ValidatePersistedRedvaultOrder;
}): Promise<ResolvePersistedRedvaultOrderResult> {
  const persisted = await readPersistedRedvaultOrder();
  if (!persisted) return { blocked: false };
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
  // Payment proof only: merchant confirmation moves shipping_status to
  // 'processing' without checking payment status, so shipping progression
  // alone would route an unpaid order to the completed-order flow. A full
  // refund flips payment_status to 'refunded' while leaving a 'processing'
  // shipping_status behind: refunded money must never read as paid, or
  // fence recovery routes to a dead success page.
  if (PAID_PAYMENT_STATUSES.has(paymentStatus)) {
    await clearPersistedRedvaultOrder();
    return { blocked: false, paidOrderId: persisted.orderId };
  }
  // Fulfillment progressed without payment proof and without a terminal
  // unpaid state (refunded/cancelled clear below): the hosted attempt may
  // still be live, so the fence stays up and checkout stays blocked
  // instead of clearing into a duplicate order.
  const progressedButUnpaid =
    PROGRESSED_SHIPPING_STATUSES.has(shippingStatus) &&
    !PAID_PAYMENT_STATUSES.has(paymentStatus) &&
    !TERMINAL_UNPAID_PAYMENT_STATUSES.has(paymentStatus);
  if (
    !progressedButUnpaid &&
    (TERMINAL_PAYMENT_STATUSES.has(paymentStatus) ||
      TERMINAL_SHIPPING_STATUSES.has(shippingStatus))
  ) {
    await clearPersistedRedvaultOrder();
    return { blocked: false };
  }
  return { blocked: true, orderId: persisted.orderId };
}
