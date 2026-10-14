// Terminal-state policy for PATCH /api/orders/[id]: once an order is
// cancelled, no generic status patch may move it out again. A narrower
// check (cancelled -> paid only) is bypassable in two steps
// (cancelled -> pending -> paid): after the loyalty claim is released
// and re-claimed elsewhere, resurrecting the first order would let two
// orders keep the same redeemed discount. Late payments belong on a
// new order. Same-value (no-op) and unrelated-field patches stay
// allowed. Extracted from route.ts, which is far over the 300-line
// limit, so new policy lands in a focused helper.

export interface CancelledTransitionRejection {
  error: string;
  code: 'PAYMENT_CANCELLED_TERMINAL' | 'SHIPPING_CANCELLED_TERMINAL';
}

/** Column/value pairs spelling "cancelled" in either status axis. */
export const CANCELLED_STATUS_SPELLINGS = [
  ['payment_status', 'cancelled'],
  ['payment_status', 'canceled'],
  ['shipping_status', 'cancelled'],
  ['shipping_status', 'canceled'],
] as const;

function isCancelledStatus(value: string | null | undefined): boolean {
  return value === 'cancelled' || value === 'canceled';
}

export function evaluateOrderCancelledTransition(input: {
  existingPaymentStatus: string | null | undefined;
  existingShippingStatus: string | null | undefined;
  requestedPaymentStatus: string | undefined;
  requestedShippingStatus: string | undefined;
}): CancelledTransitionRejection | null {
  if (
    isCancelledStatus(input.existingPaymentStatus) &&
    input.requestedPaymentStatus !== undefined &&
    input.requestedPaymentStatus !== input.existingPaymentStatus
  ) {
    return {
      error:
        'This order was cancelled for non-payment and cannot be marked paid. Create a new order for the late payment.',
      code: 'PAYMENT_CANCELLED_TERMINAL',
    };
  }
  if (
    isCancelledStatus(input.existingShippingStatus) &&
    input.requestedShippingStatus !== undefined &&
    input.requestedShippingStatus !== input.existingShippingStatus
  ) {
    return {
      error:
        'This order was cancelled and cannot be moved out of cancelled. Use the cancellation endpoint for cancellations.',
      code: 'SHIPPING_CANCELLED_TERMINAL',
    };
  }
  return null;
}
