import type {
  FencedCheckoutOrderIdentity,
  PendingCheckoutOrderSnapshot,
  ResolvePendingCheckoutOrderResult,
} from './pending-checkout-order';

const NON_REUSABLE_SHIPPING_STATUSES = new Set([
  'processing',
  'shipped',
  'out_for_delivery',
  'delivered',
  'completed',
  'cancelled',
]);
const NON_REUSABLE_PAYMENT_STATUSES = new Set([
  'paid',
  'bnpl_approved',
  'refunded',
]);

// Terminal, but money committed: clearing the fence is correct, yet the
// caller must NOT recreate from the unchanged cart — that would charge the
// shopper twice for the same merchandise.
const PAID_PAYMENT_STATUSES = new Set(['paid', 'bnpl_approved']);
const PAID_SHIPPING_STATUSES = new Set([
  'processing',
  'shipped',
  'out_for_delivery',
  'delivered',
  'completed',
]);

type FencedOrderState = {
  id?: string;
  order_number?: string;
  total?: number | string;
  payment_status?: string;
  shipping_status?: string;
};

export function isPaidOrderState(order: FencedOrderState): boolean {
  // A full refund flips payment_status to 'refunded' while leaving a
  // 'processing' shipping_status behind: refunded money must never read
  // as paid, or fence recovery routes to a dead success page.
  if ((order.payment_status || '') === 'refunded') return false;
  return (
    PAID_PAYMENT_STATUSES.has(order.payment_status || '') ||
    PAID_SHIPPING_STATUSES.has(order.shipping_status || '')
  );
}

export function isNonReusableOrderState(order: FencedOrderState): boolean {
  return (
    !order?.id ||
    NON_REUSABLE_PAYMENT_STATUSES.has(order.payment_status || '') ||
    NON_REUSABLE_SHIPPING_STATUSES.has(order.shipping_status || '')
  );
}

export function paidOrderIdentity(
  snapshot: PendingCheckoutOrderSnapshot,
  order: FencedOrderState
): FencedCheckoutOrderIdentity {
  return {
    orderId: snapshot.orderId,
    orderNumber: order.order_number || snapshot.orderNumber,
    trackingToken: snapshot.trackingToken,
    customerEmail: snapshot.customerEmail,
  };
}

/**
 * Validates a stored order against the server through the tracking-token
 * fenced lookup. Returns the order state, or null when the server no longer
 * has the row (safe to clear and recreate). Any other failure throws so the
 * caller fails closed instead of opening a second order blind.
 */
export async function fetchFencedOrderState({
  fetchImpl,
  merchantSlug,
  pendingOrder,
}: {
  fetchImpl: typeof fetch;
  merchantSlug?: string | null;
  pendingOrder: PendingCheckoutOrderSnapshot;
}): Promise<FencedOrderState | null> {
  const fencedParams = new URLSearchParams({
    tracking_token: pendingOrder.trackingToken || '',
  });
  if (merchantSlug) {
    fencedParams.set('merchant_slug', merchantSlug);
  }
  const fencedResponse = await fetchImpl(
    `/api/storefront/orders/${pendingOrder.orderId}?${fencedParams.toString()}`
  );
  if (!fencedResponse.ok) {
    if (shouldClearStoredOrder(fencedResponse.status)) {
      return null;
    }
    throw new Error('Failed to validate pending checkout order');
  }
  return (await fencedResponse.json()) as FencedOrderState;
}

export function shouldClearStoredOrder(status: number): boolean {
  return status === 404;
}

/**
 * Resolves the REDVAULT fence for a checkout submission. Returns null when
 * neither the selected method nor the stored order touches the REDVAULT
 * lane, so the caller falls through to the ordinary pending-order flow.
 * Every other path returns a verdict: validate-then-clear, route to a paid
 * order, or surface a still-pending order the caller must cancel first.
 */
