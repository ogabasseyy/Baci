/**
 * Whether the server-validated negotiation discount will actually be charged
 * on this order. Single source of truth for both the charge decision and the
 * cost-floor measurement, so the two can never drift apart.
 */
export function shouldApplyServerDerivedDiscount({
  redvaultRequested,
  merchantCanAutoNegotiate,
  requestedDiscountCode,
  expectedTotal,
  source,
}: {
  redvaultRequested: boolean;
  merchantCanAutoNegotiate: boolean;
  requestedDiscountCode: unknown;
  expectedTotal: unknown;
  source: unknown;
}): boolean {
  return (
    !redvaultRequested &&
    merchantCanAutoNegotiate &&
    !requestedDiscountCode &&
    (typeof expectedTotal === 'number' || source === 'mobile_app')
  );
}
