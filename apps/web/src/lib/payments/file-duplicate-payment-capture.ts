import type { SupabaseClient } from '@supabase/supabase-js';
import { clearDuplicateCaptureReviewPending } from './duplicate-capture-review-pending';

export interface DuplicateCaptureEvidence {
  /** Capture gateway: names the review and selects the reference column. */
  gateway: string;
  mismatchDetail?: string;
  mismatchKind?: string;
  /**
   * Gateway-native verified charge total: Paystack kobo, Korapay/Juicyway
   * major. Never re-scaled from the normalized amount — stablecoin
   * captures have no minor units.
   */
  providerAmount: number;
  providerCurrency: string;
  /** Verification charge id: Paystack id, Korapay reference, Juicyway payment id. */
  providerReference: string;
  /** The gateway's own status vocabulary, verbatim. */
  providerStatus: string;
}

async function confirmOwnDuplicateCaptureReview(
  supabase: SupabaseClient,
  attempt: { id: string }
): Promise<boolean> {
  const { data: existing, error: lookupError } = await supabase
    .from('reconciliation_review')
    .select('id')
    .eq('issue_type', 'duplicate_payment_capture_requires_review')
    .eq('txn_id', attempt.id)
    .is('resolved_at', null)
    .maybeSingle();
  return !lookupError && existing != null;
}

/**
 * Files a duplicate-capture review for a stale attempt a gateway verified
 * as captured, merging into the open review on conflict, then stamps the
 * row so the sweep never reselects it. Returns true when the evidence is
 * durable. Only Paystack references occupy paystack_ref; other gateways
 * identify their charge in metadata so the column never misattributes a
 * capture. When the global ref slot belongs to another order's capture
 * (merge finds no open review for this order), the capture refiles
 * without occupying paystack_ref instead of colliding forever. The
 * stamp merges database-side: spreading the stale in-memory metadata
 * snapshot would clobber a concurrent charge.success completion.
 */
export async function fileDuplicatePaymentCapture({
  attempt,
  evidence,
  supabase,
}: {
  attempt: {
    gateway_reference: string;
    id: string;
    merchant_id: string;
    metadata: Record<string, unknown> | null;
    order_id: string;
  };
  evidence: DuplicateCaptureEvidence;
  supabase: SupabaseClient;
}): Promise<boolean> {
  const detail = evidence.mismatchKind
    ? ` with ${evidence.mismatchKind} (${evidence.mismatchDetail ?? 'provider evidence differs'})`
    : '';
  const row = {
    issue_type: 'duplicate_payment_capture_requires_review',
    order_id: attempt.order_id,
    merchant_id: attempt.merchant_id,
    txn_id: attempt.id,
    paystack_ref:
      evidence.gateway === 'paystack' ? attempt.gateway_reference : null,
    reason: `Stale ${evidence.gateway} attempt ${attempt.gateway_reference} verified as captured while the order is already paid; possible duplicate charge${detail}`,
    metadata: {
      gateway: evidence.gateway,
      payment_transaction_id: attempt.id,
      gateway_reference: attempt.gateway_reference,
      provider_reference: evidence.providerReference,
      provider_status: evidence.providerStatus,
      provider_amount: evidence.providerAmount,
      provider_currency: evidence.providerCurrency,
      ...(evidence.mismatchKind
        ? { evidence_mismatch: evidence.mismatchKind }
        : {}),
    },
  };
  const { error: reviewError } = await supabase
    .from('reconciliation_review')
    .insert(row);
  if (reviewError && (reviewError as { code?: string }).code !== '23505') {
    return false;
  }
  if (reviewError) {
    // Another capture on this order already occupies the review slot;
    // merge this attempt in so operations sees every charge.
    const { data: merged, error: mergeError } = await supabase.rpc(
      'merge_duplicate_payment_capture_evidence_v1',
      {
        p_order_id: attempt.order_id,
        p_merchant_id: attempt.merchant_id,
        p_transaction_id: attempt.id,
        p_gateway_reference: attempt.gateway_reference,
        p_gateway: evidence.gateway,
        p_charge_id: evidence.providerReference,
        p_reason: `Stale attempt ${attempt.gateway_reference} verified as captured${detail}`,
        p_provider_amount: evidence.providerAmount,
        p_provider_currency: evidence.providerCurrency,
        p_provider_status: evidence.providerStatus,
      }
    );
    if (!mergeError && merged === true) {
      // Evidence merged; fall through to the stamp below.
    } else if (await confirmOwnDuplicateCaptureReview(supabase, attempt)) {
      // Our own open review already holds the evidence (a prior run
      // filed it but failed to stamp): durable, so stamp below.
    } else if (mergeError) {
      // A transport failure leaves the conflict unresolved: retrying
      // the insert would collide again, so hold for the next sweep.
      return false;
    } else {
      // No open review for this order: the global ref slot is owned
      // by another order's capture. File without occupying
      // paystack_ref so this capture keeps its own operations review
      // instead of colliding forever; the column stays truthful
      // while metadata keeps the full gateway evidence.
      const { error: nullRefError } = await supabase
        .from('reconciliation_review')
        .insert({ ...row, paystack_ref: null });
      if (nullRefError) return false;
    }
  }
  // The evidence is durable from here (inserted, merged, or already
  // filed): release a filing-only retry marker ahead of the stamp so a
  // stamp-only failure cannot reselect a reviewed row. Best-effort — a
  // failed clear only refiles through the dedupe above.
  await clearDuplicateCaptureReviewPending(supabase, attempt.id);
  // The Paystack stamp guards on gateway = 'paystack', so a verified
  // Korapay/Juicyway capture needs the gateway-neutral variant: without
  // it the stamp returns false, the filing reports failure, and the sweep
  // retries the oldest captured row forever.
  const stampFn =
    evidence.gateway === 'paystack'
      ? 'stamp_abandoned_sweep_resolution_v1'
      : 'stamp_abandoned_sweep_resolution_any_gateway_v1';
  // Mismatched captures keep their own stamp: the cancellation
  // transition only promotes verified_success_captured legs, and
  // promoting a contradictory capture would refund with the mismatched
  // reference or currency. The gate and sweep carve out any stamped
  // row, so the mismatch stamp still retires the leg for operations.
  const { data: stamped, error: stampError } = await supabase.rpc(stampFn, {
    p_transaction_id: attempt.id,
    p_expected_reference: attempt.gateway_reference,
    p_resolution: evidence.mismatchKind
      ? 'verified_capture_mismatch_reviewed'
      : 'verified_success_captured',
  });
  return !stampError && stamped === true;
}
