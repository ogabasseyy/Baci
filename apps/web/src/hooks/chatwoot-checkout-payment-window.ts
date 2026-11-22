/**
 * A dedicated account is bound to its order for 60 minutes plus a 30 minute
 * inter-bank settlement grace: the payment-initialize route stores that as the
 * assignment's expiry and the transfer webhook clamps to it. After it, a
 * transfer to those bank details is no longer matched to the order.
 */
const DVA_PAYMENT_WINDOW_MS = 90 * 60 * 1000;

/** True while bank details issued at `issuedAt` can still pay their order. */
export function isChatwootCheckoutPaymentWindowOpen(
  issuedAt: number,
  now: number = Date.now()
): boolean {
  return now - issuedAt <= DVA_PAYMENT_WINDOW_MS;
}
