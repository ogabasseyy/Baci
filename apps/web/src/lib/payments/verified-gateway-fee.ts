export type SupportedGateway = 'paystack' | 'korapay' | 'juicyway';

export function extractVerifiedGatewayFeeNgn(
  gateway: SupportedGateway,
  gatewayResponse: unknown
): number {
  if (gateway !== 'paystack') {
    return 0;
  }
  if (!gatewayResponse || typeof gatewayResponse !== 'object') {
    return 0;
  }
  const fees = (gatewayResponse as Record<string, unknown>).fees;
  // Reject non-numeric, non-finite, AND negative values. A negative fee
  // would inflate `gross_amount - gateway_fee - platform_fee` and
  // over-credit the merchant wallet on settlement. Treat as missing → 0.
  if (typeof fees !== 'number' || !Number.isFinite(fees) || fees < 0) {
    return 0;
  }
  return fees / 100;
}
