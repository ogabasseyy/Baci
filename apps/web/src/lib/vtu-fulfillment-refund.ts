import type { SupabaseClient } from '@supabase/supabase-js';
import type { VtuTransactionRow } from '@/lib/vtu-fulfillment';
import { setMetadataValue } from '@/lib/vtu-metadata-fields';
import { readPaymentSplit } from '@/lib/vtu-payment-split';
import { throwVtuPersistenceError } from '@/lib/vtu-persistence-error';
import {
  shouldSkipRefundWithoutCollectionEvidence,
  VTU_REFUND_SKIPPED_KEY,
  VTU_REFUND_SKIPPED_NO_CHARGE,
  VTU_REFUND_SKIPPED_NO_COLLECTION,
} from '@/lib/vtu-refund-collection-evidence';
import {
  applyRefundMetadata,
  findExistingVtuRefundLedger,
  findExistingVtuReversalLedger,
  refundCardOnly,
  refundHybridKudaFailure,
  refundHybridWalletRace,
} from './vtu-fulfillment-refund-branches';

/**
 * Failed-vend refund dispatcher, moved here from vtu-fulfillment
 * (Codex R106 P1) per the 300-line ceiling: cached-replay
 * reconstruction plus context dispatch over the branches.
 */
function reconstructReplayRefundTotal({
  metadata,
  totalAmount,
}: {
  metadata: Record<string, unknown>;
  totalAmount: number;
}): number {
  const persisted = Number(metadata.refundAmount ?? Number.NaN);
  if (
    metadata.refundContext === 'hybrid_vend_failure' &&
    Number.isFinite(persisted)
  ) {
    const paymentSplit = readPaymentSplit(metadata);
    if (paymentSplit) {
      return paymentSplit.wallet + persisted;
    }
  }
  // Every other branch (card_only, wallet_race, ledger sync)
  // persists exactly what was restored. Legacy rows refunded before
  // refundAmount existed fall back to the total. (The wallet-only
  // race records a no-charge skip now, never an issued refund.)
  if (Number.isFinite(persisted)) {
    return persisted;
  }
  return totalAmount;
}

/**
 * Refund a failed VTU vend's wallet debit back to the customer wallet so
 * the customer can retry from restored credit. Wallet-only: utilities
 * are paid exclusively from wallet balance (gateway and saved-card
 * utility routes return VTU_WALLET_ONLY without collecting), so there
 * is no card portion to refund — do not reintroduce split-payment
 * refund logic here.
 *
 * Gates:
 *  - row.customer_id must be set (no wallet to credit otherwise)
 *  - row.amount must be positive
 *  - row.source === 'checkout' — only checkout-sourced VTU rows move
 *    customer money (the wallet-only route debits the wallet before
 *    vending); 'direct' and 'storefront_modal' are blocked at the API
 *    layer before a row is ever created, and 'loyalty_reward' / 'gift'
 *    are funded by points / merchant, not the customer's wallet.
 *
 * Note: an earlier draft gated on metadata.paymentReference, but not
 * every collecting path stores that on vtu_transactions.metadata —
 * gating on it would skip refunds this gate must cover.
 *
 * Idempotent at the RPC layer via pg_advisory_xact_lock + a uniqueness
 * lookup on (source_type='vtu_transaction_refund', source_id, type='refund').
 * Also writes metadata.refundIssued / metadata.refundAmount for visibility.
 */
