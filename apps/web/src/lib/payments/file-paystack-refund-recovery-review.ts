import type { SupabaseClient } from '@supabase/supabase-js';

export interface PaystackRefundRecoveryReview {
  candidates: Record<string, unknown>[];
  merchantId: string;
  metadata: Record<string, unknown>;
  orderId: string;
  paystackRef: string | null;
  reason: string;
}

interface OpenRecoveryReview {
  candidates: unknown;
  id: string;
  metadata: Record<string, unknown> | null;
}

const ISSUE_TYPE = 'order_cancellation_refund_requires_review';

// Per-refund entries reuse the nested shape the completion RPC resolves, so
// every merged refund must complete before the review closes.
function nestedEvidence(review: PaystackRefundRecoveryReview) {
  return {
    [`provider:${String(review.metadata.provider_refund_id)}`]: {
      audit_record_failed: true,
      payment_transaction_id: review.metadata.payment_transaction_id ?? null,
      reason: review.reason.slice(0, 120),
      observed_at: new Date().toISOString(),
    },
  };
}

function insertPayload(review: PaystackRefundRecoveryReview) {
  return {
    issue_type: ISSUE_TYPE,
    order_id: review.orderId,
    merchant_id: review.merchantId,
    paystack_ref: review.paystackRef,
    reason: review.reason,
    candidates: review.candidates,
    metadata: {
      ...review.metadata,
      refund_evidence: nestedEvidence(review),
    },
  };
}

function isUniqueViolation(error: unknown) {
  return (error as { code?: string } | null)?.code === '23505';
}

function unionCandidates(
  existing: unknown,
  incoming: Record<string, unknown>[]
): Record<string, unknown>[] {
  const merged = Array.isArray(existing)
    ? [...(existing as Record<string, unknown>[])]
    : [];
  const seen = new Set(merged.map((entry) => entry?.payment_transaction_id));
  for (const entry of incoming) {
    if (!seen.has(entry.payment_transaction_id)) {
      seen.add(entry.payment_transaction_id);
      merged.push(entry);
    }
  }
  return merged;
}

function existingEvidenceMap(
  metadata: Record<string, unknown> | null
): Record<string, unknown> {
  const current = metadata?.refund_evidence;
  return current !== null &&
    typeof current === 'object' &&
    !Array.isArray(current)
    ? (current as Record<string, unknown>)
    : {};
}

// An open review already covers this order: absorb the new recovery's
// evidence instead of dropping it. The first filing's reason is preserved;
// each refund's evidence nests under its own provider key.
async function mergeIntoOpenReview(
  supabase: SupabaseClient,
  review: PaystackRefundRecoveryReview
): Promise<void> {
  const { data: open, error: openError } = await supabase
    .from('reconciliation_review')
    .select('id, metadata, candidates')
    .eq('issue_type', ISSUE_TYPE)
    .eq('order_id', review.orderId)
    .is('resolved_at', null)
    .limit(1);
  if (openError) throw new Error('refund_recovery_review_failed');
  const existing = (open as OpenRecoveryReview[] | null)?.[0];
  if (!existing) {
    // Resolved (or never opened — a sibling unique index fired): refire
    // once so a recurrence is recorded. A second conflict means a
    // concurrent filing won with its own evidence.
    const { error: retryError } = await supabase
      .from('reconciliation_review')
      .insert(insertPayload(review));
    if (retryError && !isUniqueViolation(retryError)) {
      throw new Error('refund_recovery_review_failed');
    }
    return;
  }
  const { data: updated, error: updateError } = await supabase
    .from('reconciliation_review')
    .update({
      metadata: {
        ...(existing.metadata ?? {}),
        refund_evidence: {
          ...existingEvidenceMap(existing.metadata),
          ...nestedEvidence(review),
        },
      },
      candidates: unionCandidates(existing.candidates, review.candidates),
    })
    .eq('id', existing.id)
    .is('resolved_at', null)
    .select('id');
  if (updateError) throw new Error('refund_recovery_review_failed');
  if (!updated || (updated as unknown[]).length === 0) {
    // Resolved between select and update: refire once as a recurrence.
    const { error: retryError } = await supabase
      .from('reconciliation_review')
      .insert(insertPayload(review));
    if (retryError && !isUniqueViolation(retryError)) {
      throw new Error('refund_recovery_review_failed');
    }
  }
}

/**
 * File a recovery review when no local refund row exists to attach it to.
 * Insert-first: the open-by-order unique index detects a concurrent or
 * redelivered filing, whose open review then absorbs this recovery's
 * evidence instead of dropping it. Never throws for duplicate filings.
 */
export async function filePaystackRefundRecoveryReview(
  supabase: SupabaseClient,
  review: PaystackRefundRecoveryReview
): Promise<void> {
  const { error: insertError } = await supabase
    .from('reconciliation_review')
    .insert(insertPayload(review));
  if (!insertError) return;
  if (!isUniqueViolation(insertError)) {
    throw new Error('refund_recovery_review_failed');
  }
  await mergeIntoOpenReview(supabase, review);
}
