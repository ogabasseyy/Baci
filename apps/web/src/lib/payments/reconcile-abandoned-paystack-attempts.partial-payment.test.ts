import { beforeEach, describe, expect, it, vi } from 'vitest';

const finalizePartial = vi.hoisted(() => vi.fn());
const fileCapture = vi.hoisted(() => vi.fn());
vi.mock('./finalize-partially-paid-abandoned-attempt', () => ({
  finalizePartiallyPaidAbandonedAttempt: finalizePartial,
}));
vi.mock('./file-duplicate-payment-capture', () => ({
  fileDuplicatePaymentCapture: fileCapture,
}));

import { reconcileAbandonedPaystackAttempts } from './reconcile-abandoned-paystack-attempts';
import {
  candidate,
  createClient,
} from './reconcile-abandoned-paystack-attempts.test-support';

const verifiedCapture = {
  success: true,
  data: {
    amount: 10000,
    currency: 'NGN',
    reference: 'BAC-OLD',
    status: 'success',
  },
};

function partialCandidate() {
  return {
    ...candidate,
    paid_order: { payment_status: 'partially_paid' },
    platform_fee: 2,
  };
}

describe('abandoned Paystack attempts on partially paid orders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('routes a verified capture through the order finalizer', async () => {
    const { client } = createClient([partialCandidate()]);

    await reconcileAbandonedPaystackAttempts({
      supabase: client as never,
      verify: vi.fn().mockResolvedValue(verifiedCapture),
    });

    expect(finalizePartial).toHaveBeenCalledWith(
      expect.objectContaining({
        attempt: expect.objectContaining({ id: 'attempt-1' }),
        providerData: verifiedCapture.data,
      })
    );
    expect(fileCapture).not.toHaveBeenCalled();
  });

  it('routes a verified processing capture through the order finalizer', async () => {
    const { client } = createClient([
      { ...partialCandidate(), status: 'processing' },
    ]);

    await reconcileAbandonedPaystackAttempts({
      supabase: client as never,
      verify: vi.fn().mockResolvedValue(verifiedCapture),
    });

    expect(finalizePartial).toHaveBeenCalledWith(
      expect.objectContaining({
        attempt: expect.objectContaining({
          id: 'attempt-1',
          status: 'processing',
        }),
      })
    );
    expect(fileCapture).not.toHaveBeenCalled();
  });

  it('still files duplicates for verified captures on fully paid orders', async () => {
    const { client } = createClient([
      { ...candidate, paid_order: { payment_status: 'paid' } },
    ]);
    fileCapture.mockResolvedValue(true);

    const summary = await reconcileAbandonedPaystackAttempts({
      supabase: client as never,
      verify: vi.fn().mockResolvedValue(verifiedCapture),
    });

    expect(finalizePartial).not.toHaveBeenCalled();
    expect(fileCapture).toHaveBeenCalled();
    expect(summary.reviewsFiled).toEqual(['attempt-1']);
  });

  it('files mismatched captures with evidence instead of completing', async () => {
    const { client } = createClient([partialCandidate()]);
    fileCapture.mockResolvedValue(true);

    const summary = await reconcileAbandonedPaystackAttempts({
      supabase: client as never,
      verify: vi.fn().mockResolvedValue({
        success: true,
        data: { ...verifiedCapture.data, amount: 9000 },
      }),
    });

    expect(finalizePartial).not.toHaveBeenCalled();
    expect(fileCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        evidence: expect.objectContaining({
          mismatchKind: 'payment_evidence_mismatch',
        }),
      })
    );
    expect(summary.reviewsFiled).toEqual(['attempt-1']);
  });
});