export async function refundVtuToCustomerWallet({
  metadata,
  row,
  supabase,
  refundContext = 'kuda_failure',
  requireCollectionEvidence = false,
  expectedStatus,
}: {
  metadata: Record<string, unknown>;
  row: VtuTransactionRow;
  supabase: SupabaseClient;
  /**
   * Existing-failed rows only (Codex R51 6rqH1I): the card-only
   * fallthrough refunds full row.amount for rows WITHOUT a
   * paymentSplit — a legacy shape that includes gateway-init and
   * declined-authorization rows which never collected. Fresh vend
   * failures leave this false (this pass's vend attempt proves
   * collection preceded it); rows arriving ALREADY failed demand
   * recorded evidence or the row is marked skipped, never credited.
   */
  requireCollectionEvidence?: boolean;
  /**
   * `kuda_failure` (default): the vend was actually attempted and the
   * upstream provider rejected it. If the wallet leg was already debited
   * (`metadata.walletDebited === true`), reverse it; refund the card
   * portion as fresh wallet credit.
   *
   * `wallet_race`: the strict-amount wallet RPC raised
   * `insufficient_wallet_balance` BEFORE the vend ran. The wallet was
   * never debited, so there is nothing to reverse. Only the card portion
   * needs refunding (and only if cardPortion > 0 — wallet-only flows
   * with no gateway charge produce no ledger row at all).
   */
  refundContext?: 'kuda_failure' | 'wallet_race';
  /**
   * Caller-known persisted status for the refund RPCs'
   * expected-status guard (Codex R115 P1). Defaults to row.status;
   * callers whose in-memory snapshot predates the persist they gated
   * on MUST pass the persisted value (fresh-failure persists pass
   * 'failed'; the just-claimed wallet race passes 'processing').
   */
  expectedStatus?: string;
}): Promise<{
  metadataChanged: boolean;
  refundIssued: boolean;
  refundedAmount: number;
}> {
  const totalAmount = Number(row.amount ?? 0);

  if (!row.customer_id || totalAmount <= 0) {
    return { metadataChanged: false, refundIssued: false, refundedAmount: 0 };
  }
  if (row.source !== 'checkout') {
    return { metadataChanged: false, refundIssued: false, refundedAmount: 0 };
  }
  if (metadata.refundIssued === true) {
    // Already refunded on a prior fulfillment pass. Reconstruct the
    // restored total (Codex R103 P2): the hybrid kuda-failure branch
    // persists only the card leg (the history projector sums it with
    // the split's wallet leg), so reading the persisted value raw
    // would serialize refundedToWallet: 0 for wallet-only splits on
    // cached replays. Every other branch persists exactly what was
    // restored, so only that label adds the wallet leg back.
    return {
      metadataChanged: false,
      refundIssued: true,
      refundedAmount: reconstructReplayRefundTotal({ metadata, totalAmount }),
    };
  }

  const paymentSplit = readPaymentSplit(metadata);
  const walletWasDebited = metadata.walletDebited === true;

  if (
    !walletWasDebited &&
    paymentSplit &&
    paymentSplit.card <= 0 &&
    metadata[VTU_REFUND_SKIPPED_KEY] === VTU_REFUND_SKIPPED_NO_CHARGE
  ) {
    // A prior pass recorded that nothing was charged (wallet-race
    // arm), this pass debited nothing either, and the split still
    // has no card leg: terminally failed with nothing to confirm.
    // Return without dispatching — the kuda_failure invariant
    // branch below would otherwise throw on the
    // split-without-debit shape. (When this pass DID debit, or the
    // split gained a card leg, the marker is stale and dispatch
    // proceeds normally — issuing clears it.)
    return { metadataChanged: false, refundIssued: false, refundedAmount: 0 };
  }

  // Dispatch by refund context. The branches were extracted into named
  // helpers so each can be reasoned about (and tested) in isolation. The
  // P1 invariant: a `kuda_failure` context with `paymentSplit` MUST also
  // have `walletDebited === true`. If it doesn't, the wallet leg was
  // never charged — falling through to the card-only branch would refund
  // `totalAmount` and over-credit by `paymentSplit.wallet`. Throw rather
  // than guess.
  if (refundContext === 'kuda_failure' && paymentSplit && walletWasDebited) {
    return await refundHybridKudaFailure({
      metadata,
      row,
      supabase,
      expectedStatus,
      paymentSplit,
    });
  }
  if (refundContext === 'wallet_race' && paymentSplit) {
    return await refundHybridWalletRace({
      metadata,
      row,
      supabase,
      expectedStatus,
      paymentSplit,
    });
  }
  if (refundContext === 'kuda_failure' && paymentSplit && !walletWasDebited) {
    // Logically equivalent to wallet-race (wallet never debited). The
    // post-fact replay path defaults `refundContext` to 'kuda_failure'
    // for any failed row, including rows whose original failure was a
    // wallet-race — so this branch is reached during normal recovery,
    // not just on invariant violations. Consult the ledger (the source
    // of truth) before deciding which path we're on:
    //   - refund row exists → wallet-race already compensated; sync
    //     metadata and return so the customer isn't stuck in a 500
    //     loop after a transient metadata-persist failure.
    //   - reversal row exists (but no refund row) → a hybrid refund
    //     restored the wallet leg, then died before the card leg
    //     (Codex R117 P1). Run the race arm to complete the card
    //     leg — throwing here would strand it while the retry path
    //     reports the row refunded.
    //   - neither → genuine invariant violation (vend was attempted,
    //     wallet never debited, no compensation issued). Fail closed
    //     so the webhook retries with a clean slate.
    const existingRefund = await findExistingVtuRefundLedger({
      row,
      supabase,
    });
    if (existingRefund) {
      const metadataChanged = applyRefundMetadata(
        metadata,
        existingRefund.amount,
        'wallet_race'
      );
      return {
        metadataChanged,
        refundIssued: true,
        refundedAmount: existingRefund.amount,
      };
    }
    const existingReversal = await findExistingVtuReversalLedger({
      row,
      supabase,
    });
    if (existingReversal) {
      return await refundHybridWalletRace({
        metadata,
        row,
        supabase,
        expectedStatus,
        paymentSplit,
      });
    }
    throwVtuPersistenceError(
      `Refund dispatch invariant violated for ${row.id}: paymentSplit present, walletDebited=false, refundContext=kuda_failure, no ledger refund row`
    );
  }
  // Card-only path (no paymentSplit — legacy shape; current
  // checkout rows always persist a split at prepare time): refund the
  // full row.amount ONLY with collection evidence when the caller
  // requires it (see vtu-fulfillment-recovery for the why).
  if (
    requireCollectionEvidence &&
    (await shouldSkipRefundWithoutCollectionEvidence({
      metadata,
      row,
      supabase,
    }))
  ) {
    const metadataChanged = setMetadataValue(
      metadata,
      VTU_REFUND_SKIPPED_KEY,
      VTU_REFUND_SKIPPED_NO_COLLECTION
    );
    return { metadataChanged, refundIssued: false, refundedAmount: 0 };
  }
  return await refundCardOnly({
    metadata,
    row,
    supabase,
    expectedStatus,
    totalAmount,
  });
}
