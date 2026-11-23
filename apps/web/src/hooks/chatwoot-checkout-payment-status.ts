import { isChatwootCheckoutPaymentWindowOpen } from './chatwoot-checkout-payment-window';
import type { ChatwootCheckoutStatusResult } from './chatwoot-checkout-result';

const TERMINAL_UNPAID_PAYMENT = new Set([
  'failed',
  'cancelled',
  'canceled',
  'refunded',
  'expired',
]);

/**
 * Polls the order, not a gateway reference: the reference issued with a
 * dedicated account is generated locally and Paystack never sees it, so only
 * the order's own payment status (set by the transfer webhook) is
 * authoritative. This is the poll the store checkout's transfer modal uses.
 */
export async function readChatwootCheckoutPaymentStatus(input: {
  requestId: string;
  orderId: string;
  trackingToken: string | null;
  merchantSlug: string;
  issuedAt: number;
  expiresAt?: number;
}): Promise<ChatwootCheckoutStatusResult> {
  const { requestId } = input;
  const unavailable = { requestId, status: 'unavailable' as const };
  if (!input.trackingToken) return unavailable;
  try {
    const response = await fetch(
      `/api/storefront/orders/track-order?token=${encodeURIComponent(input.trackingToken)}&merchant_slug=${encodeURIComponent(input.merchantSlug)}`,
      { cache: 'no-store' }
    );
    if (!response.ok) return unavailable;
    const body: unknown = await response.json().catch(() => null);
    const order = (
      body as {
        order?: {
          id?: unknown;
          payment_status?: unknown;
          shipping_status?: unknown;
        };
      } | null
    )?.order;
    // A token resolves whichever order it belongs to: bind the verdict to the
    // order this chat created.
    if (!order || order.id !== input.orderId) return unavailable;
    if (order.payment_status === 'paid') return { requestId, status: 'paid' };
    if (
      (typeof order.payment_status === 'string' &&
        TERMINAL_UNPAID_PAYMENT.has(order.payment_status)) ||
      // The tracking route passes the raw value through; older orders spell
      // it the American way.
      order.shipping_status === 'cancelled' ||
      order.shipping_status === 'canceled' ||
      !isChatwootCheckoutPaymentWindowOpen(
        input.issuedAt,
        Date.now(),
        input.expiresAt
      )
    ) {
      return unavailable;
    }
    return { requestId, status: 'pending' };
  } catch {
    return unavailable;
  }
}
