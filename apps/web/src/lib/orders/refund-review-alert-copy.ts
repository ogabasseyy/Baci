function hasEntries(value: unknown): boolean {
  return Array.isArray(value) ? value.length > 0 : Boolean(value);
}

/**
 * True only when the review records a definite non-acceptance: the
 * provider explicitly did not accept a refund (ambiguous_initiation is
 * exactly false) and nothing suggests a refund may exist (no provider
 * refund ID, no accepted IDs, no audit-record failure, no reference-only
 * provider event, no nested per-leg refund_evidence). Anything else, including missing metadata, may concern
 * a refund Paystack already accepted, so it is treated as uncertain and
 * the merchant is never told to refund again blindly.
 */
export function isDefiniteRefundRejection(metadata: unknown): boolean {
  if (typeof metadata !== 'object' || metadata === null) return false;
  const m = metadata as Record<string, unknown>;
  // Merged reviews keep per-leg evidence under refund_evidence (written by
  // merge_paystack_cancellation_refund_leg_evidence_v1 and the provider
  // evidence merge). Every entry records an audit failure and may carry
  // ambiguity, accepted ids or a provider status, so ANY nested evidence
  // (or an unrecognised shape) means a refund may exist: stay neutral even
  // if the top-level ambiguous_initiation is false.
  const evidence = m.refund_evidence;
  if (evidence !== undefined && evidence !== null) {
    if (typeof evidence !== 'object' || Array.isArray(evidence)) return false;
    if (Object.keys(evidence).length > 0) return false;
  }
  return (
    m.ambiguous_initiation === false &&
    !hasEntries(m.provider_refund_id) &&
    !hasEntries(m.accepted_refund_ids) &&
    m.audit_record_failed !== true &&
    m.reference_only_refund_event !== true
  );
}

export function buildRefundReviewAlertCopy({
  amountText,
  label,
  metadata,
}: {
  amountText: string;
  label: string;
  metadata: unknown;
}): { body: string; title: string } {
  if (isDefiniteRefundRejection(metadata)) {
    return {
      body: `Refund for order #${label}${amountText} couldn't be completed automatically. Open the order to refund manually.`,
      title: 'Refund needs attention',
    };
  }
  return {
    body: `Refund for order #${label}${amountText} needs your review. It may already have been processed, so check Paystack before refunding again. Open the order to review it.`,
    title: 'Refund needs your review',
  };
}
