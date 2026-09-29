import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reconcileWedgedGatewayOrders } from '@/lib/payments/reconcile-wedged-gateway-orders';

const mocks = vi.hoisted(() => ({
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
    expect(supabase.stampUpdate).not.toHaveBeenCalled();
  });

  it('files a duplicate review when the order filled before finalization', async () => {
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
          providerAmount: 5829060,
          providerCurrency: 'NGN',
          providerReference: '100004260711172450165090811595',
          providerStatus: 'success',
        },
      })
    );
    expect(summary.reviewsFiled).toEqual([
      { orderId: 'order-1', transactionId: 'txn-1' },
    ]);
    expect(summary.healed).toEqual([]);
    expect(supabase.stampUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          wedge_sweep_resolution: 'duplicate_capture_reviewed',
        }),
      })
    );
  });

  it('retries the wedge when the late duplicate review cannot be filed', async () => {
    const supabase = buildSupabase({ data: [wedgedCandidate] });
    mocks.verifyPaystackPayment.mockResolvedValue({
      data: { amount: 5829060, currency: 'NGN', status: 'success' },
      success: true,
    });
    mocks.finalizeOrderGatewayPayment.mockResolvedValue({
      capturedOnPaidOrder: true,
      kind: 'completed',
    });
    mocks.fileDuplicatePaymentCapture.mockResolvedValue(false);

    const summary = await reconcileWedgedGatewayOrders({
      scheduleAfter,
      supabase,
    });

    expect(summary.failed).toEqual([
      { reason: 'duplicate_capture_review_failed', transactionId: 'txn-1' },
    ]);
    expect(supabase.stampUpdate).not.toHaveBeenCalled();
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
});
