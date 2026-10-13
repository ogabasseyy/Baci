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

describe('reconcileWedgedGatewayOrders', () => {
  it('throws when the wedged-candidate lookup fails', async () => {
    const supabase = buildSupabase({ error: { message: 'db down' } });

    await expect(
      reconcileWedgedGatewayOrders({ scheduleAfter, supabase })
    ).rejects.toThrow('wedged_order_lookup_failed');
  });

  it('returns an empty summary when nothing is wedged', async () => {
    const supabase = buildSupabase({ data: [] });

    const summary = await reconcileWedgedGatewayOrders({
      scheduleAfter,
      supabase,
    });

    expect(summary).toEqual({
      checked: 0,
      detectedUnhealable: [],
      failed: [],
      healed: [],
      reviewsFiled: [],
      skipped: [],
    });
  });

  it('disambiguates the order relationship while preserving healable candidates', async () => {
    const supabase = buildSupabase({ data: [wedgedCandidate] });
    mocks.verifyPaystackPayment.mockResolvedValue({
      data: { amount: 5829060, currency: 'NGN', status: 'success' },
      success: true,
    });
    mocks.finalizeOrderGatewayPayment.mockResolvedValue({
      healed: true,
      kind: 'completed',
      orderNumber: 'ORD-1',
    });

    const summary = await reconcileWedgedGatewayOrders({
      scheduleAfter,
      supabase,
    });

    expect(supabase.select).toHaveBeenCalledWith(
      'id, created_at, order_id, merchant_id, amount, currency, platform_fee, gateway, gateway_reference, metadata, status, orders!transactions_order_id_fkey!inner(id, payment_status, cancelled_at)'
    );
    expect(summary).toMatchObject({
      checked: 1,
      healed: [{ orderId: 'order-1', orderNumber: 'ORD-1' }],
    });
  });

  it('admits provider-flagged pending rows and heals them after re-verification', async () => {
    // A guest Paystack payment the verify GET confirmed with the
    // provider but whose webhook never landed: pending, flagged, order
    // unpaid. The sweep must pick it up (not only pending Juicyway)
    // and heal once its own re-verification agrees.
    const supabase = buildSupabase({
      data: [
        {
          ...wedgedCandidate,
          metadata: { guest_provider_confirmed: true },
          status: 'pending',
        },
      ],
    });
    mocks.verifyPaystackPayment.mockResolvedValue({
      data: { amount: 5829060, currency: 'NGN', status: 'success' },
      success: true,
    });
    mocks.finalizeOrderGatewayPayment.mockResolvedValue({
      healed: true,
      kind: 'completed',
      orderNumber: 'ORD-1',
    });

    const summary = await reconcileWedgedGatewayOrders({
      scheduleAfter,
      supabase,
    });

    const builder = vi.mocked(supabase.from).mock.results[0]?.value as {
      or: ReturnType<typeof vi.fn>;
    };
    expect(builder.or).toHaveBeenCalledWith(
      'status.eq.completed,and(status.eq.pending,gateway.eq.juicyway),and(status.eq.pending,metadata->>guest_provider_confirmed.eq.true)'
    );
    // The pending candidate keeps its fresh-capture signal: forcing
    // false would misclassify a real capture on a legacy paid order as
    // a replay. A concurrent webhook that completed the row first is
    // distinguished downstream by the outbox payer evidence.
    expect(mocks.finalizeOrderGatewayPayment).toHaveBeenCalledWith(
      expect.objectContaining({ wonTransactionFlip: true })
    );
    expect(summary).toMatchObject({
      checked: 1,
      healed: [{ orderId: 'order-1', orderNumber: 'ORD-1' }],
    });
  });

  it('surfaces unhealable gateways loudly instead of guessing', async () => {
    const supabase = buildSupabase({
      data: [{ ...wedgedCandidate, gateway: 'klump' }],
    });

    const summary = await reconcileWedgedGatewayOrders({
      scheduleAfter,
      supabase,
    });

    expect(summary.detectedUnhealable).toEqual([
      { gateway: 'klump', transactionId: 'txn-1' },
    ]);
    expect(mocks.finalizeOrderGatewayPayment).not.toHaveBeenCalled();
    // Logged once, stamped so it never consumes the hourly batch again.
    expect(supabase.rpc).toHaveBeenCalledWith(
      'stamp_wedge_sweep_resolution_v1',
      expect.objectContaining({
        p_resolution: 'unhealable_gateway_logged',
        p_transaction_id: 'txn-1',
      })
    );
  });

  it('files the review and stamps a wedged payment whose order was cancelled', async () => {
    const cancelledCandidate = {
      ...wedgedCandidate,
      orders: {
        cancelled_at: '2026-07-12T00:00:00Z',
        id: 'order-1',
        payment_status: 'cancelled',
      },
    };
    const supabase = buildSupabase({ data: [cancelledCandidate] });
    mocks.verifyPaystackPayment.mockResolvedValue({
      data: { amount: 5829060, currency: 'NGN', status: 'success' },
      success: true,
    });
    mocks.finalizeOrderGatewayPayment.mockResolvedValue({
      kind: 'order_cancelled',
      orderNumber: 'ORD-1',
    });

    const summary = await reconcileWedgedGatewayOrders({
      scheduleAfter,
      supabase,
    });

    expect(summary.reviewsFiled).toEqual([
      { orderId: 'order-1', transactionId: 'txn-1' },
    ]);
    expect(supabase.rpc).toHaveBeenCalledWith(
      'stamp_wedge_sweep_resolution_v1',
      expect.objectContaining({
        p_resolution: 'order_cancelled',
        p_transaction_id: 'txn-1',
      })
    );
  });
});
