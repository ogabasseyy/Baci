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

export interface ResolvePendingCheckoutOrderResult {
  reusableOrder: {
    order: ReusedCheckoutOrder;
    amountDueToGateway: number;
  } | null;
  clearStoredOrder: boolean;
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

  const orderParams = new URLSearchParams({
    tracking_token: pendingOrder.trackingToken,
  });

  if (merchantSlug) {
    orderParams.set('merchant_slug', merchantSlug);
  }

  const orderResponse = await fetchImpl(
    `/api/storefront/orders/${pendingOrder.orderId}?${orderParams.toString()}`
  );

  if (!orderResponse.ok) {
    if (shouldClearStoredOrder(orderResponse.status)) {
      return { reusableOrder: null, clearStoredOrder: true };
    }

    throw new Error('Failed to validate pending checkout order');
  }

  const existingOrder = (await orderResponse.json()) as {
    id?: string;
    total?: number | string;
    payment_status?: string;
    shipping_status?: string;
  };

  if (
    !existingOrder?.id ||
    NON_REUSABLE_PAYMENT_STATUSES.has(existingOrder.payment_status || '') ||
    NON_REUSABLE_SHIPPING_STATUSES.has(existingOrder.shipping_status || '')
  ) {
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
