import { fetchWithCsrf } from '@/lib/api-client';
import { checkoutFingerprintsMatch } from './checkout-fingerprints-match';
import type { PaymentMethod } from './types';

export { buildPendingCheckoutFingerprint } from './checkout-fingerprint';

export const CHECKOUT_PENDING_ORDER_STORAGE_KEY =
  'storefront-checkout-pending-order';

export interface PendingCheckoutOrderItem {
  product_id: string;
  name: string;
  quantity: number;
  price: number;
  variantId?: string;
  variantAttributes?: Record<string, string>;
  has_assurance?: boolean;
  assurance_fee?: number;
}

export interface PendingCheckoutFingerprintInput {
  merchantId: string;
  customerEmail: string;
  customerName: string;
  customerPhone: string;
  deliveryMethod: string;
  shippingFee: number;
  // B3: pickup/airport flows pass null here (no third-party provider);
  // door delivery passes the carrier name from the selected quote.
  // Fingerprint hashing normalizes null/undefined uniformly.
  shippingProvider: string | null;
  selectedQuoteId?: string;
  shippingAddress: {
    address: string;
    city: string;
    state: string;
    phone?: string;
  };
  items: PendingCheckoutOrderItem[];
  useWalletCredit: boolean;
  walletAmountUsed: number;
  // Applied discount code identity: changing/removing it must produce a
  // different fingerprint so a reused pending order can't drop the discount.
  discountCode?: string | null;
  // Gift wrapping fee: toggling wrapping must not reuse a prior pending order
  // with a different amountDueToGateway / wrapping choice.
  giftWrappingCost?: number;
}

export interface PendingCheckoutOrderSnapshot {
  paymentMethod?: string;
  orderId: string;
  orderNumber?: string;
  trackingToken?: string;
  merchantId: string;
  customerEmail: string;
  customerPhone: string;
  checkoutFingerprint: string;
  amountDueToGateway: number;
  createdAt: string;
}

export interface ReusedCheckoutOrder {
  id: string;
  order_number?: string;
  tracking_token?: string;
}

export interface ResolvePendingCheckoutOrderOptions {
  pendingOrder: PendingCheckoutOrderSnapshot | null;
  merchantId: string;
  merchantSlug?: string | null;
  customerEmail: string;
  checkoutFingerprint: string;
  paymentMethod: string;
  // B3: pickup/airport flows pass null here (no third-party provider);
  // door delivery passes the carrier name from the selected quote.
  // Fingerprint hashing normalizes null/undefined uniformly.
  shippingProvider: string | null;
  selectedQuoteId?: string;
  // Bare merchant rate uuid (`merchant_shipping_rates.id`), forwarded for a
  // merchant-rate reuse so the reuse route can re-stamp fulfillment metadata
  // when the original stamp failed (R14-3). Distinct from selectedQuoteId,
  // which stays omitted for merchant rates (its `mrate_` id is not a uuid).
  shippingRateId?: string | null;
  fetchImpl?: typeof fetch;
}

export interface FencedCheckoutOrderIdentity {
  orderId: string;
  orderNumber?: string;
  trackingToken?: string;
}

export interface ResolvePendingCheckoutOrderResult {
  reusableOrder: {
    order: ReusedCheckoutOrder;
    amountDueToGateway: number;
  } | null;
  clearStoredOrder: boolean;
  /** Stored REDVAULT order still unresolved: do not open a second order with another method. */
  redvaultUnresolved?: boolean;
  /**
   * The fenced order already committed money. The caller must clear the cart
   * (and the fence) and route to the completed order instead of creating
   * another order from the unchanged cart.
   */
  paidOrder?: FencedCheckoutOrderIdentity;
  /**
   * An ordinary pending order blocks REDVAULT entry. The caller must cancel
   * it (it may still hold a payable hosted payment) before starting the
   * REDVAULT lane.
   */
  ordinaryPendingOrder?: FencedCheckoutOrderIdentity;
}

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

