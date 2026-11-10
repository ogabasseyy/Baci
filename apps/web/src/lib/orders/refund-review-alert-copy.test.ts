import { describe, expect, it } from 'vitest';
import {
  buildRefundReviewAlertCopy,
  isDefiniteRefundRejection,
} from './refund-review-alert-copy';

describe('isDefiniteRefundRejection', () => {
  it('is true only for an explicit non-acceptance with no refund evidence', () => {
    expect(
      isDefiniteRefundRejection({
        ambiguous_initiation: false,
        refund_evidence: {},
      })
    ).toBe(true);
    expect(isDefiniteRefundRejection({ ambiguous_initiation: false })).toBe(
      true
    );
    expect(
      isDefiniteRefundRejection({
        accepted_refund_ids: [],
        ambiguous_initiation: false,
      })
    ).toBe(true);
  });

  it.each([
    ['null', null],
    ['non-object', 'x'],
    ['empty object', {}],
    ['ambiguous', { ambiguous_initiation: true }],
    [
      'provider refund id',
      { ambiguous_initiation: false, provider_refund_id: '9' },
    ],
    [
      'accepted ids',
      { accepted_refund_ids: ['1'], ambiguous_initiation: false },
    ],
    [
      'audit record failed',
      { ambiguous_initiation: false, audit_record_failed: true },
    ],
    [
      'reference-only event',
      { ambiguous_initiation: false, reference_only_refund_event: true },
    ],
    [
      'merged per-leg evidence (RPC shape) despite top-level false',
      {
        ambiguous_initiation: false,
        refund_evidence: {
          'payment:abc': {
            accepted_refund_ids: ['77'],
            ambiguous: true,
            audit_record_failed: true,
            observed_at: '2026-11-10T10:00:00Z',
            payment_transaction_id: 'abc',
            provider_refund_status: 'processed',
            reason: 'r',
          },
        },
      },
    ],
    [
      'non-ambiguous nested entry (still audit-failed)',
      {
        ambiguous_initiation: false,
        refund_evidence: {
          'payment:abc': { ambiguous: false, audit_record_failed: true },
        },
      },
    ],
    [
      'unrecognised refund_evidence shape',
      { ambiguous_initiation: false, refund_evidence: 'oops' },
    ],
    [
      'array refund_evidence',
      { ambiguous_initiation: false, refund_evidence: [] },
    ],
  ])('is false for %s', (_name, metadata) => {
    expect(isDefiniteRefundRejection(metadata)).toBe(false);
  });
});

describe('buildRefundReviewAlertCopy', () => {
  it('tells the merchant to refund manually after a definite rejection', () => {
    const copy = buildRefundReviewAlertCopy({
      amountText: ' (₦1,000)',
      label: '1042',
      metadata: { ambiguous_initiation: false },
    });
    expect(copy.title).toBe('Refund needs attention');
    expect(copy.body).toContain('order #1042 (₦1,000)');
    expect(copy.body).toContain('refund manually');
  });

  it('asks for a Paystack check when the refund may already exist', () => {
    const copy = buildRefundReviewAlertCopy({
      amountText: '',
      label: '1042',
      metadata: undefined,
    });
    expect(copy.title).toBe('Refund needs your review');
    expect(copy.body).toContain('check Paystack before refunding again');
    expect(copy.body).not.toContain('refund manually');
  });

  it('stays neutral for a merged review with nested evidence', () => {
    const copy = buildRefundReviewAlertCopy({
      amountText: '',
      label: '1042',
      metadata: {
        ambiguous_initiation: false,
        refund_evidence: {
          'payment:abc': {
            accepted_refund_ids: ['77'],
            audit_record_failed: true,
            provider_refund_status: 'processed',
          },
        },
      },
    });
    expect(copy.body).toContain('check Paystack before refunding again');
    expect(copy.body).not.toContain('refund manually');
  });
});
