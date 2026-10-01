import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reconcileWedgedGatewayOrders } from '@/lib/payments/reconcile-wedged-gateway-orders';

const mocks = vi.hoisted(() => ({
  fileDuplicateCaptureFallbackReview: vi.fn(),
  fileDuplicatePaymentCapture: vi.fn(),
  finalizeOrderGatewayPayment: vi.fn(),
  getJuicywaySession: vi.fn(),
  handlePaymentForCancelledOrder: vi.fn(),
  verifyKorapayPayment: vi.fn(),
  verifyPaystackPayment: vi.fn(),
}));

vi.mock('@/lib/juicyway', () => ({
  getPaymentSession: mocks.getJuicywaySession,
}));
vi.mock('@/lib/paystack', () => ({
  verifyTransaction: mocks.verifyPaystackPayment,
}));
vi.mock('@/lib/korapay', () => ({
  verifyPayment: mocks.verifyKorapayPayment,
}));
vi.mock('@/lib/payments/finalize-order-gateway-payment', () => ({
  finalizeOrderGatewayPayment: mocks.finalizeOrderGatewayPayment,
}));
vi.mock('@/lib/payments/file-duplicate-payment-capture', () => ({
  fileDuplicatePaymentCapture: mocks.fileDuplicatePaymentCapture,
}));
vi.mock('@/lib/payments/file-duplicate-capture-fallback-review', () => ({
  fileDuplicateCaptureFallbackReview: mocks.fileDuplicateCaptureFallbackReview,
}));
vi.mock(
  '@/lib/payments/handle-payment-for-cancelled-order',
  async (importOriginal) => ({
    ...(await importOriginal<object>()),
    handlePaymentForCancelledOrder: mocks.handlePaymentForCancelledOrder,
  })
);

import {
  buildSupabase,
  scheduleAfter,
  wedgedCandidate,
} from './reconcile-wedged-gateway-orders.test-helpers';

beforeEach(() => {
  vi.clearAllMocks();
  // Reviews file durably by default; the stamp is gated on this.
  mocks.handlePaymentForCancelledOrder.mockResolvedValue(true);
});

