import type { PurchaseResult } from '@/lib/kuda';

/**
 * The result for a Monnify answer that leaves the vend's outcome open: held
 * as `pending` (the row stays `processing`) instead of `failed`, so the
 * customer is not refunded while Monnify may still deliver, and it is never
 * handed to Kuda (only `failed` results are).
 *
 * With Monnify's own vendReference, the processing reconciliation requeries
 * it and settles (success, or a refund on an explicit FAILED). Without one,
 * requery cannot resolve it (#2784), so the row waits, flagged
 * `monnifyOutcomeUnresolved`, for support to check Monnify's dashboard.
 */
export function buildMonnifyUnresolvedVendResult({
  amount,
  message,
  providerErrorDetail,
  providerResponseCode,
  providerVendReference,
  requestReference,
}: {
  amount: number;
  message: string;
  providerErrorDetail?: string;
  providerResponseCode?: string;
  providerVendReference?: string;
  requestReference: string;
}): PurchaseResult {
  return {
    success: false,
    reference: requestReference,
    ...(providerVendReference && {
      providerVendReference,
      transactionId: providerVendReference,
    }),
    message,
    ...(providerErrorDetail && { providerErrorDetail }),
    ...(providerResponseCode && { providerResponseCode }),
    status: 'pending',
    amount,
    providerDefiniteFailure: false,
    providerOutcomeUnresolved: true,
  };
}
