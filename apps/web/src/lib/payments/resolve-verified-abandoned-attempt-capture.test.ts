import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveVerifiedAbandonedAttemptCapture } from './resolve-verified-abandoned-attempt-capture';

const mocks = vi.hoisted(() => ({
  fileDuplicatePaymentCapture: vi.fn(),
  finalizePartiallyPaidAbandonedAttempt: vi.fn(),
}));

vi.mock('./file-duplicate-payment-capture', () => ({
  fileDuplicatePaymentCapture: mocks.fileDuplicatePaymentCapture,
}));

vi.mock('./finalize-partially-paid-abandoned-attempt', () => ({
  finalizePartiallyPaidAbandonedAttempt:
    mocks.finalizePartiallyPaidAbandonedAttempt,
}));

describe('resolveVerifiedAbandonedAttemptCapture', () => {
  const attempt = {
    amount: 100,
    currency: 'NGN',
    gateway_reference: 'BAC-OLD',
    id: 'attempt-1',
    merchant_id: 'merchant-1',
    metadata: {},
    order_id: 'order-1',
    platform_fee: null,
    status: 'pending',
  } as const;
  const captureData = {
    amount: 10000,
    currency: 'NGN',
    reference: 'BAC-OLD',
    status: 'success',
  };
  const result = { data: captureData, success: true } as never;
  const hold = vi.fn();
  const scheduleAfter = vi.fn();
  const supabase = {} as never;

  function summary() {
    return {
      completed: [] as string[],
      failed: false,
      reviewsFiled: [] as string[],
    };
  }

  beforeEach(() => {
    vi.resetAllMocks();
    hold.mockResolvedValue(undefined);
    mocks.fileDuplicatePaymentCapture.mockResolvedValue(true);
    mocks.finalizePartiallyPaidAbandonedAttempt.mockResolvedValue(undefined);
  });

  it('finalizes a clean capture on a partially paid order', async () => {
    const s = summary();

    await resolveVerifiedAbandonedAttemptCapture({
      attempt,
      hold,
      mismatchKind: null,
      paidOrderStatus: 'partially_paid',
      finalizePayment: vi.fn(),
      result,
      scheduleAfter,
      summary: s,
      supabase,
    });

    expect(mocks.finalizePartiallyPaidAbandonedAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ attempt, providerData: captureData })
    );
    expect(mocks.fileDuplicatePaymentCapture).not.toHaveBeenCalled();
    expect(hold).not.toHaveBeenCalled();
  });

  it('files a duplicate review for a capture on a paid order', async () => {
    const s = summary();

    await resolveVerifiedAbandonedAttemptCapture({
      attempt,
      hold,
      mismatchKind: null,
      paidOrderStatus: 'paid',
      result,
      scheduleAfter,
      summary: s,
      supabase,
    });

    expect(mocks.finalizePartiallyPaidAbandonedAttempt).not.toHaveBeenCalled();
    expect(mocks.fileDuplicatePaymentCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        evidence: expect.objectContaining({ providerStatus: 'success' }),
      })
    );
    expect(s.reviewsFiled).toEqual(['attempt-1']);
    expect(s.failed).toBe(false);
  });

  it('files a mismatched capture with its evidence', async () => {
    const s = summary();

    await resolveVerifiedAbandonedAttemptCapture({
      attempt,
      hold,
      mismatchKind: 'payment_evidence_mismatch',
      paidOrderStatus: 'partially_paid',
      result,
      scheduleAfter,
      summary: s,
      supabase,
    });

    expect(mocks.finalizePartiallyPaidAbandonedAttempt).not.toHaveBeenCalled();
    expect(mocks.fileDuplicatePaymentCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        evidence: expect.objectContaining({
          mismatchKind: 'payment_evidence_mismatch',
        }),
      })
    );
    expect(s.reviewsFiled).toEqual(['attempt-1']);
  });

  it('fails the sweep when the duplicate review cannot be filed', async () => {
    mocks.fileDuplicatePaymentCapture.mockResolvedValue(false);
    const s = summary();

    await resolveVerifiedAbandonedAttemptCapture({
      attempt,
      hold,
      mismatchKind: null,
      paidOrderStatus: 'paid',
      result,
      scheduleAfter,
      summary: s,
      supabase,
    });

    expect(s.reviewsFiled).toEqual([]);
    expect(s.failed).toBe(true);
    expect(hold).toHaveBeenCalledWith('success');
  });
});
