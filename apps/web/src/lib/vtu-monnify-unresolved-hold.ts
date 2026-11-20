import type { PurchaseResult } from '@/lib/kuda';

/**
 * Metadata flag on a VTU row held because Monnify's answer did not prove
 * nothing was delivered. The row stays `processing` and is never refunded
 * or sent to Kuda on that answer. With a monnifyVendReference the
 * processing reconciliation settles it by requery; without one, support
 * checks Monnify's dashboard by the row's request_reference and settles it
 * by hand. The flag stays as history after the row settles.
 */
export const VTU_MONNIFY_OUTCOME_UNRESOLVED_KEY = 'monnifyOutcomeUnresolved';

/**
 * Flags a held Monnify result on the row's metadata and logs a fixed label
 * (no provider text) so held rows can be alerted on and found.
 */
export function markVtuMonnifyUnresolvedHold({
  metadata,
  result,
  transactionId,
}: {
  metadata: Record<string, unknown>;
  result: Pick<
    PurchaseResult,
    'providerOutcomeUnresolved' | 'providerVendReference'
  >;
  transactionId: string;
}): void {
  if (result.providerOutcomeUnresolved !== true) {
    return;
  }
  metadata[VTU_MONNIFY_OUTCOME_UNRESOLVED_KEY] = true;
  console.warn('Monnify answer left the vend outcome open; VTU row held:', {
    requeryable: !!result.providerVendReference,
    transactionId,
  });
}
