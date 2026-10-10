import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fileInvalidPaystackRefundEvidenceReview: vi.fn(),
  resolvePaystackRefundRecoveryWatch: vi.fn(),
}));

vi.mock('./file-invalid-paystack-refund-evidence-review', () => ({
  fileInvalidPaystackRefundEvidenceReview:
    mocks.fileInvalidPaystackRefundEvidenceReview,
}));
vi.mock('./resolve-paystack-refund-recovery-watch', () => ({
  resolvePaystackRefundRecoveryWatch: mocks.resolvePaystackRefundRecoveryWatch,
}));

import { fileInvalidRefundEvidenceBeforeReject } from './file-invalid-refund-evidence-before-reject';

function invalidTransactionError() {
  const error = new Error('paystack_refund_transaction_invalid') as Error & {
    providerRefund: unknown;
  };
  error.providerRefund = {
    amount: 10000,
    currency: 'NGN',
    status: 'processed',
    transaction: 555,
  };
  return error;
}

describe('fileInvalidRefundEvidenceBeforeReject', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fileInvalidPaystackRefundEvidenceReview.mockResolvedValue(undefined);
    mocks.resolvePaystackRefundRecoveryWatch.mockResolvedValue(undefined);
  });

  it('files malformed-transaction evidence against the webhook hint', async () => {
    const supabase = {} as never;

    await fileInvalidRefundEvidenceBeforeReject(supabase, {
      error: invalidTransactionError(),
      paymentReference: 'PSK-1',
      refundId: 202,
    });

    expect(mocks.fileInvalidPaystackRefundEvidenceReview).toHaveBeenCalledWith(
      supabase,
      {
        evidence: {
          providerPaymentTransactionId: 555,
          providerRefundId: 202,
          providerRefundStatus: 'processed',
          reference: 'PSK-1',
        },
        reason: expect.stringContaining('malformed transaction pointer'),
        reference: 'PSK-1',
        refundId: 202,
      }
    );
    expect(mocks.resolvePaystackRefundRecoveryWatch).toHaveBeenCalledWith(
      supabase,
      { providerRefundId: 202, reference: 'PSK-1' }
    );
  });

  it('falls back to a refund-keyed reference without a webhook hint', async () => {
    const supabase = {} as never;

    await fileInvalidRefundEvidenceBeforeReject(supabase, {
      error: invalidTransactionError(),
      refundId: 202,
    });

    expect(mocks.fileInvalidPaystackRefundEvidenceReview).toHaveBeenCalledWith(
      supabase,
      expect.objectContaining({ reference: 'unknown-refund:202' })
    );
  });

  it('files unusable references with an unknown status default', async () => {
    const error = new Error(
      'paystack_refund_payment_reference_invalid'
    ) as Error & { providerRefund: unknown };
    error.providerRefund = { transaction: 555 };
    const supabase = {} as never;

    await fileInvalidRefundEvidenceBeforeReject(supabase, {
      error,
      paymentReference: 'PSK-9',
      refundId: 203,
    });

    expect(mocks.fileInvalidPaystackRefundEvidenceReview).toHaveBeenCalledWith(
      supabase,
      expect.objectContaining({
        evidence: expect.objectContaining({
          providerRefundStatus: 'unknown',
        }),
        reason: expect.stringContaining('outside the recovery alphabet'),
      })
    );
  });

  it('no-ops for any other error', async () => {
    const supabase = {} as never;

    await fileInvalidRefundEvidenceBeforeReject(supabase, {
      error: new Error('paystack_refund_verification_unavailable'),
      paymentReference: 'PSK-1',
      refundId: 202,
    });
    await fileInvalidRefundEvidenceBeforeReject(supabase, {
      error: 'not-an-error',
      refundId: 202,
    });

    expect(
      mocks.fileInvalidPaystackRefundEvidenceReview
    ).not.toHaveBeenCalled();
    expect(mocks.resolvePaystackRefundRecoveryWatch).not.toHaveBeenCalled();
  });
});
