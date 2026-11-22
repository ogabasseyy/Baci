// This stamp is added by the database after certifying the capture. Raw
// Paystack fields alone cannot establish how the order was funded.
const customerFeeField = 'baci_paystack_checkout_customer_fee_minor';

export function paystackCancellationCaptureAmounts(payment: {
  amount: number;
  gateway_response?: unknown;
}): { principalMinor: number; grossMinor: number } | null {
  const principalMinor = Math.round(Number(payment.amount) * 100);
  if (!Number.isSafeInteger(principalMinor) || principalMinor <= 0) return null;

  const proof = payment.gateway_response;
  if (
    typeof proof !== 'object' ||
    proof === null ||
    !(customerFeeField in proof)
  )
    return { principalMinor, grossMinor: principalMinor };

  const capture = proof as Record<string, unknown>;
  const fee = capture[customerFeeField];
  const grossMinor = capture.amount;
  if (
    typeof fee !== 'number' ||
    !Number.isSafeInteger(fee) ||
    fee <= 0 ||
    typeof grossMinor !== 'number' ||
    !Number.isSafeInteger(grossMinor) ||
    capture.requested_amount !== principalMinor ||
    grossMinor - principalMinor !== fee
  ) {
    return null;
  }
  return { principalMinor, grossMinor };
}

export function paystackCancellationRefundProviderAmount(
  refund: { amount: number; metadata?: Record<string, unknown> | null },
  amounts: { principalMinor: number; grossMinor: number }
): number | null {
  const ledgerMinor = Math.round(Number(refund.amount) * 100);
  if (
    !Number.isSafeInteger(ledgerMinor) ||
    ledgerMinor <= 0 ||
    ledgerMinor > amounts.principalMinor
  )
    return null;

  const providerAmount = refund.metadata?.provider_refund_amount_minor;
  if (amounts.grossMinor === amounts.principalMinor)
    return providerAmount === undefined ? ledgerMinor : null;

  return ledgerMinor === amounts.principalMinor &&
    providerAmount === amounts.grossMinor
    ? amounts.grossMinor
    : null;
}
