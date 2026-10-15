import type { SupabaseClient } from '@supabase/supabase-js';
import { isUnverifiedManualPaystackRefund } from './is-unverified-manual-paystack-refund';

interface StampableRefundRow {
  gateway?: unknown;
  id: string;
  metadata: unknown;
  status: string;
}

/**
 * Persist provider proof onto a leg's verified manual Paystack rows.
 * Preflight only calls this after the provider check pairs every
 * manual claim with a processed provider refund: the stamp converts
 * the merchant claim into coverage the matcher, the refund manager,
 * and the status trigger all count. The update names status with its
 * current value because the sync trigger fires on UPDATE OF status —
 * a metadata-only write would leave the order label stale even once
 * the row counts. Already-stamped rows are skipped so retries and
 * re-verifications never refire the trigger. Throws on a failed
 * write: without the stamp the next run quarantines the leg again,
 * so fail loudly and let the retry re-verify instead.
 */
export async function stampVerifiedManualPaystackRefunds({
  linkedPaymentId,
  refundRows,
  supabase,
  transactionId,
}: {
  linkedPaymentId: (row: { metadata: unknown }) => string | null;
  refundRows: StampableRefundRow[];
  supabase: Pick<SupabaseClient, 'from'>;
  transactionId: string;
}): Promise<void> {
  const verified = refundRows.filter(
    (row) =>
      (row.status === 'completed' || row.status === 'refunded') &&
      linkedPaymentId(row) === transactionId &&
      isUnverifiedManualPaystackRefund(row)
  );
  for (const row of verified) {
    const metadata =
      row.metadata !== null && typeof row.metadata === 'object'
        ? row.metadata
        : {};
    const { error } = await supabase
      .from('transactions')
      .update({
        metadata: { ...metadata, provider_refund_status: 'processed' },
        status: row.status,
      })
      .eq('id', row.id);
    if (error) {
      throw new Error('verified_manual_paystack_stamp_failed');
    }
  }
}
