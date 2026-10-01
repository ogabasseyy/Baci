/**
 * Whether dashboard/webhook booking may proceed for this repair's payment state.
 * Legacy pre-payment-column rows (null status + null reference) remain bookable.
 * New unpaid pickups are marked awaiting_payment and are not bookable yet.
 * Merchant manual fulfillment is terminal — GIGL must not book again.
 */
export function isRepairPickupPaymentReady(repair: {
  pickup_fee: number | string | null;
  pickup_payment_reference: string | null;
  pickup_payment_status: string | null;
}): boolean {
  if (
    repair.pickup_payment_status == null &&
    repair.pickup_payment_reference == null
  ) {
    return true;
  }
  if (
    repair.pickup_payment_status === 'awaiting_payment' ||
    repair.pickup_payment_status === 'manual_fulfilled'
  ) {
    return false;
  }
  const paidPickupFee = Number(repair.pickup_fee);
  const pickupPaymentStatus = repair.pickup_payment_status ?? '';
  return (
    ['paid', 'retrying', 'review'].includes(pickupPaymentStatus) &&
    Number.isFinite(paidPickupFee) &&
    paidPickupFee > 0
  );
}

/** True when a positive paid fee exists and the live quote exceeds it. */
export function isRepairPickupQuoteAbovePaidFee(
  quotePrice: number,
  pickupFee: number | string | null
): boolean {
  const paidPickupFee = Number(pickupFee);
  return (
    Number.isFinite(paidPickupFee) &&
    paidPickupFee > 0 &&
    Math.round(quotePrice * 100) > Math.round(paidPickupFee * 100)
  );
}
