import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handlePaystackCancellationRefundEvent } from './paystack-cancellation-refund-event-webhook';

const mocks = vi.hoisted(() => ({
  fileRefundEvidenceReview: vi.fn(),
  holdPaystackRefundForReview: vi.fn(),
  reconcilePaystackCancellationRefund: vi.fn(),
  reconcilePaystackRefundEvent: vi.fn(),
}));

vi.mock('@/lib/payments/reconcile-paystack-cancellation-refund', () => ({
  reconcilePaystackCancellationRefund:
    mocks.reconcilePaystackCancellationRefund,
}));
vi.mock('@/lib/payments/reconcile-paystack-refund-event', () => ({
  reconcilePaystackRefundEvent: mocks.reconcilePaystackRefundEvent,
}));
vi.mock('@/lib/payments/file-refund-evidence-review', () => ({
  fileRefundEvidenceReview: mocks.fileRefundEvidenceReview,
}));
vi.mock('@/lib/payments/hold-paystack-refund-for-review', () => ({
  holdPaystackRefundForReview: mocks.holdPaystackRefundForReview,
}));

describe('handlePaystackCancellationRefundEvent completed-row mismatch', () => {
  function database(refund: unknown) {
    const query = {
      eq: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnThis(),
      ilike: vi.fn().mockReturnThis(),
      limit: vi
        .fn()
        .mockResolvedValue({ data: refund == null ? [] : [refund] }),
      order: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
    };
    return { from: vi.fn(() => query) } as unknown as SupabaseClient;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.reconcilePaystackRefundEvent.mockResolvedValue(undefined);
    mocks.reconcilePaystackCancellationRefund.mockResolvedValue('updated');
  });

  it('acknowledges a completed legacy row once its mismatch review is recorded', async () => {
    const refund = {
      cancel_order: {
        cancelled_at: '2026-09-27T00:00:00Z',
        shipping_status: 'cancelled',
      },
      id: 'refund-1',
      gateway: 'paystack',
      status: 'completed',
    };
    const db = database(refund);
    mocks.reconcilePaystackCancellationRefund.mockRejectedValue(
      new Error('paystack_refund_evidence_mismatch')
    );

    const response = await handlePaystackCancellationRefundEvent(db, {
      data: { id: 42 },
      event: 'refund.processed',
    });

    // The hold RPC reports success for terminal rows, so the recorded
    // review ends the redelivery loop instead of 503ing forever.
    expect(mocks.fileRefundEvidenceReview).toHaveBeenCalledWith(
      db,
      refund,
      'paystack_refund_evidence_mismatch'
    );
    expect(mocks.holdPaystackRefundForReview).toHaveBeenCalledWith(
      db,
      'refund-1',
      'paystack_refund_evidence_mismatch'
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      message: 'Refund event reconciled',
    });
  });
});
