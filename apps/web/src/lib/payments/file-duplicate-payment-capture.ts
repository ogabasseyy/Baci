import type { SupabaseClient } from '@supabase/supabase-js';

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

/**
 * Files a duplicate-capture review for a stale attempt a gateway verified
 * as captured, merging into the open review on conflict, then stamps the
 * row so the sweep never reselects it. Returns true when the evidence is
 * durable. Only Paystack references occupy paystack_ref; other gateways
 * identify their charge in metadata so the column never misattributes a
 * capture. The stamp merges database-side: spreading the stale in-memory
 * metadata snapshot would clobber a concurrent charge.success completion.
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
  const { error: reviewError } = await supabase
    .from('reconciliation_review')
    .insert({
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
    });
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
      }
    );
    if (mergeError || merged !== true) return false;
  }
  const { data: stamped, error: stampError } = await supabase.rpc(
    'stamp_abandoned_sweep_resolution_v1',
    {
      p_transaction_id: attempt.id,
      p_expected_reference: attempt.gateway_reference,
      p_resolution: 'verified_success_captured',
    }
  );
  return !stampError && stamped === true;
}
