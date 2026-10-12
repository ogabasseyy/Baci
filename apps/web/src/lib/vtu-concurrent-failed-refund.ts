/**
 * Concurrent-return failed branch for VTU fulfillment.
 *
 * Split out of vtu-fulfillment.ts per the Boy Scout Rule (that module
 * is over the 300-line budget): when a replay/cron overlap re-reads a
 * row the winner already failed, the refund may not be confirmed yet.
 * This response is terminal (the client rotates the key) and failed
 * rows are cron-excluded, so the branch confirms the refund inline
 * instead of returning an unconfirmed failure that would strand the
 * debit with no re-drive.
 *
 * The refund issuer is injected: the orchestrator lives in
 * vtu-fulfillment.ts and importing it here would cycle.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSafeMetadataDiagnostics } from '@/lib/vtu-metadata-fields';
import { throwVtuPersistenceError } from '@/lib/vtu-persistence-error';
import { throwIfVtuRefundUnconfirmed } from '@/lib/vtu-refund-guard';

/** Minimal row shape (structural; the fulfillment row satisfies it). */
export interface ConcurrentFailedRefundRow {
  amount: number;
  customer_id: string | null;
  error_message: string | null;
  id: string;
  metadata: Record<string, unknown> | null;
  request_reference: string;
  source: string | null;
}

export interface ConcurrentFailedRefundResult {
  amount: number;
  error: string;
  reference: string;
  refundedToWallet?: number;
  status: 'failed';
}

export async function resolveConcurrentFailedVtuTransaction({
  issueRefund,
  row,
  supabase,
}: {
  issueRefund: (metadata: Record<string, unknown>) => Promise<{
    metadataChanged: boolean;
    refundIssued: boolean;
    refundedAmount: number;
  }>;
  row: ConcurrentFailedRefundRow;
  supabase: SupabaseClient;
}): Promise<ConcurrentFailedRefundResult> {
  // Idempotent: a prior pass's flags short-circuit inside the issuer.
  const refundMetadata = { ...(row.metadata ?? {}) };
  const refund = await issueRefund(refundMetadata);
  throwIfVtuRefundUnconfirmed({
    row,
    refundIssued: refund.refundIssued,
    refundedAmount: refund.refundedAmount,
    failedMessage: row.error_message ?? undefined,
    failedMetadata: getSafeMetadataDiagnostics(refundMetadata),
    message: `Unable to confirm VTU refund before returning concurrent failed purchase for ${row.id}`,
  });
  if (refund.metadataChanged) {
    const { error: refundMetadataUpdateError } = await supabase
      .from('vtu_transactions')
      .update({ metadata: refundMetadata })
      .eq('id', row.id)
      .eq('status', 'failed');
    if (refundMetadataUpdateError) {
      // Same fail-closed shape as the direct failed branch: the
      // wallet was credited but the row doesn't say so. Throw so
      // the next request retries the metadata write (the RPC
      // short-circuits on the existing ledger row).
      console.error('Failed to persist concurrent VTU refund metadata:', {
        error: refundMetadataUpdateError.message,
        metadata: getSafeMetadataDiagnostics(refundMetadata),
        transactionId: row.id,
      });
      throwVtuPersistenceError(
        `Failed to persist concurrent VTU refund metadata for ${row.id}: ${refundMetadataUpdateError.message}`
      );
    }
  }
  return {
    amount: Number(row.amount) || 0,
    error: row.error_message || 'Purchase failed',
    reference: row.request_reference,
    ...(refund.refundIssued &&
      refund.refundedAmount > 0 && {
        refundedToWallet: refund.refundedAmount,
      }),
    status: 'failed',
  };
}
