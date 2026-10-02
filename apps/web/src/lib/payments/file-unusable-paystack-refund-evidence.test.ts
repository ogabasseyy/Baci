import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fileActiveOrderPaystackRefundCandidateReviews: vi.fn(),
  fileCancelledPaystackRefundCandidateReviews: vi.fn(),
  fileInvalidPaystackRefundEvidenceReview: vi.fn(),
  fileUnclaimedPaystackRefundCandidateReview: vi.fn(),
  resolvePaystackRefundRecoveryWatch: vi.fn(),
}));

vi.mock('./file-cancelled-paystack-refund-candidate-reviews', () => ({
  fileCancelledPaystackRefundCandidateReviews:
    mocks.fileCancelledPaystackRefundCandidateReviews,
}));
vi.mock('./file-provider-refund-outside-cancellation-review', () => ({
  fileActiveOrderPaystackRefundCandidateReviews:
    mocks.fileActiveOrderPaystackRefundCandidateReviews,
}));
vi.mock('./file-invalid-paystack-refund-evidence-review', () => ({
  fileInvalidPaystackRefundEvidenceReview:
    mocks.fileInvalidPaystackRefundEvidenceReview,
  fileUnclaimedPaystackRefundCandidateReview:
    mocks.fileUnclaimedPaystackRefundCandidateReview,
}));
vi.mock('./resolve-paystack-refund-recovery-watch', () => ({
  resolvePaystackRefundRecoveryWatch: mocks.resolvePaystackRefundRecoveryWatch,
}));

import type { CompletedPaymentMatch } from './fetch-completed-payments-by-reference';
import { fileUnusablePaystackRefundEvidence } from './file-unusable-paystack-refund-evidence';

const candidate: CompletedPaymentMatch = {
  amount: 100,
  gateway: 'paystack',
  gateway_reference: 'PSK-1',
  id: 'pay-1',
  merchant_id: 'merchant-1',
  order_id: 'order-1',
};

const evidence = {
  providerPaymentTransactionId: 555,
  providerRefundId: 202,
  providerRefundStatus: 'processed',
  reference: 'PSK-1',
};

const current = { amount: 10000, currency: 'NGN', status: 'processed' };

describe('fileUnusablePaystackRefundEvidence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fileCancelledPaystackRefundCandidateReviews.mockResolvedValue([
      'pay-1',
    ]);
    mocks.fileActiveOrderPaystackRefundCandidateReviews.mockResolvedValue([]);
    mocks.fileInvalidPaystackRefundEvidenceReview.mockResolvedValue(undefined);
    mocks.fileUnclaimedPaystackRefundCandidateReview.mockResolvedValue(
      undefined
    );
    mocks.resolvePaystackRefundRecoveryWatch.mockResolvedValue(undefined);
  });

  it('files the generic review when no candidate orders exist', async () => {
    const supabase = {} as never;

    await expect(
      fileUnusablePaystackRefundEvidence(supabase, {
        candidates: [],
        current,
        evidence,
        reference: 'PSK-1',
        refundId: 202,
      })
    ).rejects.toThrow('paystack_refund_evidence_unmatched');

    expect(mocks.fileInvalidPaystackRefundEvidenceReview).toHaveBeenCalledWith(
      supabase,
      expect.objectContaining({ reference: 'PSK-1', refundId: 202 })
    );
    expect(
      mocks.fileCancelledPaystackRefundCandidateReviews
    ).not.toHaveBeenCalled();
    expect(mocks.resolvePaystackRefundRecoveryWatch).toHaveBeenCalledWith(
      supabase,
      { providerRefundId: 202, reference: 'PSK-1' }
    );
  });

  it('files both queues plus unclaimed candidates, then rethrows', async () => {
    const supabase = {} as never;

    await expect(
      fileUnusablePaystackRefundEvidence(supabase, {
        candidates: [candidate],
        current,
        evidence,
        reference: 'PSK-1',
        refundId: 202,
      })
    ).rejects.toThrow('paystack_refund_evidence_invalid');

    const reason = expect.stringContaining('unusable provider evidence');
    expect(
      mocks.fileCancelledPaystackRefundCandidateReviews
    ).toHaveBeenCalledWith(supabase, [candidate], evidence, reason);
    expect(
      mocks.fileActiveOrderPaystackRefundCandidateReviews
    ).toHaveBeenCalledWith(supabase, [candidate], evidence, reason, {
      amount: 100,
      currency: 'NGN',
      status: 'processed',
    });
    expect(
      mocks.fileUnclaimedPaystackRefundCandidateReview
    ).toHaveBeenCalledWith(
      supabase,
      expect.objectContaining({ filed: [['pay-1'], []] })
    );
    expect(mocks.resolvePaystackRefundRecoveryWatch).toHaveBeenCalled();
  });

  it('sanitizes unusable amounts before the active-queue filing', async () => {
    const supabase = {} as never;

    await expect(
      fileUnusablePaystackRefundEvidence(supabase, {
        candidates: [candidate],
        current: { amount: -5, currency: 42, status: null } as never,
        evidence,
        reference: 'PSK-1',
        refundId: 202,
      })
    ).rejects.toThrow('paystack_refund_evidence_invalid');

    expect(
      mocks.fileActiveOrderPaystackRefundCandidateReviews
    ).toHaveBeenCalledWith(
      supabase,
      [candidate],
      evidence,
      expect.any(String),
      { amount: 0, currency: 'unknown', status: 'unknown' }
    );
  });
});
