import type { OrderCompletionContext } from './payment-gateway-order-completion';

/**
 * Success-route parameters for the order confirmation screen. The
 * selected method, not the rails gateway, is preserved: a REDVAULT
 * success routed as `paystack` would join the settlement poll set,
 * and a late Once-helper emission there would re-emit the ad purchase
 * the REDVAULT branch already owns (the denied-claim fail-closed path
 * cannot retry through it). Extracted from the order-completion module
 * (300-line file limit).
 */
export function buildOrderSuccessParams(
  context: OrderCompletionContext,
  verifiedOrderNumber: string | undefined,
  reconciliation?: 'order_cancelled' | 'order_skipped'
) {
  const {
    gateway,
    orderId,
    orderNumber,
    paymentMethod,
    reference,
    trackingToken,
  } = context;
  return {
    orderId: orderId || '',
    orderNumber: verifiedOrderNumber || orderNumber || '',
    paymentMethod: paymentMethod ?? gateway,
    reference: reference || '',
    ...(reconciliation && { reconciliation }),
    ...(trackingToken && { trackingToken }),
  };
}
