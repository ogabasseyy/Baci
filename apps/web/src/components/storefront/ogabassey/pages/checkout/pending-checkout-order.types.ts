import type { RedvaultQuoteSummary } from './components/redvault/RedvaultPaymentOption';
import type { RedvaultPreparedOrder } from './handlers/redvault-prepared-order-submit';

export interface PendingCheckoutOrderItem {
  product_id: string;
  name: string;
  quantity: number;
  price: number;
  variantId?: string;
  variantAttributes?: Record<string, string>;
  has_assurance?: boolean;
  assurance_fee?: number;
  // Exact condition-offer identity: swapping same-priced offers for one
  // product must not reuse the pending order built for the other offer.
  offer_id?: string;
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
  /** Server-confirmed local debit, retained across balance refresh and retries. */
  walletAmountUsed?: number;
  /** Committed order failed store-credit projection and must stay fenced. */
  fundingUnresolved?: boolean;
  /** Retryable contention (STORE_CREDIT_RETRY_REQUIRED); same-order recovery allowed. */
  fundingRetryable?: boolean;
  orderId: string;
  orderNumber?: string;
  trackingToken?: string;
  merchantId: string;
  customerEmail: string;
  customerPhone: string;
  checkoutFingerprint: string;
  amountDueToGateway: number;
  createdAt: string;
  /** Local presentation recovery for a reviewed, completed shared cart. */
  redvaultReview?: {
    ready: RedvaultPreparedOrder;
    summary: RedvaultQuoteSummary;
    recoveryFence?: { merchantSlug: string | null; epoch: string | null };
  };
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
  /**
   * Customer email persisted with the stored order. Replay and recovery
   * paths must use this — not mutable form state — because the payment
   * snapshot lookup rejects an email that disagrees with the order.
   */
  customerEmail: string;
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
  /**
   * A same-lane REDVAULT order is still pending on the server (reload or
   * return from Paystack with changed inputs). The caller must cancel it
   * before submitting, or a new idempotency key opens a second
   * inventory-reserving order while the old hosted URL may still capture.
   */
  redvaultPendingOrder?: FencedCheckoutOrderIdentity;
}
