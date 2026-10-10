import { describe, expect, it } from 'vitest';
import { isDeterministicRefundError } from './is-deterministic-paystack-refund-error';

describe('isDeterministicRefundError', () => {
  it.each([
    'invalid_local_refund_link',
    'refund_payment_link_mismatch',
    'paystack_refund_evidence_mismatch',
    'unknown_paystack_refund_status',
    'refund_transition_evidence_mismatch',
  ])('classifies %s as deterministic', (message) => {
    expect(isDeterministicRefundError(new Error(message))).toBe(true);
  });

  it.each([
    'paystack_refund_verification_unavailable',
    'pending_refund_lookup_failed',
    'boom',
  ])('classifies %s as retryable', (message) => {
    expect(isDeterministicRefundError(new Error(message))).toBe(false);
  });

  it('rejects non-error values', () => {
    expect(isDeterministicRefundError('refund_payment_link_mismatch')).toBe(
      false
    );
    expect(isDeterministicRefundError(null)).toBe(false);
    expect(isDeterministicRefundError(undefined)).toBe(false);
  });
});