function normalizeText(value: string | null | undefined): string {
  return (value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Normalizes checkout payment methods to the persisted order values used for
 * pending-order reuse. Card-backed gateways (`paystack`, `korapay`) are stored
 * as `card`, methods with distinct downstream handling are persisted as-is, and
 * anything else falls back to `pod` for pay-on-delivery compatibility.
 */
export function normalizeOrderPaymentMethod(
  paymentMethod: PaymentMethod
): string {
  if (paymentMethod === 'paystack' || paymentMethod === 'korapay') {
    return 'card';
  }

  if (
    paymentMethod === 'uba_redvault' ||
    paymentMethod === 'klump' ||
    paymentMethod === 'credit_direct' ||
    paymentMethod === 'credpal' ||
    paymentMethod === 'invoice' ||
    paymentMethod === 'juicyway' ||
    paymentMethod === 'bank_transfer' ||
    paymentMethod === 'payforme' ||
    paymentMethod === 'paypal'
  ) {
    return paymentMethod;
  }

  return 'pod';
}

function shouldClearStoredOrder(status: number): boolean {
  return status === 404;
}

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

function isPaidOrderState(order: FencedOrderState): boolean {
  return (
    PAID_PAYMENT_STATUSES.has(order.payment_status || '') ||
    PAID_SHIPPING_STATUSES.has(order.shipping_status || '')
  );
}

function isNonReusableOrderState(order: FencedOrderState): boolean {
  return (
    !order?.id ||
    NON_REUSABLE_PAYMENT_STATUSES.has(order.payment_status || '') ||
    NON_REUSABLE_SHIPPING_STATUSES.has(order.shipping_status || '')
  );
}

function paidOrderIdentity(
  snapshot: PendingCheckoutOrderSnapshot,
  order: FencedOrderState
): FencedCheckoutOrderIdentity {
  return {
    orderId: snapshot.orderId,
    orderNumber: order.order_number || snapshot.orderNumber,
    trackingToken: snapshot.trackingToken,
  };
}

/**
 * Validates a stored order against the server through the tracking-token
 * fenced lookup. Returns the order state, or null when the server no longer
 * has the row (safe to clear and recreate). Any other failure throws so the
 * caller fails closed instead of opening a second order blind.
 */
async function fetchFencedOrderState({
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

export async function resolvePendingCheckoutOrder({
  pendingOrder,
  merchantId,
  merchantSlug,
  customerEmail,
  checkoutFingerprint,
  paymentMethod,
  shippingProvider,
  selectedQuoteId,
  shippingRateId,
  fetchImpl = fetch,
}: ResolvePendingCheckoutOrderOptions): Promise<ResolvePendingCheckoutOrderResult> {
  if (paymentMethod === 'uba_redvault') {
    // Entering the REDVAULT lane with a stored ordinary order: the REDVAULT
    // fingerprint is separately prefixed, so without this check the next
    // submission would take a different idempotency identity and create a
    // second inventory-reserving order while the first hosted payment may
    // remain payable. Surface the ordinary order so the caller cancels it
    // before starting the REDVAULT lane.
    if (!pendingOrder || pendingOrder.paymentMethod === 'uba_redvault') {
      return {
        reusableOrder: null,
        clearStoredOrder: pendingOrder?.paymentMethod === 'uba_redvault',
      };
    }
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
  if (!pendingOrder) {
    return { reusableOrder: null, clearStoredOrder: false };
  }

  if (
    !pendingOrder.trackingToken ||
    pendingOrder.merchantId !== merchantId ||
    normalizeText(pendingOrder.customerEmail) !==
      normalizeText(customerEmail) ||
    !checkoutFingerprintsMatch(
      pendingOrder.checkoutFingerprint,
      checkoutFingerprint
    )
  ) {
    return { reusableOrder: null, clearStoredOrder: true };
  }

  const existingOrder = await fetchFencedOrderState({
    fetchImpl,
    merchantSlug,
    pendingOrder,
  });

  if (!existingOrder) {
    return { reusableOrder: null, clearStoredOrder: true };
  }

  // Same paid-fence rule as the REDVAULT branch: the stored order committed
  // money, so route to it instead of recreating from the unchanged cart.
  if (isPaidOrderState(existingOrder)) {
    return {
      reusableOrder: null,
      clearStoredOrder: true,
      paidOrder: paidOrderIdentity(pendingOrder, existingOrder),
    };
  }

  if (isNonReusableOrderState(existingOrder)) {
    return { reusableOrder: null, clearStoredOrder: true };
  }

  const mutationFetch = fetchImpl === fetch ? fetchWithCsrf : fetchImpl;

  const reuseResponse = await mutationFetch('/api/orders/reuse', {
    method: 'POST',
    body: JSON.stringify({
      order_id: pendingOrder.orderId,
      tracking_token: pendingOrder.trackingToken,
      merchant_id: merchantId,
      customer_email: customerEmail,
      payment_method: paymentMethod,
      shipping_provider: shippingProvider,
      selected_quote_id: selectedQuoteId || undefined,
      shipping_rate_id: shippingRateId || undefined,
    }),
  });

  if (!reuseResponse.ok) {
    if (shouldClearStoredOrder(reuseResponse.status)) {
      return { reusableOrder: null, clearStoredOrder: true };
    }

    throw new Error('Failed to reopen pending checkout order');
  }

  const reusedOrderData = (await reuseResponse.json()) as {
    order?: ReusedCheckoutOrder;
  };

  if (!reusedOrderData.order?.id) {
    return { reusableOrder: null, clearStoredOrder: true };
  }

  return {
    reusableOrder: {
      order: reusedOrderData.order,
      amountDueToGateway:
        pendingOrder.amountDueToGateway ?? Number(existingOrder.total || 0),
    },
    clearStoredOrder: false,
  };
}
