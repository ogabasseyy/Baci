import type { SupabaseClient } from '@supabase/supabase-js';
import type { PairedProviderRefund } from './check-cancellation-refund-provider';
import { isUnverifiedManualPaystackRefund } from './is-unverified-manual-paystack-refund';
import { normalizeRefundMoneyField } from './normalize-refund-money-field';

interface StampableRefundRow {
  amount: number;
  currency?: string | null;
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
 * so fail loudly and let the retry re-verify instead. Each row
 * consumes the pair matching its own kobo amount and leg currency
 * (multiset, so duplicate amounts pair one-to-one): provider
 * listings need not arrive in ledger order, so positional pairing
 * would cross-assign ids when amounts differ per row — and the
 * finalized-contradiction sweep would then reject both associations
 * as evidence mismatches. Rows without a pair are skipped entirely:
 * stamping them processed would assert provider verification no
 * refund was consumed for, and downstream coverage counts a
 * processed stamp as verified. Skipped rows stay unverified so the
 * matcher withholds them with evidence instead of counting a claim
 * the provider never confirmed.
 */
export async function stampVerifiedManualPaystackRefunds({
  currency,
  linkedPaymentId,
  pairedProviderRefunds = [],
  refundRows,
  supabase,
  transactionId,
}: {
  currency: string;
  linkedPaymentId: (row: { metadata: unknown }) => string | null;
  pairedProviderRefunds?: PairedProviderRefund[];
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
  const legCurrency = normalizeRefundMoneyField(currency);
  const remainingPairs = [...pairedProviderRefunds];
  for (const row of verified) {
    const metadata =
      row.metadata !== null && typeof row.metadata === 'object'
        ? row.metadata
        : {};
    // Same kobo formula the check paired with: only an exact
    // same-currency amount consumes a pair, so a row the check never
    // paired (foreign currency, unparseable amount) can never steal
    // another row's proof.
    const rowKobo = Math.round(Number(row.amount) * 100);
    const pairIndex =
      !Number.isSafeInteger(rowKobo) ||
      rowKobo <= 0 ||
      normalizeRefundMoneyField(row.currency) !== legCurrency
        ? -1
        : remainingPairs.findIndex((pair) => pair.kobo === rowKobo);
    if (pairIndex === -1) {
      continue;
    }
    const providerRefundId = remainingPairs.splice(pairIndex, 1)[0]
      ?.providerRefundId;
    const { error } = await supabase
      .from('transactions')
      .update({
        metadata: {
          ...metadata,
          provider_refund_status: 'processed',
          provider_refund_id: providerRefundId,
        },
        status: row.status,
      })
      .eq('id', row.id);
    if (error) {
      throw new Error('verified_manual_paystack_stamp_failed');
    }
  }
}
