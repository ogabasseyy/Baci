import { toLagosRefundInstant } from './to-lagos-refund-instant';

// Manual-record request body: mirrors the route schema, with the
// Paystack leg pin only when the merchant selected a capture. A
// sole eligible leg stays unpinned so the RPC resolves it on live
// data (fresher than status polling); the pin is required only to
// disambiguate several outstanding captures.
export function buildManualRefundPayload({
  amount,
  confirmed,
  date,
  method,
  note,
  paymentLegId,
  reference,
}: {
  amount: string;
  confirmed: boolean;
  date: string;
  method: string;
  note: string;
  paymentLegId: string | null;
  reference: string;
}): Record<string, unknown> {
  return {
    action: 'manual',
    amount: Number(amount),
    refundedAt: toLagosRefundInstant(date),
    method,
    reference,
    note,
    confirmed,
    ...(paymentLegId ? { paymentTransactionId: paymentLegId } : {}),
  };
}
