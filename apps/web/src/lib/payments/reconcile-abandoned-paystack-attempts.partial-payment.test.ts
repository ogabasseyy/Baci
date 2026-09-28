import { beforeEach, describe, expect, it, vi } from 'vitest';

const finalize = vi.hoisted(() => vi.fn());
const fileCapture = vi.hoisted(() => vi.fn());
vi.mock('./finalize-order-gateway-payment', () => ({
  finalizeOrderGatewayPayment: finalize,
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

  it('finalizes a verified capture instead of filing a duplicate', async () => {
    const { client } = createClient([partialCandidate()]);
    finalize.mockResolvedValue({
      healed: false,
      kind: 'completed',
      orderNumber: 'ORD-1',
    });
    const scheduleAfter = vi.fn();

    const summary = await reconcileAbandonedPaystackAttempts({
      scheduleAfter,
      supabase: client as never,
      verify: vi.fn().mockResolvedValue(verifiedCapture),
    });

    expect(finalize).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: 'cron:reconcile-gateway-paid-orders',
        gateway: 'paystack',
        orderId: 'order-1',
        reference: 'BAC-OLD',
        scheduleAfter,
        transaction: expect.objectContaining({
          id: 'attempt-1',
          platform_fee: 2,
        }),
        wonTransactionFlip: true,
      })
    );
    expect(fileCapture).not.toHaveBeenCalled();
    expect(summary.completed).toEqual(['attempt-1']);
    expect(summary.reviewsFiled).toEqual([]);
  });

  it('records a review when the finalizer reports a cancelled order', async () => {
    const { client } = createClient([partialCandidate()]);
    finalize.mockResolvedValue({ kind: 'order_cancelled' });

    const summary = await reconcileAbandonedPaystackAttempts({
      supabase: client as never,
      verify: vi.fn().mockResolvedValue(verifiedCapture),
    });

    expect(summary.reviewsFiled).toEqual(['attempt-1']);
    expect(summary.completed).toEqual([]);
    expect(fileCapture).not.toHaveBeenCalled();
  });

  it('fails the sweep when order completion errors', async () => {
    const { client } = createClient([partialCandidate()]);
    finalize.mockResolvedValue({
      error: new Error('completion unavailable'),
      kind: 'completion_failed',
    });

    const summary = await reconcileAbandonedPaystackAttempts({
      supabase: client as never,
      verify: vi.fn().mockResolvedValue(verifiedCapture),
    });

    expect(summary.failed).toBe(true);
    expect(summary.held).toEqual([
      { id: 'attempt-1', reason: 'completion_failed' },
    ]);
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

    expect(finalize).not.toHaveBeenCalled();
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

    expect(finalize).not.toHaveBeenCalled();
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
