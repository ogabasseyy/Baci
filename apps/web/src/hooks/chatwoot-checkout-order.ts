import { buildCheckoutOrderRequest } from '@/components/storefront/ogabassey/pages/checkout/build-checkout-order-request';
import type { CartItem } from '@/hooks/cart';
import {
  reviewedCheckoutItems,
  type SharedCartCheckoutReview,
} from '@/hooks/cart/shared-cart-checkout-client';
import { buildCheckoutOrderItems } from '@/lib/checkout/build-order-items';
import { calculateOrderTotals } from '@/lib/checkout/calculate-order-totals';
import {
  calculateCartItemSubtotal,
  calculateCartTotal,
} from '@/lib/checkout/cart-entitlement-sanitizer';
import type { ChatwootCheckoutDeliveryResult } from './chatwoot-checkout-delivery';
import type { ChatwootCheckoutFailureCode } from './chatwoot-checkout-result';

type ResolvedDelivery = Extract<ChatwootCheckoutDeliveryResult, { ok: true }>;

export interface ChatwootCheckoutOrderInput {
  review: SharedCartCheckoutReview;
  display: readonly CartItem[];
  delivery: ResolvedDelivery;
  customer: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
  };
  /** Fractional VAT rate (0.075), or 0 when the merchant is not registered. */
  taxRate: number;
}

/**
 * Returns the reviewed order items, or null when the reviewed lines no longer
 * match the display cart (unavailable line, moved price, missing shell). The
 * store checkout applies the same gates before it submits.
 */
export function reviewedChatwootCheckoutItems(
  review: SharedCartCheckoutReview,
  display: readonly CartItem[]
): CartItem[] | null {
  if (
    review.currency !== 'NGN' ||
    review.unavailableCount > 0 ||
    review.lines.some((line) => !line.available)
  ) {
    return null;
  }
  const items = reviewedCheckoutItems(display, review);
  if (
    !items ||
    Math.abs(
      review.subtotalMinor / 100 - calculateCartItemSubtotal(items, true)
    ) > 0.005
  ) {
    return null;
  }
  return items;
}

/** The order body, built by the same pure builders the store checkout uses. */
export function buildChatwootCheckoutOrderRequest(
  input: ChatwootCheckoutOrderInput,
  items: CartItem[]
) {
  const { review, delivery, customer } = input;
  const shipping = delivery.quote.price;
  return buildCheckoutOrderRequest({
    merchantId: review.merchantId,
    items: buildCheckoutOrderItems(items),
    paymentMethod: 'bank_transfer',
    acceptsMarketing: false,
    customer: {
      name: `${customer.firstName} ${customer.lastName}`.trim(),
      email: customer.email,
      phone: customer.phone,
    },
    money: {
      subtotal: calculateCartTotal(items, true),
      shipping,
      // Parity snapshot only: the order API recomputes per-line VAT.
      tax: calculateOrderTotals({
        subtotal: calculateCartItemSubtotal(items, true),
        shippingFee: shipping,
        taxRate: input.taxRate,
      }).taxAmount,
      giftWrapping: 0,
      discountAmount: 0,
      discountCode: null,
      useWalletCredit: false,
      walletAmount: 0,
    },
    delivery: {
      method: delivery.method,
      airportType: 'delivery',
      quoteMatchesMethod: true,
      selectedQuoteId: String(delivery.quote.id),
      merchantRateId: delivery.merchantRateId,
      provider: null,
      address: delivery.address,
    },
    sharedCart: {
      cart_id: review.cartId,
      checkout_session_id: review.checkoutSessionId,
      checkout_generation: review.generation,
      cart_version: review.cartVersion,
    },
  });
}

function toHex(buffer: ArrayBuffer) {
  return Array.from(new Uint8Array(buffer), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');
}

/**
 * Deterministic from the widget request id and the authorized cart, so a
 * widget retry replays the same prepared session and the same order instead of
 * creating a second one. Both fit the 16-128 byte key bound of /api/orders.
 */
export async function deriveChatwootCheckoutKeys(
  requestId: string,
  cartId: string
): Promise<{ idempotencyKey: string; operationId: string } | null> {
  try {
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(`chatwoot-checkout:${requestId}:${cartId}`)
    );
    const hex = toHex(digest);
    return { idempotencyKey: `cw-chk-${hex}`, operationId: `cw-op-${hex}` };
  } catch {
    return null;
  }
}

export interface ChatwootCheckoutCreatedOrder {
  orderId: string;
  orderNumber: string;
  trackingToken: string | null;
  amountDueMajor: number;
  currency: string | null;
}

export type ChatwootCheckoutOrderOutcome =
  | { ok: true; order: ChatwootCheckoutCreatedOrder }
  | { ok: false; code: ChatwootCheckoutFailureCode };

const DELIVERY_REJECTION_CODES = new Set([
  'SHIPPING_FEE_MISMATCH',
  'SHIPPING_RATE_INVALID',
  'SHIPPING_RATE_ZONE_MISMATCH',
  'SHIPPING_RATE_CONDITION_UNMET',
]);
const CART_REJECTION_CODES = new Set([
  'CHECKOUT_IDEMPOTENCY_CONFLICT',
  'CHECKOUT_ORDER_NOT_REUSABLE',
]);

function failureCode(body: unknown): ChatwootCheckoutFailureCode {
  const code =
    body && typeof body === 'object'
      ? (body as { code?: unknown }).code
      : undefined;
  if (typeof code !== 'string') return 'order_failed';
  if (DELIVERY_REJECTION_CODES.has(code)) return 'delivery_unavailable';
  if (CART_REJECTION_CODES.has(code)) return 'cart_changed';
  return 'order_failed';
}

/** POSTs the order with the derived key; only bounded fields leave this module. */
export async function postChatwootCheckoutOrder(
  orderRequest: ReturnType<typeof buildChatwootCheckoutOrderRequest>,
  idempotencyKey: string
): Promise<ChatwootCheckoutOrderOutcome> {
  let response: Response;
  try {
    response = await fetch('/api/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(orderRequest),
    });
  } catch {
    return { ok: false, code: 'order_failed' };
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) return { ok: false, code: failureCode(body) };

  const result = body as {
    order?: {
      id?: unknown;
      order_number?: unknown;
      total?: unknown;
      tracking_token?: unknown;
      currency?: unknown;
    };
    amountDueToGateway?: unknown;
  } | null;
  const order = result?.order;
  const amountDue = result?.amountDueToGateway ?? order?.total;
  if (
    !order ||
    typeof order.id !== 'string' ||
    typeof order.order_number !== 'string' ||
    typeof amountDue !== 'number' ||
    !Number.isFinite(amountDue) ||
    amountDue <= 0
  ) {
    return { ok: false, code: 'order_failed' };
  }
  return {
    ok: true,
    order: {
      orderId: order.id,
      orderNumber: order.order_number,
      trackingToken:
        typeof order.tracking_token === 'string' && order.tracking_token.trim()
          ? order.tracking_token
          : null,
      amountDueMajor: amountDue,
      currency:
        typeof order.currency === 'string'
          ? order.currency.trim().toUpperCase()
          : null,
    },
  };
}
