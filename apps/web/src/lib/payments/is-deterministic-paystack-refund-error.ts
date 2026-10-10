const DETERMINISTIC_REFUND_ERRORS = new Set([
  'invalid_local_refund_link',
  'refund_payment_link_mismatch',
  'paystack_refund_evidence_mismatch',
  'paystack_refund_lookup_rejected',
  'unknown_paystack_refund_status',
  'refund_transition_evidence_mismatch',
]);

export function isDeterministicRefundError(error: unknown): error is Error {
  return (
    error instanceof Error && DETERMINISTIC_REFUND_ERRORS.has(error.message)
  );
}