describe('reconcileWedgedGatewayOrders late outcomes', () => {
  it('does not retire a wedged row when its review cannot be filed', async () => {
    const supabase = buildSupabase({
      data: [{ ...wedgedCandidate, gateway: 'klump' }],
    });
    mocks.handlePaymentForCancelledOrder.mockResolvedValue(false);

    await reconcileWedgedGatewayOrders({ scheduleAfter, supabase });

    // Without a durable ops row the payment must stay visible to the sweep.
    expect(supabase.rpc).not.toHaveBeenCalledWith(
      'stamp_wedge_sweep_resolution_v1',
      expect.anything()
    );
  });

  it('files a duplicate review when the order filled before finalization', async () => {
    const supabase = buildSupabase({ data: [wedgedCandidate] });
    mocks.verifyPaystackPayment.mockResolvedValue({
      data: {
        amount: 5829060,
        currency: 'NGN',
        id: 123456789,
        status: 'success',
      },
      success: true,
    });
    mocks.finalizeOrderGatewayPayment.mockResolvedValue({
      capturedOnPaidOrder: true,
      healed: false,
      kind: 'completed',
      orderNumber: 'ORD-1',
    });
    mocks.fileDuplicatePaymentCapture.mockResolvedValue(true);

    const summary = await reconcileWedgedGatewayOrders({
      scheduleAfter,
      supabase,
    });

    // The atomic completion found the order already paid, so this wedge
    // capture is extra money: it owes the duplicate review, not a heal,
    // and the stamped row never consumes the batch again.
    expect(mocks.fileDuplicatePaymentCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        evidence: {
          gateway: 'paystack',
          providerAmount: 5829060,
          providerCurrency: 'NGN',
          providerReference: '123456789',
          providerStatus: 'success',
        },
      })
    );
    expect(summary.reviewsFiled).toEqual([
      { orderId: 'order-1', transactionId: 'txn-1' },
    ]);
    expect(summary.healed).toEqual([]);
    expect(supabase.rpc).toHaveBeenCalledWith(
      'stamp_wedge_sweep_resolution_v1',
      expect.objectContaining({
        p_resolution: 'duplicate_capture_reviewed',
        p_transaction_id: 'txn-1',
      })
    );
  });

  it('retries the wedge when the late duplicate review cannot be filed', async () => {
    const supabase = buildSupabase({ data: [wedgedCandidate] });
    mocks.verifyPaystackPayment.mockResolvedValue({
      data: {
        amount: 5829060,
        currency: 'NGN',
        id: 123456789,
        status: 'success',
      },
      success: true,
    });
    mocks.finalizeOrderGatewayPayment.mockResolvedValue({
      capturedOnPaidOrder: true,
      kind: 'completed',
    });
    mocks.fileDuplicatePaymentCapture.mockResolvedValue(false);
    mocks.fileDuplicateCaptureFallbackReview.mockResolvedValue(false);

    const summary = await reconcileWedgedGatewayOrders({
      scheduleAfter,
      supabase,
    });

    expect(summary.failed).toEqual([
      { reason: 'duplicate_capture_review_failed', transactionId: 'txn-1' },
    ]);
    expect(supabase.rpc).not.toHaveBeenCalledWith(
      'stamp_wedge_sweep_resolution_v1',
      expect.anything()
    );
  });

  it('files the fallback review when the wedge duplicate filing fails', async () => {
    const supabase = buildSupabase({ data: [wedgedCandidate] });
    mocks.verifyPaystackPayment.mockResolvedValue({
      data: {
        amount: 5829060,
        currency: 'NGN',
        id: 123456789,
        status: 'success',
      },
      success: true,
    });
    mocks.finalizeOrderGatewayPayment.mockResolvedValue({
      capturedOnPaidOrder: true,
      healed: false,
      kind: 'completed',
      orderNumber: 'ORD-1',
    });
    mocks.fileDuplicatePaymentCapture.mockResolvedValue(false);
    mocks.fileDuplicateCaptureFallbackReview.mockResolvedValue(true);

    const summary = await reconcileWedgedGatewayOrders({
      scheduleAfter,
      supabase,
    });

    // The candidate already finalized, so no sweep reselects it: the
    // direct fallback insert keeps the evidence and the row retires.
    expect(mocks.fileDuplicateCaptureFallbackReview).toHaveBeenCalledWith(
      expect.objectContaining({
        attempt: expect.objectContaining({ id: 'txn-1' }),
      })
    );
    expect(summary.reviewsFiled).toEqual([
      { orderId: 'order-1', transactionId: 'txn-1' },
    ]);
    expect(summary.failed).toEqual([]);
    expect(supabase.rpc).toHaveBeenCalledWith(
      'stamp_wedge_sweep_resolution_v1',
      expect.objectContaining({
        p_resolution: 'duplicate_capture_reviewed',
        p_transaction_id: 'txn-1',
      })
    );
  });

  it('records finalizer failures without aborting the run', async () => {
    const second = {
      ...wedgedCandidate,
      gateway: 'korapay',
      gateway_reference: 'BAC-KORA',
      id: 'txn-2',
      order_id: 'order-2',
    };
    const supabase = buildSupabase({ data: [wedgedCandidate, second] });
    mocks.verifyPaystackPayment.mockResolvedValue({
      data: { amount: 5829060, currency: 'NGN', status: 'success' },
      success: true,
    });
    mocks.verifyKorapayPayment.mockResolvedValue({
      data: { amount: 58290.6, currency: 'NGN', status: 'success' },
      success: true,
    });
    mocks.finalizeOrderGatewayPayment
      .mockResolvedValueOnce({ error: 'x', kind: 'completion_failed' })
      .mockResolvedValueOnce({
        healed: true,
        kind: 'completed',
        orderNumber: 'ORD-2',
      });

    const summary = await reconcileWedgedGatewayOrders({
      scheduleAfter,
      supabase,
    });

    expect(summary.failed).toEqual([
      { reason: 'completion_failed', transactionId: 'txn-1' },
    ]);
    expect(summary.healed).toEqual([
      { orderId: 'order-2', orderNumber: 'ORD-2' },
    ]);
    expect(summary.checked).toBe(2);
  });

  it('files gateway-native evidence for a Juicyway late duplicate', async () => {
    const juicywayCandidate = {
      ...wedgedCandidate,
      currency: 'USDT',
      gateway: 'juicyway',
      gateway_reference: 'BAC-JUICY',
      metadata: {
        juicyway_expected_amount: 50_000,
        juicyway_expected_currency: 'USDT',
        session_id: 'session-1',
      },
      status: 'pending',
    };
    const supabase = buildSupabase({ data: [juicywayCandidate] });
    mocks.getJuicywaySession.mockResolvedValue({
      data: {
        id: 'session-1',
        payment: {
          amount: 50_000,
          currency: 'USDT',
          id: 'payment-1',
          status: 'succeeded',
        },
        status: 'succeeded',
      },
      success: true,
    });
    mocks.finalizeOrderGatewayPayment.mockResolvedValue({
      capturedOnPaidOrder: true,
      healed: false,
      kind: 'completed',
      orderNumber: 'ORD-1',
    });
    mocks.fileDuplicatePaymentCapture.mockResolvedValue(true);

    const summary = await reconcileWedgedGatewayOrders({
      scheduleAfter,
      supabase,
    });

    // Stablecoin captures have no minor units: the review carries the
    // settled total verbatim, not a 100x re-scaling.
    expect(mocks.fileDuplicatePaymentCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        evidence: {
          gateway: 'juicyway',
          providerAmount: 50_000,
          providerCurrency: 'USDT',
          providerReference: 'payment-1',
          providerStatus: 'succeeded',
        },
      })
    );
    expect(summary.reviewsFiled).toEqual([
      { orderId: 'order-1', transactionId: 'txn-1' },
    ]);
  });

  it('fails closed when the verification response cannot identify the charge', async () => {
    const supabase = buildSupabase({ data: [wedgedCandidate] });
    mocks.verifyPaystackPayment.mockResolvedValue({
      data: { amount: 5829060, currency: 'NGN', status: 'success' },
      success: true,
    });
    mocks.finalizeOrderGatewayPayment.mockResolvedValue({
      capturedOnPaidOrder: true,
      healed: false,
      kind: 'completed',
      orderNumber: 'ORD-1',
    });

    const summary = await reconcileWedgedGatewayOrders({
      scheduleAfter,
      supabase,
    });

    expect(mocks.fileDuplicatePaymentCapture).not.toHaveBeenCalled();
    expect(summary.failed).toEqual([
      { reason: 'duplicate_capture_evidence_invalid', transactionId: 'txn-1' },
    ]);
    expect(supabase.rpc).not.toHaveBeenCalledWith(
      'stamp_wedge_sweep_resolution_v1',
      expect.anything()
    );
  });
});
