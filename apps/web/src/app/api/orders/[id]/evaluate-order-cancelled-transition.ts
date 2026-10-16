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

/** True when a status value spells cancellation on either axis. */
export function isCancelledStatus(value: string | null | undefined): boolean {
  return value === 'cancelled' || value === 'canceled';
}

const PAYMENT_CANCELLED_REJECTION: CancelledTransitionRejection = {
  error:
    'This order was cancelled for non-payment and cannot be marked paid. Create a new order for the late payment.',
  code: 'PAYMENT_CANCELLED_TERMINAL',
};

const SHIPPING_CANCELLED_REJECTION: CancelledTransitionRejection = {
  error:
    'This order was cancelled and cannot be moved out of cancelled. Use the cancellation endpoint for cancellations.',
  code: 'SHIPPING_CANCELLED_TERMINAL',
};

/**
 * The terminal rejection for an order already in a cancelled state,
 * regardless of what was requested. The raced-update path uses this
 * when the evaluator finds no requested change to reject (e.g. only a
 * status echo raced the cancellation) but the row is cancelled now.
 */
export function cancelledTerminalRejection(input: {
  existingPaymentStatus: string | null | undefined;
  existingShippingStatus: string | null | undefined;
}): CancelledTransitionRejection | null {
  if (isCancelledStatus(input.existingPaymentStatus)) {
    return PAYMENT_CANCELLED_REJECTION;
  }
  if (isCancelledStatus(input.existingShippingStatus)) {
    return SHIPPING_CANCELLED_REJECTION;
  }
  return null;
}

/**
 * True when a PATCH body carries a non-cancelled status value —
 * including an echoed one: writing the observed 'unpaid' back over a
 * just-committed cancellation would reopen the order after its
 * loyalty claim was released. Metadata-only writes (no status fields,
 * or only cancelled spellings the endpoint already owns) stay
 * unpredicated so cancelled orders remain editable.
 */
export function writesNonCancelledStatusValue(input: {
  paymentStatus: string | undefined;
  shippingStatus: string | undefined;
}): boolean {
  return (
    (input.paymentStatus !== undefined &&
      !isCancelledStatus(input.paymentStatus)) ||
    (input.shippingStatus !== undefined &&
      !isCancelledStatus(input.shippingStatus))
  );
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
    return PAYMENT_CANCELLED_REJECTION;
  }
  if (
    isCancelledStatus(input.existingShippingStatus) &&
    input.requestedShippingStatus !== undefined &&
    input.requestedShippingStatus !== input.existingShippingStatus
  ) {
    return SHIPPING_CANCELLED_REJECTION;
  }
  return null;
}