export async function resolveRedvaultCheckoutFence({
  fetchImpl = fetch,
  merchantSlug,
  paymentMethod,
  pendingOrder,
}: {
  fetchImpl?: typeof fetch;
  merchantSlug?: string | null;
  paymentMethod: string;
  pendingOrder: PendingCheckoutOrderSnapshot | null;
}): Promise<ResolvePendingCheckoutOrderResult | null> {
  if (paymentMethod === 'uba_redvault') {
    if (!pendingOrder) {
      return { reusableOrder: null, clearStoredOrder: false };
    }
    if (pendingOrder.paymentMethod === 'uba_redvault') {
      // Same-lane retry after a reload or a return from Paystack: validate
      // the stored REDVAULT order against the server before clearing it. A
      // changed cart or delivery selection produces a new idempotency key,
      // so clearing blindly would open a second inventory-reserving order
      // while the old hosted URL may still capture. A still-pending order
      // is surfaced so the caller cancels it first; an initializing order
      // blocks through the cancel 409 instead of duplicating.
      if (!pendingOrder.trackingToken || !pendingOrder.orderId) {
        return { reusableOrder: null, clearStoredOrder: true };
      }
      const sameLaneOrder = await fetchFencedOrderState({
        fetchImpl,
        merchantSlug,
        pendingOrder,
      });
      if (!sameLaneOrder) {
        return { reusableOrder: null, clearStoredOrder: true };
      }
      if (isPaidOrderState(sameLaneOrder)) {
        return {
          reusableOrder: null,
          clearStoredOrder: true,
          paidOrder: paidOrderIdentity(pendingOrder, sameLaneOrder),
        };
      }
      if (isNonReusableOrderState(sameLaneOrder)) {
        return { reusableOrder: null, clearStoredOrder: true };
      }
      return {
        reusableOrder: null,
        clearStoredOrder: false,
        redvaultPendingOrder: {
          orderId: pendingOrder.orderId,
          orderNumber: sameLaneOrder.order_number || pendingOrder.orderNumber,
          trackingToken: pendingOrder.trackingToken,
          customerEmail: pendingOrder.customerEmail,
        },
      };
    }
    // Entering the REDVAULT lane with a stored ordinary order: the REDVAULT
    // fingerprint is separately prefixed, so without this check the next
    // submission would take a different idempotency identity and create a
    // second inventory-reserving order while the first hosted payment may
    // remain payable. Surface the ordinary order so the caller cancels it
    // before starting the REDVAULT lane.
    if (!pendingOrder.trackingToken || !pendingOrder.orderId) {
      return { reusableOrder: null, clearStoredOrder: true };
    }
    const enteringOrder = await fetchFencedOrderState({
      fetchImpl,
      merchantSlug,
      pendingOrder,
    });
    if (!enteringOrder) {
      return { reusableOrder: null, clearStoredOrder: true };
    }
    if (isPaidOrderState(enteringOrder)) {
      return {
        reusableOrder: null,
        clearStoredOrder: true,
        paidOrder: paidOrderIdentity(pendingOrder, enteringOrder),
      };
    }
    if (isNonReusableOrderState(enteringOrder)) {
      return { reusableOrder: null, clearStoredOrder: true };
    }
    return {
      reusableOrder: null,
      clearStoredOrder: false,
      ordinaryPendingOrder: {
        orderId: pendingOrder.orderId,
        orderNumber: enteringOrder.order_number || pendingOrder.orderNumber,
        trackingToken: pendingOrder.trackingToken,
        customerEmail: pendingOrder.customerEmail,
      },
    };
  }
  if (pendingOrder?.paymentMethod === 'uba_redvault') {
    // Leaving REDVAULT for another method: validate the server order first.
    // Clearing blindly could open a second order while the capture approves.
    if (!pendingOrder.trackingToken || !pendingOrder.orderId) {
      return { reusableOrder: null, clearStoredOrder: true };
    }
    const fencedOrder = await fetchFencedOrderState({
      fetchImpl,
      merchantSlug,
      pendingOrder,
    });
    if (!fencedOrder) {
      return { reusableOrder: null, clearStoredOrder: true };
    }
    // A paid fence clears but must NOT recreate: the webhook may have marked
    // the order paid after the browser closed, so the cart is unchanged and
    // recreating would charge the shopper twice for the same merchandise.
    if (isPaidOrderState(fencedOrder)) {
      return {
        reusableOrder: null,
        clearStoredOrder: true,
        paidOrder: paidOrderIdentity(pendingOrder, fencedOrder),
      };
    }
    if (isNonReusableOrderState(fencedOrder)) {
      return { reusableOrder: null, clearStoredOrder: true };
    }
    return {
      reusableOrder: null,
      clearStoredOrder: false,
      redvaultUnresolved: true,
    };
  }
  return null;
}
